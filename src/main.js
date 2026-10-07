import { Game, DT, LAPS, MAX_PLAYERS } from './game.js';
import { Input } from './input.js';
import { Renderer, layoutViews } from './render.js';
import { Sound } from './sound.js';
import { MAX_SPEED, driftTier } from './truck.js';
import { groundHeight } from './terrain.js';
import { Net, lerpSnapshot } from './net.js';
import { loadRecords, submitTime } from './records.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const input = new Input(window);
const game = new Game();
const renderer = new Renderer(canvas);
const sound = new Sound();

const params = new URLSearchParams(location.search);
// ?manual=1 slår av sanntidssteg så automatiske tester kan styre tiden selv.
const manual = params.has('manual');
const room = params.get('room') || 'main';
// Maskinen som kjører spillet (localhost) er verten. Alle andre (LAN-adresse eller tunnel) er fjernspillere.
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const role = params.get('role') || (isLocal ? 'host' : 'client');
const online = !manual || params.has('room');
document.body.classList.toggle('client', role === 'client');

const COLORS = ['#ff6a50', '#5aa2ff', '#4fd36a', '#ffc83a'];
const COLOR_NAMES = ['rød', 'blå', 'grønn', 'gul'];
const IDLE = { throttle: 0, steer: 0, brake: 0, jump: false };
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.resize(Math.max(2, Math.round(r.width)), Math.max(2, Math.round(r.height)));
}
window.addEventListener('resize', resize);
// Safari kan ha ferdig layout først etter at scriptet har kjørt, og dpr endres når vinduet flyttes mellom skjermer.
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.('change', resize);
resize();

function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// ---------- Vert: kjører hele spillet, fjernspillere sender bare input ----------
const host = { localCount: 2, peers: new Map(), slots: [], info: null, evBuf: [], step: 0 };

function lobbySlots() {
  const slots = [];
  for (let k = 0; k < host.localCount; k++) slots.push({ kind: 'local', k });
  for (const p of host.peers.values()) {
    if (slots.length >= MAX_PLAYERS) break;
    slots.push({ kind: 'peer', id: p.id });
  }
  return slots;
}

function sendLobby() {
  if (!net) return;
  const slots = host.slots.length ? host.slots : lobbySlots();
  for (const p of host.peers.values()) {
    const you = slots.findIndex((s) => s.kind === 'peer' && s.id === p.id);
    net.send({ t: 'lobby', to: p.id, you, n: slots.length, state: game.state });
  }
}

function startRace() {
  host.slots = lobbySlots();
  game.start(host.slots.length);
  host.evBuf = [];
  host.slots.forEach((s, i) => { if (s.kind === 'peer') net?.send({ t: 'assign', to: s.id, slot: i }); });
  for (const p of host.peers.values()) {
    if (!host.slots.some((s) => s.kind === 'peer' && s.id === p.id)) net?.send({ t: 'full', to: p.id });
  }
}

function goMenu() {
  game.toMenu();
  host.slots = [];
  sendLobby();
}

function hostMessage(m) {
  if (m.t === 'peer') {
    if (m.open) host.peers.set(m.id, { id: m.id, input: IDLE });
    else host.peers.delete(m.id);
    if (game.state === 'menu') sendLobby();
    else if (m.open) net.send({ t: 'lobby', to: m.id, you: -1, n: game.trucks.length, state: game.state });
  } else if (m.t === 'in') {
    const p = host.peers.get(m.from);
    if (p && Number.isFinite(m.th) && Number.isFinite(m.st)) p.input = { throttle: clamp(m.th, 0, 1), steer: clamp(m.st, -1, 1), brake: clamp(+m.br || 0, 0, 1), jump: !!m.jp };
  }
}

// ---------- Klient: viser verten sitt spill fra egen truck ----------
const client = { status: 'connecting', id: null, slot: null, prev: null, cur: null, curTime: 0, sentAt: 0, sent: '', buf: [], rq: 0, gaps: [], dry: 0 };

function clientMessage(m) {
  if (m.t === 'hello') { client.id = m.id; client.status = m.host ? 'lobby' : 'nohost'; }
  else if (m.t === 'host') client.status = 'lobby';
  else if (m.t === 'hostgone') { client.status = 'nohost'; client.cur = client.prev = null; client.buf = []; }
  else if (m.t === 'lobby') {
    client.slot = m.you >= 0 ? m.you : null;
    client.status = m.state === 'menu' ? 'lobby' : 'spectate';
    if (m.state === 'menu') { client.cur = client.prev = null; client.buf = []; }
  } else if (m.t === 'assign') { client.slot = m.slot; client.status = 'playing'; }
  else if (m.t === 'full') client.status = 'full';
  else if (m.t === 'snap') {
    client.prev = client.cur || m.s;
    client.cur = m.s;
    const arrived = performance.now();
    if (client.curTime) { client.gaps.push(arrived - client.curTime); if (client.gaps.length > 300) client.gaps.shift(); }
    client.curTime = arrived;
    // Jitterbuffer: tegn et par øyeblikksbilder bak, så uregelmessig nettverk ikke gir hakking.
    const last = client.buf[client.buf.length - 1];
    if (last && (last.s.seed !== m.s.seed || m.q <= last.q)) client.buf = [];
    client.buf.push({ q: m.q, s: m.s });
    if (client.buf.length > 12) client.buf.shift();
    if (client.buf.length === 1) client.rq = m.q;
    if (client.slot !== null && client.status !== 'full') client.status = 'playing';
    for (const e of m.s.ev || []) {
      if (e.truck === undefined || e.truck === client.slot || e.other === client.slot || e.type === 'finish') sound.play(e.type, e);
      renderer.fx.onEvent(e, game);
    }
  }
}

let net = null;
if (online && role === 'host') {
  net = new Net('host', room, { message: hostMessage });
  // Adressene hentes med jevne mellomrom, så en ngrok-tunnel som startes senere dukker opp av seg selv.
  const loadInfo = () => fetch('/api/info').then((r) => r.json()).then((i) => { host.info = i; }).catch(() => {});
  loadInfo();
  setInterval(loadInfo, 5000);
} else if (online) {
  net = new Net('client', room, {
    open() { client.status = 'lobby'; },
    close() { client.status = 'connecting'; },
    message: clientMessage,
  });
}

// ---------- Simulering (vert) ----------
let lastInputs = [IDLE, IDLE];
function simStep() {
  input.poll();
  if (input.pressed.size || input.padEdges.size) sound.unlock();

  if (game.state === 'menu') {
    if (input.pressed.has('KeyP')) { host.localCount = host.localCount === 2 ? 1 : 2; sendLobby(); }
    if (input.confirmPressed()) startRace();
  } else if (game.state === 'finished') {
    if (game.stateTime > 1.2 && input.confirmPressed()) startRace();
  }
  if (input.backPressed() && game.state !== 'menu') goMenu();

  lastInputs = game.trucks.map((_, i) => {
    const s = host.slots[i];
    if (!s) return IDLE;
    return s.kind === 'local' ? input.player(s.k) : (host.peers.get(s.id)?.input || IDLE);
  });
  game.step(lastInputs);
  for (const e of game.events) {
    sound.play(e.type, e);
    renderer.fx.onEvent(e, game);
  }
  if (host.peers.size) host.evBuf.push(...game.events);
  game.events.length = 0;

  // 30 øyeblikksbilder i sekundet til fjernspillerne.
  if (net && host.peers.size && game.state !== 'menu' && ++host.step % 2 === 0) {
    const s = game.snapshot();
    s.ev = host.evBuf;
    host.evBuf = [];
    net.send({ t: 'snap', s });
  }
}

function clientInput() {
  // Fjernspilleren har egen Mac: W A D, piltaster eller kontroller virker alle.
  const a = input.player(0), b = input.player(1);
  return { th: Math.max(a.throttle, b.throttle), st: clamp(a.steer + b.steer, -1, 1), br: Math.max(a.brake, b.brake), jp: a.jump || b.jump };
}

const SNAP_DELAY = 2;
function clientStep(now, dt) {
  input.poll();
  if (input.pressed.size || input.padEdges.size) sound.unlock();
  // Spillserveren (server/worker.js) har ingen vert som kan trykke Enter, så en klient kan starte løpet selv.
  if (net && input.confirmPressed() && (client.status === 'lobby' || (client.status === 'playing' && game.state === 'finished'))) net.send({ t: 'start' });
  const inp = clientInput();
  lastInputs = [{ throttle: inp.th, steer: inp.st }];
  const key = `${inp.th.toFixed(2)}|${inp.st.toFixed(2)}|${inp.br.toFixed(2)}|${inp.jp ? 1 : 0}`;
  if (net && (key !== client.sent || now - client.sentAt > 100)) {
    client.sent = key;
    client.sentAt = now;
    net.send({ t: 'in', th: inp.th, st: inp.st, br: inp.br, jp: inp.jp });
  }
  const buf = client.buf;
  if (buf.length) {
    const newest = buf[buf.length - 1].q, oldest = buf[0].q;
    const err = newest - SNAP_DELAY - client.rq;
    if (Math.abs(err) > 6) client.rq = newest - SNAP_DELAY;
    else client.rq += dt * 30 * (1 + clamp(err * 0.15, -0.3, 0.3));
    if (client.rq >= newest) { client.rq = newest; client.dry++; }
    client.rq = Math.max(client.rq, oldest);
    const i = Math.min(buf.length - 1, Math.max(0, Math.floor(client.rq - oldest)));
    const a = buf[i], b = buf[Math.min(i + 1, buf.length - 1)];
    game.applySnapshot(lerpSnapshot(a.s, b.s, b === a ? 1 : clamp(client.rq - a.q, 0, 1)));
  }
}

// ---------- HUD ----------
const viewsEl = $('views');
let viewsKey = '';
function buildViews(views) {
  const rects = layoutViews(views.length);
  viewsEl.innerHTML = '';
  views.forEach((ti, k) => {
    const r = rects[k];
    const el = document.createElement('div');
    el.className = `vp vp${ti} c${ti}`;
    el.style.cssText = `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;
    el.innerHTML = `<div class="pos" id="pos-${ti}"></div>
      <div class="card"><div class="pname">Spiller ${ti + 1}</div>
        <div class="score"><span class="coin-icon"></span><span class="score-val" id="score-${ti}">0</span><span class="score-label">mynter</span></div>
        <div class="lap" id="lap-${ti}"></div></div>
      <div class="wrong" id="wrong-${ti}">Feil vei!</div><div class="rocket-warn" id="rw-${ti}"></div><div class="fx" id="fx-${ti}"></div>`;
    viewsEl.append(el);
  });
}

function currentViews() {
  if (role === 'client') return [clamp(client.slot ?? 0, 0, game.trucks.length - 1)];
  return game.trucks.map((_, i) => i);
}

const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
let lastKey = '';
function updateBest() {
  const { best } = loadRecords();
  setText($('best'), best === null ? '' : `Rekord: ${fmtTime(best)}`);
}
updateBest();
function updateHud(views = currentViews()) {
  const playing = role === 'host' || (client.status === 'playing' && !!client.cur);
  const key = `${views.join()}|${game.trucks.length}|${role}`;
  if (key !== viewsKey) { viewsKey = key; buildViews(views); }

  let status = '';
  if (game.state === 'menu') status = 'Klar?';
  else if (game.state === 'countdown') status = 'Gjør deg klar!';
  else if (game.state === 'racing') status = 'Løp!';
  else status = `Spiller ${game.winner + 1} vant!`;
  setText($('status'), status);
  setText($('timer'), `Tid: ${fmtTime(game.state === 'finished' ? game.finishTime : game.time)}`);

  const showState = playing ? game.state : 'menu';
  const stageClass = showState;
  if ($('stage').className !== stageClass) $('stage').className = stageClass;
  $('menu').classList.toggle('hidden', role !== 'host' || game.state !== 'menu');
  $('results').classList.toggle('hidden', !(playing && game.state === 'finished'));
  const clientPanel = role === 'client' && !(playing && game.state !== 'menu');
  $('client-panel').classList.toggle('hidden', !clientPanel);

  if (role === 'host' && game.state === 'menu') {
    for (const i of [0, 1]) {
      const pad = input.padInfo(i);
      const ps = $(`pad-status-${i}`);
      setText(ps, pad ? `✓ ${pad.name} tilkoblet` : 'Ingen kontroller – trykk en knapp på kontrolleren for å koble til');
      ps.classList.toggle('on', !!pad);
    }
    $('ctl-p2').classList.toggle('off', host.localCount < 2);
    renderLobby();
  }
  if (role === 'client') renderClientPanel();

  if (game.state === 'finished' && playing) {
    const rk = `${game.winner}|${game.seed}`;
    if (lastKey !== rk) {
      lastKey = rk;
      $('winner-text').textContent = `Spiller ${game.winner + 1} vant!`;
      $('winner-text').style.color = COLORS[game.winner];
      $('winner-time').textContent = `Tid: ${fmtTime(game.finishTime)}`;
      const rec = submitTime(game.seed, game.finishTime);
      let recText = '';
      if (rec.newRecord) recText = 'NY REKORD!';
      else if (rec.newTrackRecord) recText = 'NY BANEREKORD!';
      setText($('record-text'), recText);
      $('record-text').classList.toggle('hidden', !recText);
      $('best-time').textContent = `Rekord: ${fmtTime(Math.min(rec.best ?? Infinity, game.finishTime))}`;
      updateBest();
      $('result-scores').innerHTML = game.order().map((t, i) =>
        `<div class="rs c${t.id}"><div class="pl">${i + 1}. Spiller ${t.id + 1}</div><div class="big" id="res-score-${t.id}">${t.score}</div><div>mynter</div></div>`).join('');
      $('again').innerHTML = 'Trykk <kbd>Enter</kbd> eller <kbd>✕</kbd> for å kjøre igjen';
    }
  }

  for (const i of views) {
    const t = game.trucks[i];
    if (!t || !$(`pos-${i}`)) continue;
    setText($(`pos-${i}`), `${game.place(t)}.`);
    setText($(`score-${i}`), String(t.score));
    setText($(`lap-${i}`), `Runde ${game.lap(t)}/${LAPS}`);
    $(`wrong-${i}`).classList.toggle('show', game.state === 'racing' && t.wrongWay > 1);
    // Rakett på vei mot denne trucken: varsle, og si fra om den kommer bakfra.
    let warn = '';
    if (game.state === 'racing' && t.stun <= 0) {
      let best = 1e9, behind = false;
      for (const p of game.projectiles) {
        if (p.target !== i || p.missed) continue;
        const d = Math.hypot(p.x - t.x, p.z - t.z);
        if (d < best) { best = d; behind = (p.x - t.x) * Math.cos(t.theta) + (p.z - t.z) * Math.sin(t.theta) < 0; }
      }
      if (best < 110) warn = behind ? 'RAKETT BAKFRA! HOPP!' : 'RAKETT! HOPP!';
    }
    const rw = $(`rw-${i}`);
    setText(rw, warn);
    rw.classList.toggle('show', !!warn);
    let text = '', cls = '';
    if (game.state === 'racing') {
      if (t.msgTimer > 0) { text = t.msg; cls = t.stun > 0 ? 'stun' : t.slick > 0 ? 'slick' : t.turbo > 0 ? 'turbo' : t.shield > 0 ? 'shield' : ''; }
      else if (t.stun > 0) { text = 'Truffet!'; cls = 'stun'; }
      else if (t.slick > 0) { text = 'Sladd!'; cls = 'slick'; }
      else if (driftTier(t.drift) > 0) { text = 'DRIFT'; cls = `drift${driftTier(t.drift)}`; }
      else if (t.turbo > 0) { text = 'TURBO!'; cls = 'turbo'; }
      else if (t.draft > 0.3) { text = 'Slipstream'; cls = 'draft'; }
      else if (t.shield > 0) { text = `Skjold ${Math.ceil(t.shield)}s`; cls = 'shield'; }
    }
    const fx = $(`fx-${i}`);
    setText(fx, text);
    const fcls = `fx ${cls}`;
    if (fx.className !== fcls) fx.className = fcls;
  }
}

// Lobby på startskjermen: hvem som er med og hvordan andre kan bli med.
let lobbyKey = '';
function renderLobby() {
  const slots = lobbySlots();
  const local = (k) => (k === 0 ? 'Host · W A D / kontroller 1' : 'Host · piltaster / kontroller 2');
  const cells = Array.from({ length: MAX_PLAYERS }, (_, i) => {
    const s = slots[i];
    if (!s) return `<div class="slot empty c${i}"><b>Spiller ${i + 1}</b><span>Ledig</span></div>`;
    const label = s.kind === 'local' ? local(s.k) : `Fjernspiller #${s.id}`;
    return `<div class="slot c${i}"><b>Spiller ${i + 1} (${COLOR_NAMES[i]})</b><span>${label}</span></div>`;
  }).join('');
  const urls = host.info
    ? [...host.info.lan, host.info.public].filter(Boolean).map((u) => `<b>${esc(u)}</b>`).join(' &nbsp;·&nbsp; ')
    : '';
  const join = !online ? '' : urls
    ? `Andre blir med ved å åpne: ${urls}`
    : 'Henter adresser …';
  const key = cells + join;
  if (key === lobbyKey) return;
  lobbyKey = key;
  $('lobby').innerHTML = `<div class="slots">${cells}</div><div class="joinurls">${join}</div>`;
  $('joininfo').innerHTML = urls ? `Bli med: ${urls}` : '';
}

function renderClientPanel() {
  const msgs = {
    connecting: 'Kobler til …',
    nohost: 'Venter på at verten åpner spillet …',
    lobby: 'Koblet til! Trykk Enter (eller ✕) for å starte løpet.',
    spectate: 'Et løp pågår. Du blir med i neste løp.',
    full: 'Løpet er fullt (maks 4 spillere). Du blir med i neste løp hvis det er plass.',
    playing: 'Venter på data fra verten …',
  };
  setText($('client-status'), msgs[client.status] || '');
  const you = $('client-you');
  if (client.slot !== null) {
    setText(you, `Du er spiller ${client.slot + 1} (${COLOR_NAMES[client.slot]})`);
    you.className = `client-you c${client.slot}`;
  } else setText(you, '');
}

function updateEngine() {
  if (!sound.ctx) return;
  const racing = game.state === 'racing' || game.state === 'countdown';
  if (role === 'client') {
    const t = game.trucks[clamp(client.slot ?? 0, 0, game.trucks.length - 1)];
    sound.engine(Math.min(1, t.speed / MAX_SPEED), lastInputs[0]?.throttle || 0, racing && client.status === 'playing');
    return;
  }
  const speed = game.trucks.reduce((a, t) => a + t.speed, 0) / game.trucks.length;
  const throttle = Math.max(0, ...lastInputs.map((x) => x.throttle));
  sound.engine(Math.min(1, speed / MAX_SPEED), throttle, racing && game.state !== 'finished');
}

const dbg = new URLSearchParams(location.search).has('debug') ? document.body.appendChild(Object.assign(document.createElement('pre'), { style: 'position:fixed;left:6px;bottom:6px;z-index:99;margin:0;padding:4px 6px;background:#000a;color:#8f8;font:11px monospace;pointer-events:none' })) : null;
let fpsN = 0, fpsT = performance.now(), fps = 0;
function updateDebug(now) {
  fpsN++;
  if (now - fpsT < 500) return;
  fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now;
  const g = client.gaps.slice().sort((x, y) => x - y);
  const pc = (p) => (g.length ? g[Math.min(g.length - 1, Math.floor(g.length * p))] : 0).toFixed(0);
  dbg.textContent = `fps ${fps}  dpr ${window.devicePixelRatio}  canvas ${canvas.width}x${canvas.height}\nsnap-gap p50 ${pc(0.5)} p90 ${pc(0.9)} p99 ${pc(0.99)} ms  buffer ${client.buf.length}  tomt ${client.dry}`;
}

let acc = 0, last = performance.now(), clock = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  if (role === 'client') {
    clientStep(now, dt);
  } else if (!manual) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 6) { simStep(); acc -= DT; n++; }
    if (n === 6) acc = 0;
  }
  const views = currentViews();
  renderer.draw(game, dt, clock, views);
  updateHud(views);
  updateEngine();
  if (dbg) updateDebug(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
updateHud();

// Hooks for automated tests.
window.__game = {
  game, input, renderer, role, host, client,
  // Som advance, men uten å tegne mellom hvert steg (raskt nok for lange simuleringer).
  simulate(seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) simStep();
  },
  advance(seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) simStep();
    renderer.draw(game, DT, clock, currentViews());
    updateHud();
  },
  state() {
    return {
      state: game.state,
      winner: game.winner,
      time: game.time,
      countdown: game.countdown,
      coinsLeft: game.coins.filter((c) => !c.taken).length,
      trackLength: game.track.length,
      trucks: game.trucks.map((t) => ({
        x: t.x, z: t.z, theta: t.theta, speed: t.speed, score: t.score,
        lat: t.lat, s: t.s, dist: t.dist, lap: game.lap(t), place: game.place(t),
        onRoad: t.onRoad, wrongWay: t.wrongWay,
        y: t.y, ground: groundHeight(t.x, t.z), air: t.air, drift: t.drift, turbo: t.turbo, shield: t.shield, stun: t.stun, slick: t.slick, draft: t.draft, catchup: t.catchup, msg: t.msg,
      })),
      boxes: game.boxes.length,
      barricades: game.barricades.map((b) => ({ s: b.s, life: b.life })),
      projectiles: game.projectiles.length,
      oils: game.oils.length,
      mines: game.mines.length,
      jumps: game.track.jumps,
      padList: game.track.pads,
      pads: [input.padInfo(0), input.padInfo(1)],
      triangles: renderer.renderer.info.render.triangles,
      net: { role, peers: host.peers.size, slots: host.slots.length, direct: net ? net.direct : 0, clientStatus: client.status, clientSlot: client.slot, seed: game.seed },
    };
  },
  // Flytter en truck til avstand s langs banen (og sideforskyvning lat). `lap` = antall fullførte runder.
  teleport(i, s, lat = 0, lap = 0) {
    game.trucks[i].place(game.track, s, lat, lap * game.track.length + s);
  },
  // Fjerner item-bokser (boost-pads og eventuelt ramper) så fysikktester ikke forstyrres av tilfeldige power-ups.
  quiet(keepJumps = false) {
    game.boxes.forEach((b) => { b.cooldown = 1e9; });
    game.track.pads = [];
    if (!keepJumps) game.track.jumps = [];
  },
  addBarricade(s) {
    const p = game.track.pts[Math.round(s / 2) % game.track.count];
    game.barricades.push({ s, x: p.x, z: p.z, theta: Math.atan2(p.tz, p.tx), lat: 0, halfWidth: 9.4, life: 14, hit: false });
  },
  addCoin(i, s, lat = 0) {
    const p = game.track.pts[Math.round(s / 2) % game.track.count];
    game.coins.push({ x: p.x + p.nx * lat, z: p.z + p.nz * lat, s, taken: false, takenBy: null });
  },
};
