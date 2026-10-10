// Banen: en lukket bane definert av en Catmull-Rom-kurve, resamplet til jevnt fordelte punkter.
// Koordinater er (x, z) i three.js-verdenen sett ovenfra. Sidelengs forskyvning ("lat") er positiv mot høyre.

export const HALF_WIDTH = 11; // minste halve veibredde (det meste av banen)
export const START_HALF_WIDTH = 15; // halve veibredden ved start/mål: plass til alle bilene på én rad
export const WALL_MARGIN = 6; // gresskanten mellom asfalten og barrieren
export const WALL_LAT = START_HALF_WIDTH + WALL_MARGIN; // ytterste barriere (der veien er bredest)
export const SPACING = 2; // avstand mellom banepunktene

const WIDE_BEFORE = 60, WIDE_AFTER = 40, TAPER = 110; // full bredde fra WIDE_BEFORE før til WIDE_AFTER etter streken, så smalner veien over TAPER meter
const STRAIGHT = 35; // banepunkter på hver side av startstreken som må være rette (70 m)
// Bro og undergang: banen krysser seg selv ett sted. Den ene delen går på en hevet bro, den andre under.
export const BRIDGE_H = 7; // brodekkets høyde over bakken (meter)
const BRIDGE_PLATEAU = 25, BRIDGE_RAMP = 80; // flat topp (halvlengde) og oppkjørsel/nedkjørsel (meter)
const BRIDGE_HALF = BRIDGE_PLATEAU + BRIDGE_RAMP;
const CROSS_ZONE = 36; // banepunkter på hver side av kryssingen der delene får ligge tett (72 m)
const CROSS_CLEAR = 150; // kryssingen må ligge minst så mange punkter (300 m) fra start/mål

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const CONTROL = [
  [0, 0], [60, -5], [120, -10], [170, 20], [185, 75], [150, 120], [95, 125], [60, 95],
  [20, 110], [-30, 140], [-85, 130], [-110, 85], [-90, 40], [-50, 25], [-28, 8],
].map(([x, z]) => [x * 1.7, z * 1.7]); // reservebane, skalert opp til samme størrelse som de tilfeldige

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

// Halv veibredde i avstand s fra startstreken: bred rundt streken, smalner så gradvis.
function widthAt(s, length) {
  const d = s > length / 2 ? s - length : s;
  const e = d < -WIDE_BEFORE ? -WIDE_BEFORE - d : d > WIDE_AFTER ? d - WIDE_AFTER : 0;
  return HALF_WIDTH + (START_HALF_WIDTH - HALF_WIDTH) * (1 - smoothstep(0, TAPER, e));
}

const cyc = (a, b, n) => { const d = Math.abs(a - b); return Math.min(d, n - d); };

// Brodekkets høyde over bakken i avstand d (meter) fra brosenteret.
const deckProfile = (d) => BRIDGE_H * (1 - smoothstep(BRIDGE_PLATEAU, BRIDGE_HALF, d));

// cross: { bridge, under } = banepunktene der delen på broen og delen under krysser hverandre (eller null).
function finish(raw, cross = null) {
  const count = raw.length, length = count * SPACING;
  const pts = frames(raw).map((p) => ({ ...p, hw: widthAt(p.s, length), deck: 0 }));
  const track = { pts, count, length, halfWidth: HALF_WIDTH, wallLat: WALL_LAT, jumps: [], bridge: null, zones: [] };
  if (cross) {
    const sc = cross.bridge * SPACING, su = cross.under * SPACING;
    for (const p of pts) p.deck = deckProfile(cyc(p.s, sc, length));
    track.bridge = { index: cross.bridge, under: cross.under, s0: sc - BRIDGE_HALF, s1: sc + BRIDGE_HALF };
    // Her ligger ingen item-bokser, pads, mynter eller sperrer (de ville havnet under brodekket eller blitt plukket fra feil nivå).
    track.zones = [track.bridge, { s0: su - CROSS_ZONE * SPACING, s1: su + CROSS_ZONE * SPACING }].sort((p, q) => p.s0 - q.s0);
  }
  return track;
}

// Flytter s ut av sonene uten pickups (item-bokser, pads, mynter, veisperrer). pad: ekstra margin i meter.
export function clearOfZones(track, s, pad = 0) {
  let w = wrapS(track, s);
  for (let pass = 0; pass < 2; pass++) {
    for (const z of track.zones) if (w > z.s0 - pad && w < z.s1 + pad) w = z.s1 + pad + 1;
  }
  return w;
}

// Halv veibredde i avstand s langs banen.
export function halfWidthAt(track, s) {
  const f = wrapS(track, s) / SPACING;
  const i = Math.floor(f) % track.count;
  const u = f - Math.floor(f);
  return track.pts[i].hw + (track.pts[(i + 1) % track.count].hw - track.pts[i].hw) * u;
}

// Brodekkets høyde over bakken i avstand s langs banen (0 utenfor broen).
export function deckAt(track, s) {
  if (!track.bridge) return 0;
  const f = wrapS(track, s) / SPACING;
  const i = Math.floor(f) % track.count;
  const u = f - Math.floor(f);
  return track.pts[i].deck + (track.pts[(i + 1) % track.count].deck - track.pts[i].deck) * u;
}

// Tilfeldig kontrollpunktsett: en uregelmessig ring, en stadion med lange rette, en kronglete ring eller en åtter (med kryssing).
function ring(rand, twisty) {
  const n = twisty ? 13 + Math.floor(rand() * 5) : 9 + Math.floor(rand() * 4);
  const base = 175 + rand() * 75;
  const sx = 1 + rand() * 0.5, sz = 0.8 + rand() * 0.3;
  const flip = rand() < 0.5 ? 1 : -1;
  const pts = [];
  for (let k = 0; k < n; k++) {
    const ang = ((k + (rand() - 0.5) * (twisty ? 0.55 : 0.35)) / n) * Math.PI * 2;
    const r = base * (twisty ? 0.42 + rand() * 0.9 : 0.62 + rand() * 0.6);
    pts.push([Math.cos(ang) * r * sx, Math.sin(ang) * r * sz * flip]);
  }
  return pts;
}

// Avrundet rektangel (superellipse): lange rette og krappe ender, med små svinger langs de rette.
function stadium(rand) {
  const n = 14 + Math.floor(rand() * 4);
  const base = 150 + rand() * 60;
  const sx = 1.5 + rand() * 0.4, sz = 0.75 + rand() * 0.2;
  const p = 3 + rand() * 1.5;
  const flip = rand() < 0.5 ? 1 : -1;
  const pts = [];
  for (let k = 0; k < n; k++) {
    const ang = ((k + (rand() - 0.5) * 0.2) / n) * Math.PI * 2;
    const c = Math.cos(ang), s = Math.sin(ang);
    const r = (base / (Math.abs(c) ** p + Math.abs(s) ** p) ** (1 / p)) * (1 + (rand() - 0.5) * 0.24);
    pts.push([c * r * sx, s * r * sz * flip]);
  }
  return pts;
}

// Åtte (lemniskate) med ulike store sløyfer: banen krysser seg selv midt i.
function figureEight(rand) {
  const n = 12 + Math.floor(rand() * 4);
  const B = 190 + rand() * 70;
  const A = B * (0.75 + rand() * 0.5);
  const left = 0.85 + rand() * 0.3, right = 0.85 + rand() * 0.3;
  const flip = rand() < 0.5 ? 1 : -1;
  const pts = [];
  for (let k = 0; k < n; k++) {
    const t = ((k + (rand() - 0.5) * 0.12) / n) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const wob = 1 + (rand() - 0.5) * 0.14;
    pts.push([A * c * (c > 0 ? right : left) * wob, B * s * c * flip * wob]);
  }
  return pts;
}

function randomControl(rand) {
  const kind = rand();
  if (kind < 0.55) return figureEight(rand);
  if (kind < 0.75) return stadium(rand);
  return ring(rand, kind > 0.88);
}

// Kryssingen i en lukket bane: banepunktene { a, b } (a < b) der midtlinjene krysser. null = ingen kryssing,
// false = ugyldig (flere kryssinger eller deler som ligger langs hverandre).
function findCrossing(pts) {
  const count = pts.length;
  const skip = Math.ceil(60 / SPACING);
  const R2 = 5 * 5;
  const close = [];
  for (let i = 0; i < count; i++) {
    for (let j = i + skip; j < count; j++) {
      if (count - (j - i) < skip) continue;
      const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].z - pts[j].z) ** 2;
      if (d < R2) close.push([d, i, j]);
    }
  }
  if (!close.length) return null;
  const [, a, b] = close.reduce((m, c) => (c[0] < m[0] ? c : m));
  if (close.some(([, i, j]) => cyc(i, a, count) > 6 || cyc(j, b, count) > 6)) return false;
  return { a, b };
}

function valid(track) {
  const { pts, count, length, bridge } = track;
  if (length < 1100 || length > 2300) return false;
  const k = curvature(pts);
  if (Math.max(...k) > 1 / 22) return false; // for krappe svinger
  const a = bridge?.index, b = bridge?.under;
  const inZone = (i, j) => bridge && ((cyc(i, a, count) <= CROSS_ZONE && cyc(j, b, count) <= CROSS_ZONE) || (cyc(i, b, count) <= CROSS_ZONE && cyc(j, a, count) <= CROSS_ZONE));
  // Ulike deler av banen må ikke ligge for nær hverandre (unntatt ved kryssingen).
  const skip = Math.ceil(((2 * (START_HALF_WIDTH + WALL_MARGIN) + 4) * 2.2) / SPACING);
  for (let i = 0; i < count; i += 2) {
    for (let j = i + skip; j < count; j += 2) {
      if (count - (j - i) < skip) continue;
      const gap = pts[i].hw + pts[j].hw + 2 * WALL_MARGIN + 4;
      if ((pts[i].x - pts[j].x) ** 2 + (pts[i].z - pts[j].z) ** 2 < gap * gap && !inZone(i, j)) return false;
    }
  }
  if (bridge) {
    // Kryssingen må være rettlinjet, tydelig skrå og langt unna start/mål.
    const pa = pts[a], pb = pts[b];
    if (Math.abs(pa.tx * pb.tz - pa.tz * pb.tx) < 0.7) return false;
    for (const c of [a, b]) for (let o = -CROSS_ZONE; o <= CROSS_ZONE; o++) if (k[(c + o + count) % count] > 0.012) return false;
    if (Math.min(cyc(a, 0, count), cyc(b, 0, count)) < CROSS_CLEAR) return false;
  }
  return true;
}

// Flytter startpunktet til et rett stykke (og bort fra kryssingen), så oppstillingen alltid står på en rett strekning.
// strict: også kreve at ingen sving i startområdet er skarpere enn 1/150 m.
function rotateToStraight(raw, cross, strict) {
  const pts = frames(raw);
  const k = curvature(pts);
  const count = raw.length;
  let best = -1, bestV = Infinity;
  for (let i = 0; i < count; i++) {
    if (cross && (cyc(i, cross.bridge, count) < CROSS_CLEAR || cyc(i, cross.under, count) < CROSS_CLEAR)) continue;
    let v = 0, m = 0;
    for (let o = -STRAIGHT; o <= STRAIGHT; o++) { const c = k[(i + o + count) % count]; v += c; m = Math.max(m, c); }
    if (strict && m > 1 / 150) continue;
    if (v < bestV) { bestV = v; best = i; }
  }
  if (best < 0) return null;
  const shift = (i) => (i - best + count) % count;
  return finish(raw.map((_, i) => raw[(best + i) % count]), cross && { bridge: shift(cross.bridge), under: shift(cross.under) });
}

// Ramper (hopp) på rette stykker. Rampen stiger over len meter og slutter brått, så trucker som kommer i fart letter.
export const RAMP_LEN = 10;
export const RAMP_HEIGHT = 2.8;
function placeJumps(track, rand) {
  const k = curvature(track.pts);
  const { count } = track;
  const want = 3 + Math.floor(rand() * 3);
  const cand = [];
  for (let i = 110; i < count - 110; i++) { // utenfor det brede startområdet
    if (track.zones.some((z) => i * SPACING > z.s0 - RAMP_LEN - 30 && i * SPACING < z.s1 + RAMP_LEN + 30)) continue;
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
    for (let tries = 0; tries < 300 && !track; tries++) {
      const raw = fromControl(randomControl(rand));
      const found = findCrossing(frames(raw));
      if (found === false) continue;
      const cross = found && (rand() < 0.5 ? { bridge: found.a, under: found.b } : { bridge: found.b, under: found.a });
      const t = rotateToStraight(raw, cross, true);
      if (t && valid(t)) track = t;
    }
  }
  if (!track) track = rotateToStraight(fromControl(CONTROL), null, false);
  placeJumps(track, rand || (() => 0.37));
  return track;
}

// Høyde over terrenget (ramper og brodekke) i punktet s langs banen med sideforskyvning lat.
export function heightAt(track, s, lat) {
  const deck = deckAt(track, s);
  if (Math.abs(lat) > halfWidthAt(track, s) + (deck > 0 ? 1 : 0)) return 0; // brodekket stikker en meter utenfor asfalten
  const w = wrapS(track, s);
  for (const j of track.jumps) if (w >= j.s0 && w < j.s1) return deck + j.h * ((w - j.s0) / (j.s1 - j.s0));
  return deck;
}

// Rader med item-bokser (tre og tre) som ikke ligger på ramper.
export function placeItemBoxes(track) {
  const rows = Math.max(4, Math.round(track.length / 300));
  const boxes = [];
  for (let r = 0; r < rows; r++) {
    let s = ((r + 0.5) / rows) * track.length;
    for (const j of track.jumps) if (s > j.s0 - 14 && s < j.s1 + 14) s = j.s1 + 16;
    s = clearOfZones(track, s, 12);
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
  const groups = Math.max(16, Math.round(track.length / 55));
  for (let g = 0; g < groups; g++) {
    const s0 = ((g + 0.2 + 0.6 * rand()) / groups) * track.length;
    if (s0 < 40 || s0 > track.length - 30 || [0, 20].some((o) => clearOfZones(track, s0 + o, 6) !== wrapS(track, s0 + o))) continue;
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
