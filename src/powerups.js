import { STUN_TIME } from './truck.js';

// Oljeflekker og miner: slippes bakover og ligger på banen. Spillogikken (kollisjon, stun/spinn) bor her,
// mens Game eier listene og synkroniserer dem via snapshot.
export const OIL_RADIUS = 4.2;
export const OIL_LIFE = 14;
export const SLICK_TIME = 1.6; // hvor lenge en truck mister grepet etter å ha kjørt i olje
export const MINE_RADIUS = 2.6;
export const MINE_LIFE = 30;
export const MINE_HIT_HEIGHT = 1.2; // er trucken høyere oppe enn dette, hoppes minen over
export const DROP_BEHIND = 5;
const ARM_TIME = 1.2; // eieren er trygg for egne feller en liten stund etter at de er sluppet

// Vekt for hver power-up etter plassering. rank: 0 for lederen ... 1 for den bakerste.
// Bakerst: sterke ting (rakett, skjold, veisperre). Lederen: svake ting (olje, mine).
export function itemWeights(rank) {
  return {
    turbo: 2,
    shield: 1 + 2 * rank,
    rocket: 4 * rank,
    oil: 3 - 2.5 * rank,
    mine: 3 - 2.5 * rank,
    barricade: 2 * rank,
  };
}

// r: tilfeldig tall 0..1 fra verten (seedet i tester).
export function pickItem(rank, r) {
  const w = itemWeights(rank);
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
      if (t.y > 0.6 || (t.id === o.owner && o.age < ARM_TIME)) continue;
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
      if (t.y > MINE_HIT_HEIGHT || (t.id === m.owner && m.age < ARM_TIME)) continue;
      if (Math.hypot(t.x - m.x, t.z - m.z) >= MINE_RADIUS) continue;
      if (t.shield > 0) {
        t.shield = 0;
        t.say('Skjoldet tok minen!');
      } else {
        t.stun = STUN_TIME;
        t.say('Mine! BANG');
      }
      game.emit({ type: 'hit', truck: t.id });
      return false;
    }
    return true;
  });
}
