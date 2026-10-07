import { Game, DT } from './game.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { Renderer } from './render.js';
import { Sound } from './sound.js';
import { groundAt } from './track.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const input = new Input(window);
const game = new Game();
const cam = new Camera();
const renderer = new Renderer(canvas);
const sound = new Sound();

// ?manual=1 disables real-time stepping so automated tests can advance time deterministically.
const manual = new URLSearchParams(location.search).has('manual');

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  cam.resize(canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();
cam.update(game.trucks, DT, true);

function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function simStep() {
  input.poll();
  if (input.pressed.size || input.padEdges.size) sound.unlock();

  if (game.state === 'menu') {
    if (input.confirmPressed()) game.start();
  } else if (game.state === 'finished') {
    if (game.stateTime > 1.2 && input.confirmPressed()) game.start();
  }
  if (input.backPressed() && game.state !== 'menu') game.toMenu();

  const inputs = [input.player(0), input.player(1)];
  const wasState = game.state;
  game.step(inputs);
  if (wasState === 'menu' && game.state === 'countdown') cam.update(game.trucks, DT, true);
  for (const e of game.events) sound.play(e.type);
  game.events.length = 0;
  cam.update(game.trucks, DT);
  cam.groundRef = groundAtX(cam.x);
}

let lastHud = '';
function updateHud() {
  const statusEl = $('status');
  let status = '';
  if (game.state === 'menu') status = 'Klar?';
  else if (game.state === 'countdown') status = String(Math.ceil(game.countdown));
  else if (game.state === 'racing') status = game.time < 1.2 ? 'KJØR!' : 'Løp!';
  else status = `Spiller ${game.winner + 1} vant!`;
  const devices = [0, 1].map((i) => {
    const pad = input.padInfo(i);
    return `${pad ? `🎮 ${pad.name}` : '🎮 ingen kontroller'} · ⌨️ ${i === 0 ? 'W A D' : '↑ ← →'}`;
  });
  const key = [status, game.trucks[0].score, game.trucks[1].score, ...devices, game.state].join('|');
  if (key !== lastHud) {
    lastHud = key;
    statusEl.textContent = status;
    statusEl.classList.toggle('big', game.state === 'countdown' || status === 'KJØR!');
    for (const i of [0, 1]) {
      $(`score-${i}`).textContent = game.trucks[i].score;
      $(`devices-${i}`).textContent = devices[i];
      const pad = input.padInfo(i);
      const ps = $(`pad-status-${i}`);
      ps.textContent = pad ? `✓ ${pad.name} tilkoblet` : 'Ingen kontroller – trykk en knapp på kontrolleren for å koble til';
      ps.classList.toggle('on', !!pad);
    }
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
    // Track is 34px shorter than the bar (room for the goal label).
    $(`marker-${i}`).style.left = `calc(${game.progress(game.trucks[i]) * 100}% - ${game.progress(game.trucks[i]) * 34}px)`;
  }
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
  renderer.draw(game, cam, clock);
  updateHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
updateHud();

// Hooks for automated tests.
window.__game = {
  game, cam, input,
  advance(seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) simStep();
    renderer.draw(game, cam, clock);
    updateHud();
  },
  state() {
    return {
      state: game.state,
      winner: game.winner,
      time: game.time,
      countdown: game.countdown,
      zoom: cam.zoom,
      baseZoom: cam.baseZoom,
      coinsLeft: game.coins.filter((c) => !c.taken).length,
      trucks: game.trucks.map((t) => ({
        x: t.x, y: t.y, angle: t.angle, score: t.score, grounded: t.grounded,
        vx: t.chassis.getLinearVelocity().x, vy: t.chassis.getLinearVelocity().y,
        respawns: t.respawns, screen: cam.toScreen(t.x, t.y),
      })),
      canvas: { w: cam.w, h: cam.h },
      pads: [input.padInfo(0), input.padInfo(1)],
    };
  },
  track: () => ({ pits: game.track.pits, goalX: game.track.goalX, startX: game.track.startX, features: game.track.features }),
  teleport(i, x) {
    game.trucks[i].place(x, groundAtX(x));
  },
  dropAt(i, x, y) {
    const t = game.trucks[i];
    t.place(x, y);
  },
  addCoin(x, y) { game.coins.push({ x, y, taken: false }); },
  ground: (x) => groundAtX(x),
};

function groundAtX(x) { return groundAt(game.track, x); }
