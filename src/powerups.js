import { STUN_TIME, PLANE_TIME } from './truck.js';
import { clearance } from './terrain.js';

// Oljeflekker og miner: slippes bakover og ligger på banen. Spillogikken (kollisjon, stun/spinn) bor her,
// mens Game eier listene og synkroniserer dem via snapshot.
export const OIL_RADIUS = 4.2;
export const OIL_LIFE = 14;
export const SLICK_TIME = 1.6; // hvor lenge en truck mister grepet etter å ha kjørt i olje
export const MINE_RADIUS = 2.6;
export const MINE_LIFE = 30;
export const MINE_HIT_HEIGHT = 1.2; // er trucken høyere over bakken enn dette, hoppes minen over
export const DROP_BEHIND = 5;
export { PLANE_TIME };
export const WHEELLOSS_MAX = 4.5; // hjulløs i så mange sekunder for lederen ...
export const WHEELLOSS_MIN = 1.5; // ... og så mange for trucken rett foran den som brukte power-upen
const ARM_TIME = 1.2; // eieren er trygg for egne feller en liten stund etter at de er sluppet

// Vekt for hver power-up etter plassering. rank: 0 for lederen ... 1 for den bakerste. n: antall trucker.
// Bakerst: sterke ting (rakett, skjold, veisperre, hjulstyv). Lederen: svake ting (olje, mine).
// Hjulstyv bare til den bakerste, fly bare til de to bakerste (med to trucker bare den bakerste).
export function itemWeights(rank, n = 0) {
  const place = Math.round(rank * (n - 1)) + 1;
  const plane = n > 1 && (place === n || (n > 2 && place === n - 1));
  return {
    turbo: 2,
    shield: 1 + 2 * rank,
    rocket: 4 * rank,
    oil: 3 - 2.5 * rank,
    mine: 3 - 2.5 * rank,
    wheelloss: rank === 1 ? 3 : 0,
    plane: plane ? 2.5 : 0,
    barricade: 2 * rank, // sist: en trekning på 0,99 gir alltid veisperre
  };
}

// Hvor lenge en truck på plass `place` (1 = leder) er uten hjul når den bakerste (plass n) bruker hjulstyven.
// Lederen lengst, lineært kortere jo nærmere brukeren, kortest for trucken rett foran.
export function wheelLossTime(place, n) {
  if (n <= 2) return WHEELLOSS_MAX;
  const f = Math.max(0, Math.min(1, (place - 1) / (n - 2)));
  return WHEELLOSS_MAX - (WHEELLOSS_MAX - WHEELLOSS_MIN) * f;
}

// r: tilfeldig tall 0..1 fra verten (seedet i tester).
export function pickItem(rank, r, n = 0) {
  const w = itemWeights(rank, n);
  let x = r * Object.values(w).reduce((a, b) => a + b, 0);
  for (const [item, v] of Object.entries(w)) {
    if (x < v) return item;
    x -= v;
  }
  return 'turbo';
}

function behind(t) {
  return { x: t.x - Math.cos(t.theta) * DROP_BEHIND, z: t.z - Math.sin(t.theta) * DROP_BEHIND };
}

export function dropOil(game, t) {
  game.oils.push({ ...behind(t), owner: t.id, age: 0, life: OIL_LIFE });
}

export function dropMine(game, t) {
  game.mines.push({ ...behind(t), owner: t.id, age: 0 });
}

export function updateOils(game, dt) {
  game.oils = game.oils.filter((o) => {
    o.age += dt;
    o.life -= dt;
    if (o.life <= 0) return false;
    for (const t of game.trucks) {
      if (t.plane > 0 || clearance(t) > 0.6 || (t.id === o.owner && o.age < ARM_TIME)) continue;
      if (Math.hypot(t.x - o.x, t.z - o.z) < OIL_RADIUS) {
        if (t.slick <= 0) t.say('Oljeflekk! Sladd!');
        t.slick = SLICK_TIME;
      }
    }
    return true;
  });
}

export function updateMines(game, dt) {
  game.mines = game.mines.filter((m) => {
    m.age += dt;
    if (m.age > MINE_LIFE) return false;
    for (const t of game.trucks) {
      if (t.plane > 0 || clearance(t) > MINE_HIT_HEIGHT || (t.id === m.owner && m.age < ARM_TIME)) continue;
      if (Math.hypot(t.x - m.x, t.z - m.z) >= MINE_RADIUS) continue;
      const shielded = t.shield > 0;
      if (shielded) {
        t.shield = 0;
        t.say('Skjoldet tok minen!');
      } else {
        t.stun = STUN_TIME;
        t.say('Mine! BANG');
      }
      game.emit({ type: 'hit', truck: t.id, cause: 'mine', shielded });
      return false;
    }
    return true;
  });
}
