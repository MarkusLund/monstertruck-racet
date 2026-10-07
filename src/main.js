import { Game, DT, LAPS } from './game.js';
import { Input } from './input.js';
import { Renderer } from './render.js';
import { Sound } from './sound.js';
import { MAX_SPEED } from './truck.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const input = new Input(window);
const game = new Game();
const renderer = new Renderer(canvas);
const sound = new Sound();

// ?manual=1 disables real-time stepping so automated tests can advance time deterministically.
const manual = new URLSearchParams(location.search).has('manual');

function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.resize(Math.max(2, Math.round(r.width)), Math.max(2, Math.round(r.height)));
}
window.addEventListener('resize', resize);
resize();

function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

let lastInputs = [{ throttle: 0, steer: 0 }, { throttle: 0, steer: 0 }];
function simStep() {
  input.poll();
  if (input.pressed.size || input.padEdges.size) sound.unlock();

  if (game.state === 'menu') {
    if (input.confirmPressed()) game.start();
  } else if (game.state === 'finished') {
    if (game.stateTime > 1.2 && input.confirmPressed()) game.start();
  }
  if (input.backPressed() && game.state !== 'menu') game.toMenu();

  lastInputs = [input.player(0), input.player(1)];
  game.step(lastInputs);
  for (const e of game.events) sound.play(e.type);
  game.events.length = 0;
}

let lastHud = '';
function updateHud() {
  const statusEl = $('status');
  let status = '';
  if (game.state === 'menu') status = 'Klar?';
  else if (game.state === 'countdown') status = 'Gjør deg klar!';
  else if (game.state === 'racing') status = 'Løp!';
  else status = `Spiller ${game.winner + 1} vant!`;
  const devices = [0, 1].map((i) => {
    const pad = input.padInfo(i);
    return `${pad ? `🎮 ${pad.name}` : '🎮 ingen kontroller'} · ⌨️ ${i === 0 ? 'W A D' : '↑ ← →'}`;
  });
  const laps = game.trucks.map((t) => `Runde ${game.lap(t)}/${LAPS}`);
  const places = game.trucks.map((t) => `${game.place(t)}.`);
  const key = [status, game.trucks[0].score, game.trucks[1].score, ...devices, ...laps, ...places, game.state].join('|');
  if (key !== lastHud) {
    lastHud = key;
    statusEl.textContent = status;
    statusEl.classList.toggle('big', false);
    for (const i of [0, 1]) {
      $(`score-${i}`).textContent = game.trucks[i].score;
      $(`devices-${i}`).textContent = devices[i];
      $(`lap-${i}`).textContent = laps[i];
      $(`pos-${i}`).textContent = places[i];
      const pad = input.padInfo(i);
      const ps = $(`pad-status-${i}`);
      ps.textContent = pad ? `✓ ${pad.name} tilkoblet` : 'Ingen kontroller – trykk en knapp på kontrolleren for å koble til';
      ps.classList.toggle('on', !!pad);
    }
    $('stage').className = game.state;
    $('menu').classList.toggle('hidden', game.state !== 'menu');
    $('results').classList.toggle('hidden', game.state !== 'finished');
    if (game.state === 'finished') {
      $('winner-text').textContent = `Spiller ${game.winner + 1} vant!`;
      $('winner-text').style.color = game.winner === 0 ? '#ff6a50' : '#5aa2ff';
      $('winner-time').textContent = `Tid: ${fmtTime(game.finishTime)}`;
      for (const i of [0, 1]) $(`res-score-${i}`).textContent = game.trucks[i].score;
    }
  }
  $('timer').textContent = `Tid: ${fmtTime(game.state === 'finished' ? game.finishTime : game.time)}`;
  for (const i of [0, 1]) {
    const t = game.trucks[i];
    $(`wrong-${i}`).classList.toggle('show', game.state === 'racing' && t.wrongWay > 1);
    let text = '', cls = '';
    if (game.state === 'racing') {
      if (t.msgTimer > 0) { text = t.msg; cls = t.stun > 0 ? 'stun' : t.turbo > 0 ? 'turbo' : t.shield > 0 ? 'shield' : ''; }
      else if (t.stun > 0) { text = 'Truffet!'; cls = 'stun'; }
      else if (t.turbo > 0) { text = 'TURBO!'; cls = 'turbo'; }
      else if (t.draft > 0.3) { text = 'Slipstream'; cls = 'draft'; }
      else if (t.shield > 0) { text = 'Skjold'; cls = 'shield'; }
    }
    const fx = $(`fx-${i}`);
    if (fx.textContent !== text) fx.textContent = text;
    fx.className = `fx ${cls}`;
  }
}

function updateEngine() {
  const racing = game.state === 'racing' || game.state === 'countdown';
  const speed = game.trucks.reduce((a, t) => a + t.speed, 0) / game.trucks.length;
  const throttle = Math.max(lastInputs[0].throttle, lastInputs[1].throttle);
  sound.engine(Math.min(1, speed / MAX_SPEED), throttle, racing && game.state !== 'finished');
}

let acc = 0, last = performance.now(), clock = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  if (!manual) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 6) { simStep(); acc -= DT; n++; }
    if (n === 6) acc = 0;
  }
  renderer.draw(game, dt, clock);
  updateHud();
  updateEngine();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
updateHud();

// Hooks for automated tests.
window.__game = {
  game, input, renderer,
  // Som advance, men uten å tegne mellom hvert steg (raskt nok for lange simuleringer).
  simulate(seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) simStep();
  },
  advance(seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) simStep();
    renderer.draw(game, DT, clock);
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
        y: t.y, air: t.air, turbo: t.turbo, shield: t.shield, stun: t.stun, draft: t.draft, catchup: t.catchup, msg: t.msg,
      })),
      boxes: game.boxes.length,
      barricades: game.barricades.map((b) => ({ s: b.s, life: b.life })),
      projectiles: game.projectiles.length,
      jumps: game.track.jumps,
      pads: [input.padInfo(0), input.padInfo(1)],
      triangles: renderer.renderer.info.render.triangles,
    };
  },
  // Flytter en truck til avstand s langs banen (og sideforskyvning lat). `lap` = antall fullførte runder.
  teleport(i, s, lat = 0, lap = 0) {
    game.trucks[i].place(game.track, s, lat, lap * game.track.length + s);
  },
  // Fjerner item-bokser (og eventuelt ramper) så fysikktester ikke forstyrres av tilfeldige power-ups.
  quiet(keepJumps = false) {
    game.boxes.forEach((b) => { b.cooldown = 1e9; });
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
