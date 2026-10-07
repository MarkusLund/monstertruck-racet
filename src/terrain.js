// Landskap: fjell og fjorder. Alt er deterministisk (seedet med bane-seed) så verten og klientene får identisk terreng.
// Veien følger en egen høydeprofil langs banen (lange stigninger og utforkjøringer, flat ved start/mål).
// Utenfor barrierene går terrenget bratt over i et fjellfelt: høye tinder på den ene siden, stup ned mot fjorden på den andre.
import { SPACING, RAMP_LEN, WALL_LAT } from './track.js';

const CELL = 3; // oppløsning på rutenettet som forteller hvor langt vi er fra veien
const MARGIN = 150; // hvor langt utenfor banen rutenettet går (her slipper fjellene fri)
const ROAD_BUMPS = 0.22; // hvor mye av de små kulene som slår inn på selve veien
const GRADIENT_EPS = 1.5;
const FLAT_START = 10; // flat sone rundt start/mål og ramper (meter fra midtlinjen/rampen)
const MAX_GRADE = 0.15; // bratteste stigning i veiprofilen
const CLIFF_IN = WALL_LAT + 1.5, CLIFF_OUT = WALL_LAT + 30; // der veien slutter og fjellet tar over

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

// Små kuler på og ved veien: [bølgelengde, amplitude].
const BUMPS = [[230, 4.2], [130, 3.2], [80, 2.4], [48, 1.4], [30, 0.9]];
// Fjellfeltet: brede massiver og daler, pluss kortere rygger og skar.
const PEAKS = [[620, 1], [330, 0.62], [170, 0.34], [85, 0.16], [40, 0.06]];
const MOUNTAIN_AMP = 42; // grunnhøyde på fjellfeltet (forsterkes rundt veinivå så det blir bratt)
const UP_SLOPE = 0.95, DOWN_SLOPE = 2.6; // hvor bratt terrenget kan reise seg / falle fra veikanten i snitt (høyde per meter)
const CRAG = 26; // ekstra brattkant der fjellfeltet krysser veinivå

let active = null; // { track, seed, bumps, peaks, noise, grid, profile, base, water, top, cx, cz, reach }

// Gradientstøy (Perlin) med egen seed: gir naturlige rygger, skar og daler i fjellene.
function makeNoise(r) {
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const gx = new Float32Array(256), gz = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gz[i] = Math.sin(a); }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const noise = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const X = xi & 255, Z = zi & 255;
    const a = p[X + p[Z]], b = p[X + 1 + p[Z]], c = p[X + p[Z + 1]], d = p[X + 1 + p[Z + 1]];
    const u = fade(xf), v = fade(zf);
    const n00 = gx[a] * xf + gz[a] * zf, n10 = gx[b] * (xf - 1) + gz[b] * zf;
    const n01 = gx[c] * xf + gz[c] * (zf - 1), n11 = gx[d] * (xf - 1) + gz[d] * (zf - 1);
    const top = n00 + (n10 - n00) * u, bot = n01 + (n11 - n01) * u;
    return (top + (bot - top) * v) * 1.4; // omtrent -1..1
  };
  // Summert støy over flere oktaver (-1..1).
  const fbm = (x, z, oct) => {
    let h = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < oct; o++) { h += noise(x, z) * amp; norm += amp; x = x * 2.03 + 17.1; z = z * 2.03 - 9.7; amp *= 0.5; }
    return h / norm;
  };
  // Ryggestøy (0..1): skarpe egger og fjelltopper, glattere i dalene.
  const ridged = (x, z, oct) => {
    let h = 0, amp = 0.5, norm = 0, weight = 1;
    for (let o = 0; o < oct; o++) {
      let n = 1 - Math.abs(noise(x, z));
      n *= n;
      n *= weight;
      weight = Math.min(1, n * 1.6);
      h += n * amp; norm += amp;
      x = x * 2.1 + 5.3; z = z * 2.1 + 11.9; amp *= 0.52;
    }
    return h / norm;
  };
  return { noise, fbm, ridged };
}

const waves = (r, list, scale = 1) => list.map(([len, amp]) => {
  const dir = r() * Math.PI * 2;
  const k = (Math.PI * 2) / len;
  return { kx: Math.cos(dir) * k, kz: Math.sin(dir) * k, phase: r() * Math.PI * 2, amp: amp * scale };
});

const sumWaves = (ws, x, z) => {
  let h = 0;
  for (const w of ws) h += w.amp * Math.sin(w.kx * x + w.kz * z + w.phase);
  return h;
};

// Bygger terrenget for en bane. Kalles når en ny bane lages (verten og klientene med samme seed gir samme terreng).
export function setTerrain(track, seed) {
  if (active && active.track === track && active.seed === seed) return;
  const r = mulberry((seed ^ 0x9e3779b9) >>> 0);
  const bumps = waves(r, BUMPS);
  const peaks = waves(r, PEAKS);
  const profile = roadProfile(track, r);
  let base = 0;
  for (const h of profile) base += h;
  base /= profile.length;
  const xs = track.pts.map((p) => p.x), zs = track.pts.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const reach = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 120;
  const noise = makeNoise(mulberry((seed ^ 0x51ed27f3) >>> 0)); // egen strøm, så veiprofilen ikke endres
  active = { track, seed, bumps, peaks, noise, profile, base, cx, cz, reach };
  active.grid = buildGrid(track, profile);
  const lo = Math.min(...profile);
  active.water = Math.min(lo - 9, base - 22); // fjorden ligger godt under det laveste punktet på veien
  active.top = Math.max(...profile);
}

// Høyden til veien langs banen: noen få lange bølger per runde, skalert så den bratteste bakken blir MAX_GRADE.
function roadProfile(track, r) {
  const { count, length } = track;
  const harm = [[1, 1], [2, 0.75], [3, 0.35], [4, 0.15]].map(([k, a]) => ({ k, a: a * (0.6 + r() * 0.8), ph: r() * Math.PI * 2 }));
  const raw = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = (i * SPACING) / length;
    for (const h of harm) raw[i] += h.a * Math.sin(Math.PI * 2 * h.k * u + h.ph);
  }
  // Flat oppstilling: rundt start/mål holdes veien på samme høyde som startstreken.
  for (let i = 0; i < count; i++) {
    const d = Math.min(i, count - i) * SPACING;
    raw[i] = raw[0] + (raw[i] - raw[0]) * smooth(30, 110, d);
  }
  let steep = 1e-6;
  for (let i = 0; i < count; i++) steep = Math.max(steep, Math.abs(raw[(i + 1) % count] - raw[i]) / SPACING);
  const k = MAX_GRADE / steep;
  return Float32Array.from(raw, (h) => (h - raw[0]) * k);
}

// Rutenett med avstand til veien, veihøyden der og avstand til flate soner (start/mål og ramper).
function buildGrid(track, profile) {
  const xs = track.pts.map((p) => p.x), zs = track.pts.map((p) => p.z);
  const x0 = Math.min(...xs) - MARGIN, z0 = Math.min(...zs) - MARGIN;
  const nx = Math.ceil((Math.max(...xs) + MARGIN - x0) / CELL) + 1;
  const nz = Math.ceil((Math.max(...zs) + MARGIN - z0) / CELL) + 1;
  const flat = [track.pts[0]];
  for (const j of track.jumps) {
    for (let s = j.s0 - 4; s <= j.s1 + RAMP_LEN * 0.4; s += SPACING) flat.push(track.pts[Math.round(s / SPACING + track.count) % track.count]);
  }
  const { pts, count } = track;
  const factor = new Float32Array(nx * nz), dist = new Float32Array(nx * nz), road = new Float32Array(nx * nz), cliff = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = x0 + ix * CELL, z = z0 + iz * CELL;
      let d = Infinity, df = Infinity, best = 0;
      // Grovsøk på hvert 8. punkt, så finsøk rundt det beste (hvert 2. punkt, som før).
      for (let i = 0; i < count; i += 8) {
        const p = pts[i];
        const e = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (e < d) { d = e; best = i; }
      }
      const coarse = best;
      for (let o = -8; o <= 8; o += 2) {
        const i = (coarse + o + count) % count;
        const p = pts[i];
        const e = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (e < d) { d = e; best = i; }
      }
      for (const p of flat) df = Math.min(df, (p.x - x) ** 2 + (p.z - z) ** 2);
      // Finjuster langs tangenten så veihøyden blir glatt (ikke trappetrinn mellom banepunktene).
      const p = pts[best];
      const along = (x - p.x) * p.tx + (z - p.z) * p.tz;
      const s = p.s + Math.max(-SPACING * 1.5, Math.min(SPACING * 1.5, along));
      d = Math.sqrt(d);
      df = Math.sqrt(df);
      const k = ix + iz * nx;
      dist[k] = d;
      road[k] = profileAtRaw(profile, track, s);
      cliff[k] = smooth(CLIFF_IN, CLIFF_OUT, d);
      factor[k] = (ROAD_BUMPS + (1 - ROAD_BUMPS) * smooth(12, 45, d)) * smooth(FLAT_START, FLAT_START + 16, df);
    }
  }
  return { x0, z0, nx, nz, factor, dist, road, cliff };
}

function profileAtRaw(profile, track, s) {
  const f = ((((s % track.length) + track.length) % track.length) / SPACING);
  const i = Math.floor(f) % track.count;
  const u = f - Math.floor(f);
  return profile[i] * (1 - u) + profile[(i + 1) % track.count] * u;
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

// Fjellfeltet uten veien. Brede massiver og fjorddaler (lange bølger, litt vridd så de ikke blir rette), med skarpe rygger
// og skar på toppen. Lenger fra banen reiser fjellene seg høyere, så horisonten blir en fjellkjede. Rundt veinivå (base)
// forsterkes høyden, så åssidene blir bratte – opp mot tinder eller ned mot fjorden.
function mountain(x, z) {
  const { noise: N, base } = active;
  const wx = x + 90 * N.fbm(x * 0.0019, z * 0.0019, 2), wz = z + 90 * N.fbm(x * 0.0019 + 31.7, z * 0.0019 - 12.3, 2);
  const broad = sumWaves(active.peaks, wx, wz) / 1.5; // omtrent -1..1: daler og massiver
  const far = smooth(active.reach, active.reach + 1100, Math.hypot(x - active.cx, z - active.cz));
  const land = smooth(-0.55, 0.35, broad); // ingen rygger i fjordbunnen
  const ridge = N.ridged(wx * 0.0024, wz * 0.0024, 6);
  let m = broad * MOUNTAIN_AMP + (ridge - 0.3) * (45 + 150 * far) * land + far * 75 * land;
  m += N.fbm(x * 0.017, z * 0.017, 3) * (2.5 + 4 * land); // småknauser og ur
  return base + m + CRAG * Math.tanh(m / 9) + Math.max(0, m - 25) * 0.5;
}

// Terrenghøyde i (x, z). Faller tilbake til 0 før terrenget er bygget.
export function groundHeight(x, z) {
  if (!active) return 0;
  const { grid } = active;
  const c = sample(grid.cliff, grid, x, z, 1);
  const bumps = sumWaves(active.bumps, x, z) * sample(grid.factor, grid, x, z, 1);
  const r = sample(grid.road, grid, x, z, active.base);
  if (c < 0.001) return r + bumps;
  // Nær veien holdes fjellsidene innenfor en snittbratthet (oppover slakere enn nedover mot fjorden),
  // så man ser lia og skogen og ikke en vegg rett bak barrieren. Lenger ute slipper fjellet fri.
  const d = sample(grid.dist, grid, x, z, 1e4), t = d - CLIFF_IN;
  const off = mountain(x, z) - r;
  const A = off > 0 ? 8 + UP_SLOPE * t : 4 + DOWN_SLOPE * t;
  const held = A * Math.tanh(off / A);
  const free = smooth(MARGIN - 75, MARGIN - 12, d);
  return r + (held + (off - held) * free) * c + bumps;
}

// Høyde over bakken for noe med absolutt y (terreng + hoppehøyde).
export const clearance = (o) => o.y - groundHeight(o.x, o.z);

// Avstand til veiens midtlinje (omtrent). Brukes av rendereren til å senke bakken litt under veien.
export function roadDistance(x, z) {
  return active ? sample(active.grid.dist, active.grid, x, z, 999) : 999;
}

// Nøkkelhøyder for rendereren: vannflaten i fjorden, midlere veihøyde og høyeste punkt på veien.
export function terrainLevels() {
  return active ? { water: active.water, base: active.base, top: active.top } : { water: -20, base: 0, top: 0 };
}

// Veiprofilens høyde i avstand s langs banen (uten småkuler).
export function roadHeight(s) {
  return active ? profileAtRaw(active.profile, active.track, s) : 0;
}

// Stigning (høyde per meter) i retning theta, og sidehelning (positiv mot høyre for en truck som peker i theta).
export function groundSlope(x, z, theta) {
  const e = GRADIENT_EPS;
  const gx = (groundHeight(x + e, z) - groundHeight(x - e, z)) / (2 * e);
  const gz = (groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
  const fx = Math.cos(theta), fz = Math.sin(theta);
  return { forward: gx * fx + gz * fz, side: gx * -fz + gz * fx };
}
