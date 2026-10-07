import { DurableObject } from 'cloudflare:workers';
import { Game, DT, MAX_PLAYERS } from '../src/game.js';

// Spillserver på Cloudflare: ett Durable Object per rom (?room=...) kjører hele simuleringen (60 Hz) og
// sender 30 øyeblikksbilder i sekundet til alle spillere. Alle er vanlige klienter (se src/net.js og
// clientMessage i src/main.js), så ingen maskin trenger å være vert. Meldingsformatet er det samme som relayen bruker.

const IDLE = { throttle: 0, steer: 0, brake: 0, jump: false };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = new Game();
    this.peers = new Map(); // id -> { ws, input }
    this.slots = []; // peer-id per truck i pågående løp
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
    this.join(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch { /* lukket */ } }
  broadcast(msg) { const text = JSON.stringify(msg); for (const p of this.peers.values()) try { p.ws.send(text); } catch { /* lukket */ } }

  join(ws) {
    const id = this.nextId++;
    this.peers.set(id, { ws, input: IDLE });
    this.send(ws, { t: 'hello', id, host: true });
    if (this.game.state === 'menu') this.sendLobby();
    else this.send(ws, { t: 'lobby', you: -1, n: this.game.trucks.length, state: this.game.state });
    ws.addEventListener('message', (e) => this.message(id, e.data));
    const leave = () => this.leave(id);
    ws.addEventListener('close', leave);
    ws.addEventListener('error', leave);
    if (!this.timer) this.startLoop();
  }

  leave(id) {
    if (!this.peers.delete(id)) return;
    if (!this.peers.size) { this.stopLoop(); this.slots = []; this.game.toMenu(); } else if (this.game.state === 'menu') this.sendLobby();
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
    }
  }

  sendLobby() {
    const ids = [...this.peers.keys()].slice(0, MAX_PLAYERS);
    for (const [id, p] of this.peers) this.send(p.ws, { t: 'lobby', you: ids.indexOf(id), n: ids.length, state: this.game.state });
  }

  startRace() {
    this.slots = [...this.peers.keys()].slice(0, MAX_PLAYERS);
    this.game.start(this.slots.length);
    this.evBuf = [];
    this.acc = 0;
    this.slots.forEach((id, i) => this.send(this.peers.get(id).ws, { t: 'assign', slot: i }));
    for (const [id, p] of this.peers) if (!this.slots.includes(id)) this.send(p.ws, { t: 'full' });
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
      const inputs = game.trucks.map((_, i) => this.peers.get(this.slots[i])?.input || IDLE);
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
