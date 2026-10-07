import { DurableObject } from 'cloudflare:workers';
import { Game, DT, MAX_PLAYERS } from '../src/game.js';

// Spillserver på Cloudflare: ett Durable Object per rom (?room=...) kjører hele simuleringen (60 Hz) og
// sender 30 øyeblikksbilder i sekundet til alle spillere. Alle er vanlige klienter (se src/net.js og
// clientMessage i src/main.js), så ingen maskin trenger å være vert. Meldingsformatet er det samme som relayen bruker.

const IDLE = { throttle: 0, steer: 0, brake: 0, jump: false };
// Hvor lenge et tomt rom holder på løpet (pauset), så en spiller som laster siden på nytt kommer tilbake til samme løp.
const EMPTY_GRACE = 60_000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = new Game();
    this.peers = new Map(); // id -> { ws, input, key }
    // Nøkkel per truck i pågående løp. Nøkkelen er nettleserens faste id (?pid=, lagret i localStorage), så en spiller
    // som laster siden på nytt eller kobler til igjen fra samme nettleser får tilbake styringen over sin truck.
    this.slots = [];
    this.emptyTimer = null;
    this.nextId = 1;
    this.evBuf = [];
    this.step = 0;
    this.q = 0;
    this.timer = null;
    this.last = 0;
    this.acc = 0;
  }

  fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Forventet WebSocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const pid = new URL(request.url).searchParams.get('pid');
    this.join(server, pid && /^[\w-]{8,64}$/.test(pid) ? pid : null);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch { /* lukket */ } }
  broadcast(msg) { const text = JSON.stringify(msg); for (const p of this.peers.values()) try { p.ws.send(text); } catch { /* lukket */ } }

  join(ws, pid) {
    const id = this.nextId++;
    const key = pid || `#${id}`;
    // Samme nettleser i en annen fane (eller en gammel tilkobling som ikke er lukket ennå): den nye overtar trucken.
    for (const [oid, o] of this.peers) {
      if (o.key !== key) continue;
      o.key = `#${oid}`;
      if (this.game.state !== 'menu') this.send(o.ws, { t: 'lobby', you: -1, n: this.game.trucks.length, state: this.game.state });
    }
    this.peers.set(id, { ws, input: IDLE, key });
    clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
    this.send(ws, { t: 'hello', id, host: true });
    if (this.game.state === 'menu') this.sendLobby();
    else {
      const slot = this.slots.indexOf(key);
      this.send(ws, { t: 'lobby', you: slot, n: this.game.trucks.length, state: this.game.state });
      if (slot >= 0) this.send(ws, { t: 'assign', slot });
    }
    ws.addEventListener('message', (e) => this.message(id, e.data));
    const leave = () => this.leave(id);
    ws.addEventListener('close', leave);
    ws.addEventListener('error', leave);
    if (!this.timer) this.startLoop();
  }

  leave(id) {
    if (!this.peers.delete(id)) return;
    if (this.peers.size) { if (this.game.state === 'menu') this.sendLobby(); return; }
    // Tomt rom: sett løpet på pause, og nullstill først hvis ingen kommer tilbake.
    this.stopLoop();
    this.emptyTimer = setTimeout(() => { this.emptyTimer = null; this.slots = []; this.game.toMenu(); }, EMPTY_GRACE);
  }

  message(id, data) {
    const p = this.peers.get(id);
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!p || !m) return;
    if (m.t === 'in') {
      if (Number.isFinite(m.th) && Number.isFinite(m.st)) p.input = { throttle: clamp(m.th, 0, 1), steer: clamp(m.st, -1, 1), brake: clamp(+m.br || 0, 0, 1), jump: !!m.jp };
    } else if (m.t === 'start') {
      const g = this.game;
      if (g.state === 'menu' || (g.state === 'finished' && g.stateTime > 1.2)) this.startRace();
    } else if (m.t === 'restart') {
      this.restart();
    }
  }

  players() { return [...this.peers.values()].map((p) => p.key).slice(0, MAX_PLAYERS); }

  peerByKey(key) { for (const p of this.peers.values()) if (p.key === key) return p; return null; }

  sendLobby() {
    const keys = this.players();
    for (const p of this.peers.values()) this.send(p.ws, { t: 'lobby', you: keys.indexOf(p.key), n: keys.length, state: this.game.state });
  }

  startRace() {
    this.slots = this.players();
    this.game.start(this.slots.length);
    this.evBuf = [];
    this.acc = 0;
    this.slots.forEach((key, i) => this.send(this.peerByKey(key).ws, { t: 'assign', slot: i }));
    for (const p of this.peers.values()) if (!this.slots.includes(p.key)) this.send(p.ws, { t: 'full' });
  }

  // ?restart i adressen: kast hele spilltilstanden og send alle tilbake til lobbyen.
  restart() {
    this.game = new Game();
    this.slots = [];
    this.evBuf = [];
    this.acc = 0;
    this.sendLobby();
  }

  startLoop() {
    this.last = Date.now();
    this.acc = 0;
    this.timer = setInterval(() => this.tick(), 1000 / 60);
  }

  stopLoop() { clearInterval(this.timer); this.timer = null; }

  tick() {
    const now = Date.now();
    this.acc += Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const game = this.game;
    let n = 0;
    while (this.acc >= DT && n < 6) {
      this.acc -= DT;
      n++;
      const inputs = game.trucks.map((_, i) => this.peerByKey(this.slots[i])?.input || IDLE);
      game.step(inputs);
      this.evBuf.push(...game.events);
      game.events.length = 0;
      if (game.state !== 'menu' && ++this.step % 2 === 0) {
        const s = game.snapshot();
        s.ev = this.evBuf;
        this.evBuf = [];
        this.broadcast({ t: 'snap', s, q: ++this.q });
      }
    }
    if (n === 6) this.acc = 0;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') return new Response('Ikke funnet', { status: 404 });
    // locationHint: rommet opprettes i Vest-Europa uansett hvor første spiller kobler til fra.
    const stub = env.ROOM.get(env.ROOM.idFromName(url.searchParams.get('room') || 'main'), { locationHint: 'weur' });
    return stub.fetch(request);
  },
};
