import { DurableObject } from 'cloudflare:workers';
import { Game, DT, MAX_PLAYERS } from '../src/game.js';
import { createAI, LEVELS } from '../src/ai.js';

// Spillserver på Cloudflare: ett Durable Object per rom (?room=...) kjører hele simuleringen (60 Hz) og
// sender 30 øyeblikksbilder i sekundet til alle spillere. Alle er vanlige klienter (se src/net.js og
// clientMessage i src/main.js), så ingen maskin trenger å være vert. Meldingsformatet er det samme som relayen bruker.

const IDLE = { throttle: 0, steer: 0, brake: 0, jump: false };
// Hvor lenge et tomt rom holder på løpet (pauset), så en spiller som laster siden på nytt kommer tilbake til samme løp.
const EMPTY_GRACE = 60_000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Nøkkel for AI-plasser i slots (ingen nettleser har en nøkkel som starter med @).
const AI_KEY = '@ai';

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = new Game();
    this.peers = new Map(); // id -> { ws, input, key }
    // Nøkkel per truck i pågående løp. Nøkkelen er nettleserens faste id (?pid=, lagret i localStorage), så en spiller
    // som laster siden på nytt eller kobler til igjen fra samme nettleser får tilbake styringen over sin truck.
    this.slots = [];
    this.ai = 1; // ønsket antall AI-motstandere (0–3) og nivå, felles for rommet
    this.lvl = 1;
    this.ais = []; // AI-objekt per truck i pågående løp (null for spillere)
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
      if (this.game.state !== 'menu') this.send(o.ws, { t: 'lobby', you: -1, n: this.game.trucks.length, state: this.game.state, ai: this.slotAi(), lvl: this.lvl });
    }
    this.peers.set(id, { ws, input: IDLE, key, ready: false });
    clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
    this.send(ws, { t: 'hello', id, host: true });
    if (this.game.state === 'menu') this.sendLobby();
    else {
      let slot = this.slots.indexOf(key);
      if (slot < 0 && pid) slot = this.takeOverAi(key); // uten pid kan det være en tilskuerskjerm
      this.send(ws, { t: 'lobby', you: slot, n: this.game.trucks.length, state: this.game.state, ai: this.slotAi(), lvl: this.lvl });
      if (slot >= 0) this.send(ws, { t: 'assign', slot, ai: this.slotAi() });
    }
    ws.addEventListener('message', (e) => this.message(id, e.data));
    const leave = () => this.leave(id);
    ws.addEventListener('close', leave);
    ws.addEventListener('error', leave);
    if (!this.timer) this.startLoop();
  }

  leave(id) {
    if (!this.peers.delete(id)) return;
    if (this.peers.size) {
      if (this.game.state === 'menu') { this.sendLobby(); this.startIfReady(); }
      return;
    }
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
    } else if (m.t === 'watch') {
      p.watch = true; // ren tilskuerskjerm (?watch), tar aldri en plass i løpet
      if (this.game.state === 'menu') this.sendLobby();
    } else if (m.t === 'ai') {
      if (this.game.state === 'menu' && Number.isFinite(m.n) && Number.isFinite(m.lvl)) {
        this.ai = ((Math.round(m.n) % MAX_PLAYERS) + MAX_PLAYERS) % MAX_PLAYERS;
        this.lvl = ((Math.round(m.lvl) % LEVELS.length) + LEVELS.length) % LEVELS.length;
        this.sendLobby();
      }
    } else if (m.t === 'ready') {
      // Lobbyen: hver spiller markerer seg klar (veksler). Løpet starter når alle spillere er klare.
      if (this.game.state === 'menu' && !p.watch) { p.ready = !p.ready; this.sendLobby(); this.startIfReady(); }
    } else if (m.t === 'go') {
      if (this.game.state === 'menu' && !p.watch) this.startRace(); // «start nå»: starter selv om ikke alle er klare
    } else if (m.t === 'start') {
      const g = this.game;
      if (g.state === 'menu' || (g.state === 'finished' && g.stateTime > 1.2)) this.startRace();
    } else if (m.t === 'restart') {
      this.restart();
    }
  }

  players() { return [...this.peers.values()].filter((p) => !p.watch).map((p) => p.key).slice(0, MAX_PLAYERS); }

  // AI-motstandere fyller opp ledige plasser etter spillerne.
  botCount() { return Math.min(this.ai, MAX_PLAYERS - this.players().length); }

  startIfReady() {
    const ps = this.playerPeers();
    if (ps.length && ps.every((p) => p.ready)) this.startRace();
  }

  playerPeers() { return [...this.peers.values()].filter((p) => !p.watch).slice(0, MAX_PLAYERS); }

  // Sen innkomling (pid kjent, ingen plass i løpet): overta siste AI-truck. Gir -1 når det ikke finnes noen.
  takeOverAi(key) {
    const i = this.slots.lastIndexOf(AI_KEY);
    if (i < 0) return -1;
    this.slots[i] = key;
    this.ais[i] = null;
    const ai = this.slotAi();
    // De andre spillerne må få vite det nye AI-antallet (brukes til navnene Bot/Spiller).
    this.slots.forEach((k, j) => { const p = k === AI_KEY || k === key ? null : this.peerByKey(k); if (p) this.send(p.ws, { t: 'assign', slot: j, ai }); });
    return i;
  }

  slotAi() { return this.slots.filter((k) => k === AI_KEY).length; }

  peerByKey(key) { for (const p of this.peers.values()) if (p.key === key) return p; return null; }

  sendLobby() {
    const keys = this.players();
    const rdy = this.playerPeers().map((p) => (p.ready ? 1 : 0)); // klar-status per spiller, i samme rekkefølge som `you`
    for (const p of this.peers.values()) this.send(p.ws, { t: 'lobby', you: keys.indexOf(p.key), n: keys.length + this.botCount(), state: this.game.state, ai: this.botCount(), lvl: this.lvl, rdy });
  }

  startRace() {
    const players = this.players();
    if (!players.length) return; // bare tilskuere i rommet
    for (const p of this.peers.values()) p.ready = false;
    this.slots = [...players, ...Array(this.botCount()).fill(AI_KEY)];
    this.game.start(this.slots.length);
    this.ais = this.slots.map((key, i) => (key === AI_KEY ? createAI(this.game.seed, i, this.lvl) : null));
    this.evBuf = [];
    this.acc = 0;
    const ai = this.slotAi();
    this.slots.forEach((key, i) => { if (key !== AI_KEY) this.send(this.peerByKey(key).ws, { t: 'assign', slot: i, ai }); });
    for (const p of this.peers.values()) if (!p.watch && !this.slots.includes(p.key)) this.send(p.ws, { t: 'full' });
  }

  // ?restart i adressen: kast hele spilltilstanden og send alle tilbake til lobbyen.
  restart() {
    this.game = new Game();
    this.slots = [];
    this.ais = [];
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
      const inputs = game.trucks.map((_, i) => {
        if (this.slots[i] === AI_KEY) return game.state === 'racing' ? this.ais[i].input(game, i) : IDLE;
        return this.peerByKey(this.slots[i])?.input || IDLE;
      });
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
