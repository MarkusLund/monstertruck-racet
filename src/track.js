// Banen: en lukket bane definert av en Catmull-Rom-kurve, resamplet til jevnt fordelte punkter.
// Koordinater er (x, z) i three.js-verdenen sett ovenfra. Sidelengs forskyvning ("lat") er positiv mot høyre.

export const HALF_WIDTH = 9; // halve veibredden
export const WALL_LAT = HALF_WIDTH + 6; // avstand fra midtlinjen til barrieren
export const SPACING = 2; // avstand mellom banepunktene

const CONTROL = [
  [0, 0], [60, -5], [120, -10], [170, 20], [185, 75], [150, 120], [95, 125], [60, 95],
  [20, 110], [-30, 140], [-85, 130], [-110, 85], [-90, 40], [-50, 25], [-28, 8],
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * (
    2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
    + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

function fromControl(CONTROL) {
  const n = CONTROL.length;
  const dense = [];
  for (let i = 0; i < n; i++) {
    const [a, b, c, d] = [-1, 0, 1, 2].map((o) => CONTROL[(i + o + n) % n]);
    for (let k = 0; k < 40; k++) dense.push(catmull(a, b, c, d, k / 40));
  }
  // Buelengde langs den tette kurven.
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[cum.length - 1];
  const count = Math.round(total / SPACING);
  const raw = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / count) * total;
    while (cum[j + 1] < target) j++;
    const f = (target - cum[j]) / (cum[j + 1] - cum[j]);
    const a = dense[j], b = dense[(j + 1) % dense.length];
    raw.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return raw;
}

function frames(raw) {
  const count = raw.length;
  return raw.map((p, i) => {
    const a = raw[(i - 1 + count) % count], b = raw[(i + 1) % count];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
    return { x: p[0], z: p[1], tx, tz, nx: -tz, nz: tx, s: i * SPACING };
  });
}

// Krumning (rad per meter) i hvert punkt.
function curvature(pts) {
  const n = pts.length;
  return pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    return Math.abs(Math.atan2(p.tx * q.tz - p.tz * q.tx, p.tx * q.tx + p.tz * q.tz)) / SPACING;
  });
}

function finish(raw) {
  const count = raw.length;
  return { pts: frames(raw), count, length: count * SPACING, halfWidth: HALF_WIDTH, wallLat: WALL_LAT, jumps: [] };
}

// Tilfeldig kontrollpunktsett: en uregelmessig, strukket ring med varierende radius.
function randomControl(rand) {
  const n = 9 + Math.floor(rand() * 4);
  const base = 95 + rand() * 45;
  const sx = 1 + rand() * 0.5, sz = 0.8 + rand() * 0.3;
  const flip = rand() < 0.5 ? 1 : -1;
  const pts = [];
  for (let k = 0; k < n; k++) {
    const ang = ((k + (rand() - 0.5) * 0.35) / n) * Math.PI * 2;
    const r = base * (0.62 + rand() * 0.6);
    pts.push([Math.cos(ang) * r * sx, Math.sin(ang) * r * sz * flip]);
  }
  return pts;
}

function valid(track) {
  const { pts, count, length } = track;
  if (length < 600 || length > 1250) return false;
  const k = curvature(pts);
  if (Math.max(...k) > 1 / 22) return false; // for krappe svinger
  // Ulike deler av banen må ikke ligge for nær hverandre.
  const minGap = 2 * WALL_LAT + 4;
  const skip = Math.ceil((minGap * 2.2) / SPACING);
  for (let i = 0; i < count; i += 2) {
    for (let j = i + skip; j < count; j += 2) {
      if (count - (j - i) < skip) continue;
      if ((pts[i].x - pts[j].x) ** 2 + (pts[i].z - pts[j].z) ** 2 < minGap * minGap) return false;
    }
  }
  return true;
}

// Flytter startpunktet til et rett stykke, så oppstillingen alltid står på en rett strekning.
function rotateToStraight(track) {
  const k = curvature(track.pts);
  const { count } = track;
  let best = 0, bestV = Infinity;
  const win = 25;
  for (let i = 0; i < count; i++) {
    let v = 0;
    for (let o = -win; o <= win; o++) v += k[(i + o + count) % count];
    if (v < bestV) { bestV = v; best = i; }
  }
  const raw = track.pts.map((_, i) => track.pts[(best + i) % count]).map((p) => [p.x, p.z]);
  return finish(raw);
}

// Ramper (hopp) på rette stykker. Rampen stiger over len meter og slutter brått, så trucker som kommer i fart letter.
export const RAMP_LEN = 10;
export const RAMP_HEIGHT = 2.8;
function placeJumps(track, rand) {
  const k = curvature(track.pts);
  const { count } = track;
  const want = 2 + Math.floor(rand() * 3);
  const cand = [];
  for (let i = 40; i < count - 25; i++) {
    let m = 0;
    for (let o = -6; o <= 22; o++) m = Math.max(m, k[(i + o + count) % count]);
    if (m < 0.011) cand.push(i);
  }
  const chosen = [];
  for (let tries = 0; tries < 200 && chosen.length < want && cand.length; tries++) {
    const i = cand[Math.floor(rand() * cand.length)];
    if (chosen.every((c) => Math.abs(c - i) * SPACING > 110 && count - Math.abs(c - i) > 55)) chosen.push(i);
  }
  chosen.sort((a, b) => a - b);
  track.jumps = chosen.map((i) => ({ s0: i * SPACING, s1: i * SPACING + RAMP_LEN, h: RAMP_HEIGHT }));
}

export function buildTrack(rand = null) {
  let track = null;
  if (rand) {
    for (let tries = 0; tries < 200 && !track; tries++) {
      const t = rotateToStraight(finish(fromControl(randomControl(rand))));
      if (valid(t)) track = t;
    }
  }
  if (!track) track = finish(fromControl(CONTROL));
  placeJumps(track, rand || (() => 0.37));
  return track;
}

// Terrenghøyde (ramper) i punktet s langs banen med sideforskyvning lat.
export function heightAt(track, s, lat) {
  if (Math.abs(lat) > track.halfWidth) return 0;
  const w = wrapS(track, s);
  for (const j of track.jumps) if (w >= j.s0 && w < j.s1) return j.h * ((w - j.s0) / (j.s1 - j.s0));
  return 0;
}

// Rader med item-bokser (tre og tre) som ikke ligger på ramper.
export function placeItemBoxes(track) {
  const rows = 4;
  const boxes = [];
  for (let r = 0; r < rows; r++) {
    let s = ((r + 0.5) / rows) * track.length;
    for (const j of track.jumps) if (s > j.s0 - 14 && s < j.s1 + 14) s = j.s1 + 16;
    for (const lat of [-5, 0, 5]) {
      const p = posAt(track, s, lat);
      boxes.push({ x: p.x, z: p.z, s, cooldown: 0 });
    }
  }
  return boxes;
}

export function wrapS(track, s) {
  return ((s % track.length) + track.length) % track.length;
}

// Posisjon og retning (vinkel i x-z-planet) for avstand s langs banen og sideforskyvning lat.
export function posAt(track, s, lat = 0) {
  const f = wrapS(track, s) / SPACING;
  const i = Math.floor(f) % track.count;
  const a = track.pts[i], b = track.pts[(i + 1) % track.count];
  const u = f - Math.floor(f);
  const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u;
  const tx = a.tx + (b.tx - a.tx) * u, tz = a.tz + (b.tz - a.tz) * u;
  const len = Math.hypot(tx, tz);
  return { x: x - (tz / len) * lat, z: z + (tx / len) * lat, theta: Math.atan2(tz, tx), index: i };
}

// Nærmeste banepunkt. Med `hint` søkes bare i nærheten av forrige indeks (raskt og stabilt).
export function nearest(track, x, z, hint = -1, window = 60) {
  const { pts, count } = track;
  let best = -1, bestD = Infinity;
  const test = (i) => {
    const p = pts[i];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  };
  if (hint < 0) for (let i = 0; i < count; i++) test(i);
  else for (let o = -window; o <= window; o++) test((hint + o + count) % count);
  const p = pts[best];
  const dx = x - p.x, dz = z - p.z;
  return { index: best, lat: dx * p.nx + dz * p.nz, along: dx * p.tx + dz * p.tz, s: p.s, tx: p.tx, tz: p.tz, nx: p.nx, nz: p.nz };
}

// Mynter i grupper langs banen: rette linjer og slalåm.
export function placeCoins(track, rand = Math.random) {
  const coins = [];
  const groups = 16;
  for (let g = 0; g < groups; g++) {
    const s0 = ((g + 0.2 + 0.6 * rand()) / groups) * track.length;
    if (s0 < 40 || s0 > track.length - 30) continue;
    const slalom = rand() < 0.5;
    const base = (rand() * 2 - 1) * 4;
    for (let k = 0; k < 5; k++) {
      const lat = slalom ? Math.sin(k * 1.4) * 5 : base;
      const p = posAt(track, s0 + k * 5, lat);
      coins.push({ x: p.x, z: p.z, s: s0 + k * 5, taken: false, takenBy: null });
    }
  }
  return coins;
}
