import { posAt } from './track.js';

// Boost-pads på bakken. Plasseringen avhenger bare av banen (som lages fra frøet),
// så verten og alle klienter får de samme padsene uten å sende noe over nettet.
export const PAD_TURBO = 1.4; // sekunder med turbo
export const PAD_LENGTH = 7; // langs banen
export const PAD_HALF_WIDTH = 3.4;

// Terrenghøyde under pads/ramper. Byttes mot groundHeight(x, z) fra terrain.js når terrenget finnes.
const groundAt = () => 0;

// Tre pads (to side om side, så én i midten) spredt rundt runden, utenfor ramper og item-bokser.
export function placePads(track) {
  const spots = [[0.14, -4.2], [0.14, 4.2], [0.40, 0], [0.64, -4.2], [0.64, 4.2], [0.88, 0]];
  const pads = [];
  for (const [f, lat] of spots) {
    let s = f * track.length;
    for (const j of track.jumps) if (s > j.s0 - 16 && s < j.s1 + 16) s = j.s1 + 20;
    const p = posAt(track, s, lat);
    pads.push({ s, lat, x: p.x, y: groundAt(p.x, p.z), z: p.z, theta: p.theta });
  }
  return pads;
}

// Ligger trucken på en pad (og ikke høyt i lufta)?
export function onPad(pad, t, length) {
  let ds = t.s - pad.s;
  ds -= Math.round(ds / length) * length;
  return Math.abs(ds) < PAD_LENGTH / 2 + 1 && Math.abs(t.lat - pad.lat) < PAD_HALF_WIDTH + 0.6 && t.y < 1.5;
}
