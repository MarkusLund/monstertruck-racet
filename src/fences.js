// Gjerder langs veien. Det er ingen sammenhengende barriere lenger: man kan kjøre ut i terrenget (og blir hentet
// tilbake til veien etter en stund). Gjerder står bare der det gir mening i landskapet:
//  - autovern der bakken stuper ned fra veikanten (mot fjorden),
//  - skigard der en annen del av banen ligger tett innpå (så man ikke kan skjære over), og noen strekk på flate jorder.
// Alt beregnes fra banen og terrenget, så verten og klientene får de samme gjerdene.
import { WALL_LAT, SPACING } from './track.js';
import { groundHeight, roadHeight } from './terrain.js';

function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FENCE_LAT = WALL_LAT; // trucken (midtpunktet) stoppes her innenfra
export const FENCE_BAND = 2; // ... og her utenfra (FENCE_LAT + FENCE_BAND); selve gjerdet står midt imellom
export const GUARDRAIL = 1, SKIGARD = 2;

const DROP = 24; // så mye lavere enn veien bakken må ligge 18 m utenfor gjerdelinjen for at det settes opp autovern (meter)
const NEIGHBOUR = 2 * WALL_LAT + 30; // nærmere enn dette til en annen del av banen (på samme side) gir skigard
const MAX_GAP = 14, MIN_RUN = 10, PAD = 4; // i banepunkter: tette små hull, dropp korte biter, forleng endene

// side: 0 = venstre (lat < 0), 1 = høyre. Gir { kinds: [Uint8Array, Uint8Array], runs: [{ side, i0, len, kind }] }.
export function placeFences(track, seed) {
  const { count, pts } = track;
  const rand = mulberry((seed ^ 0x2f6b1d37) >>> 0);
  const kinds = [new Uint8Array(count), new Uint8Array(count)];
  const runs = [];
  const far = Math.ceil(80 / SPACING); // punkter nærmere enn dette langs banen regnes som samme strekning

  for (let side = 0; side < 2; side++) {
    const sg = side ? 1 : -1;
    const drop = new Uint8Array(count), close = new Uint8Array(count), flat = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const p = pts[i];
      const road = roadHeight(p.s);
      const at = (lat) => groundHeight(p.x + p.nx * sg * lat, p.z + p.nz * sg * lat) - road;
      const near = at(WALL_LAT + 8), out = at(WALL_LAT + 18);
      drop[i] = out < -DROP ? 1 : 0;
      flat[i] = near > -3 && near < 6 && out > -6 && out < 14 ? 1 : 0; // flatt jorde eller slak beitebakke
      if (i % 2) continue;
      for (let j = 0; j < count; j += 2) {
        const dj = Math.abs(i - j);
        if (Math.min(dj, count - dj) < far) continue;
        const dx = pts[j].x - p.x, dz = pts[j].z - p.z;
        if ((dx * p.nx + dz * p.nz) * sg > 0 && dx * dx + dz * dz < NEIGHBOUR * NEIGHBOUR) { close[i] = close[(i + 1) % count] = 1; break; }
      }
    }
    const mark = (arr, kind) => {
      for (const [i0, len] of spans(arr, count)) {
        for (let k = -PAD; k < len + PAD; k++) {
          const i = (i0 + k + count) % count;
          if (!kinds[side][i]) kinds[side][i] = kind;
        }
      }
    };
    mark(close, SKIGARD);
    mark(drop, GUARDRAIL);
    // Noen strekk med skigard langs jorder og beitebakker, bare til pynt (men de stopper trucken som alle andre gjerder).
    const want = 2 + Math.floor(rand() * 2);
    for (let tries = 0, made = 0; tries < 120 && made < want; tries++) {
      const i0 = Math.floor(rand() * count), len = 18 + Math.floor(rand() * 22);
      let ok = Math.min(i0, count - i0) > 40; // ikke ved start/mål
      for (let k = -6; k < len + 6 && ok; k++) {
        const i = (i0 + k) % count;
        ok = flat[i] && !kinds[side][i];
      }
      if (!ok) continue;
      for (let k = 0; k < len; k++) kinds[side][(i0 + k) % count] = SKIGARD;
      made++;
    }
    // Sammenhengende biter av samme slag (for tegningen).
    for (const kind of [GUARDRAIL, SKIGARD]) {
      for (const [i0, len] of spans(kinds[side].map((v) => (v === kind ? 1 : 0)), count, 0, 0)) runs.push({ side, i0, len, kind });
    }
  }
  return { kinds, runs };
}

// Sammenhengende biter med 1 i en sirkulær liste: tetter hull kortere enn gap og dropper biter kortere enn min.
function spans(arr, count, gap = MAX_GAP, min = MIN_RUN) {
  const a = Uint8Array.from(arr);
  if (a.every((v) => v)) return [[0, count]];
  const start = a.findIndex((v) => !v); // begynn på et hull, så ingen bit deles over sømmen
  const raw = [];
  for (let k = 0; k < count; k++) {
    const i = (start + k) % count;
    if (!a[i]) continue;
    const prev = raw[raw.length - 1];
    if (prev && k - (prev.k0 + prev.len) <= gap) prev.len = k - prev.k0 + 1;
    else raw.push({ k0: k, len: 1 });
  }
  return raw.filter((r) => r.len >= min).map((r) => [(start + r.k0) % count, r.len]);
}

// Gjerdeslaget ved banepunkt index på siden til lat (0 = ingen).
export const fenceAt = (track, index, lat) => track.fences?.kinds[lat < 0 ? 0 : 1][index] ?? 0;
