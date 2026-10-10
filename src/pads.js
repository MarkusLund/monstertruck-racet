import { posAt, clearOfZones } from './track.js';
import { groundHeight, clearance } from './terrain.js';

// Boost-pads på bakken. Plasseringen avhenger bare av banen (som lages fra frøet),
// så verten og alle klienter får de samme padsene uten å sende noe over nettet.
export const PAD_TURBO = 1.4; // sekunder med turbo
export const PAD_LENGTH = 7; // langs banen
export const PAD_HALF_WIDTH = 3.4;

// Terrenget må være bygget (setTerrain) før padsene plasseres, så y blir bakkehøyden.
// Pads (to side om side, så én i midten) spredt rundt runden, utenfor ramper og item-bokser.
export function placePads(track) {
  // Én gruppe like etter hver rad med item-bokser (samme antall som radene): et par side om side, så én i midten.
  const groups = Math.max(4, Math.round(track.length / 300));
  const spots = [];
  for (let g = 0; g < groups; g++) {
    const f = (g + 0.56) / groups;
    if (g % 2) spots.push([f, 0]); else spots.push([f, -4.2], [f, 4.2]);
  }
  const pads = [];
  for (const [f, lat] of spots) {
    let s = f * track.length;
    for (const j of track.jumps) if (s > j.s0 - 16 && s < j.s1 + 16) s = j.s1 + 20;
    s = clearOfZones(track, s, 12);
    const p = posAt(track, s, lat);
    pads.push({ s, lat, x: p.x, y: groundHeight(p.x, p.z), z: p.z, theta: p.theta });
  }
  return pads;
}

// Ligger trucken på en pad (og ikke høyt over bakken)?
export function onPad(pad, t, length) {
  let ds = t.s - pad.s;
  ds -= Math.round(ds / length) * length;
  return Math.abs(ds) < PAD_LENGTH / 2 + 1 && Math.abs(t.lat - pad.lat) < PAD_HALF_WIDTH + 0.6 && clearance(t) < 1.5;
}
