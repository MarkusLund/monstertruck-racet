// Landskap: en deterministisk høydefunksjon (summerte sinusbølger, seedet med bane-seed) så verten og klientene får identisk terreng.
// Veien holdes slak (og flat ved start/mål og rampene); terrenget utenfor veien er mer kupert.
import { SPACING, RAMP_LEN } from './track.js';

const CELL = 3; // oppløsning på rutenettet som forteller hvor langt vi er fra veien
const ROAD_FACTOR = 0.5; // hvor mye av kuppelen som slår inn på selve veien
const GRADIENT_EPS = 1.5;
const FLAT_START = 10; // flat sone rundt start/mål og ramper (meter fra midtlinjen/rampen)

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [bølgelengde, amplitude]: brede daler og åser pluss kortere kollete bølger.
const WAVES = [[230, 4.2], [130, 3.2], [80, 2.4], [48, 1.4], [30, 0.9]];

let active = null; // { track, seed, waves, grid }

// Bygger terrenget for en bane. Kalles når en ny bane lages (verten og klientene med samme seed gir samme terreng).
export function setTerrain(track, seed) {
  if (active && active.track === track && active.seed === seed) return;
  const r = mulberry((seed ^ 0x9e3779b9) >>> 0);
  const waves = WAVES.map(([len, amp]) => {
    const dir = r() * Math.PI * 2;
    const k = (Math.PI * 2) / len;
    return { kx: Math.cos(dir) * k, kz: Math.sin(dir) * k, phase: r() * Math.PI * 2, amp };
  });
  active = { track, seed, waves, grid: buildGrid(track) };
}

// Rutenett med avstand til veien og avstand til flate soner (start/mål og ramper).
function buildGrid(track) {
  const margin = 60;
  const xs = track.pts.map((p) => p.x), zs = track.pts.map((p) => p.z);
  const x0 = Math.min(...xs) - margin, z0 = Math.min(...zs) - margin;
  const nx = Math.ceil((Math.max(...xs) + margin - x0) / CELL) + 1;
  const nz = Math.ceil((Math.max(...zs) + margin - z0) / CELL) + 1;
  const flat = [track.pts[0]];
  for (const j of track.jumps) {
    for (let s = j.s0 - 4; s <= j.s1 + RAMP_LEN * 0.4; s += SPACING) flat.push(track.pts[Math.round(s / SPACING + track.count) % track.count]);
  }
  const factor = new Float32Array(nx * nz);
  const roadPts = track.pts.filter((_, i) => i % 2 === 0);
  const dist = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = x0 + ix * CELL, z = z0 + iz * CELL;
      let d = Infinity, df = Infinity;
      for (const p of roadPts) d = Math.min(d, (p.x - x) ** 2 + (p.z - z) ** 2);
      for (const p of flat) df = Math.min(df, (p.x - x) ** 2 + (p.z - z) ** 2);
      d = Math.sqrt(d);
      df = Math.sqrt(df);
      const k = ix + iz * nx;
      dist[k] = d;
      factor[k] = (ROAD_FACTOR + (1 - ROAD_FACTOR) * smooth(12, 45, d)) * smooth(FLAT_START, FLAT_START + 16, df);
    }
  }
  return { x0, z0, nx, nz, factor, dist };
}

function sample(arr, grid, x, z, fallback) {
  const fx = (x - grid.x0) / CELL, fz = (z - grid.z0) / CELL;
  if (fx < 0 || fz < 0 || fx >= grid.nx - 1 || fz >= grid.nz - 1) return fallback;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const u = fx - ix, v = fz - iz;
  const k = ix + iz * grid.nx;
  const top = arr[k] * (1 - u) + arr[k + 1] * u;
  const bot = arr[k + grid.nx] * (1 - u) + arr[k + grid.nx + 1] * u;
  return top * (1 - v) + bot * v;
}

// Terrenghøyde i (x, z). Faller tilbake til 0 før terrenget er bygget.
export function groundHeight(x, z) {
  if (!active) return 0;
  let h = 0;
  for (const w of active.waves) h += w.amp * Math.sin(w.kx * x + w.kz * z + w.phase);
  return h * sample(active.grid.factor, active.grid, x, z, 1);
}

// Avstand til veiens midtlinje (omtrent). Brukes av rendereren til å senke bakken litt under veien.
export function roadDistance(x, z) {
  return active ? sample(active.grid.dist, active.grid, x, z, 99) : 99;
}

// Stigning (høyde per meter) i retning theta, og sidehelning (positiv mot høyre for en truck som peker i theta).
export function groundSlope(x, z, theta) {
  const e = GRADIENT_EPS;
  const gx = (groundHeight(x + e, z) - groundHeight(x - e, z)) / (2 * e);
  const gz = (groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
  const fx = Math.cos(theta), fz = Math.sin(theta);
  return { forward: gx * fx + gz * fz, side: gx * -fz + gz * fx };
}
