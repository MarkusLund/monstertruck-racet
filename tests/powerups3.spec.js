import { test, expect } from '@playwright/test';
import { open, advance, startRace } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await open(page);
  await startRace(page);
});

// Starter et løp med fire trucker (plass 1 = id 0 ... plass 4 = id 3) og hopper over nedtellingen.
async function raceOfFour(page) {
  await page.evaluate(() => {
    const g = window.__game.game;
    g.start(4);
    g.countdown = 0.01;
    window.__game.advance(0.1);
    window.__game.quiet();
    g.trucks.forEach((t, i) => { t.dist = 400 - i * 40; t.vx = t.vz = 0; });
  });
}

const trucks = (page) => page.evaluate(() => window.__game.state().trucks);
const noWheels = (page) => page.evaluate(() => window.__game.game.trucks.map((t) => t.noWheels));

test('vekter: hjulstyv bare bakerst, fly bare de to bakerste', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { itemWeights, pickItem } = await import('/src/powerups.js');
    const { mulberry } = await import('/src/game.js');
    const rand = mulberry(5);
    const out = {};
    for (const n of [2, 3, 4]) {
      for (let p = 1; p <= n; p++) {
        const rank = (p - 1) / (n - 1);
        const w = itemWeights(rank, n);
        const drawn = {};
        for (let i = 0; i < 1500; i++) { const it = pickItem(rank, rand(), n); drawn[it] = (drawn[it] || 0) + 1; }
        out[`${n}-${p}`] = { wheelloss: w.wheelloss, plane: w.plane, drawn };
      }
    }
    return { out, single: itemWeights(0, 1), noN: itemWeights(1) };
  });
  for (const n of [2, 3, 4]) {
    for (let p = 1; p <= n; p++) {
      const o = r.out[`${n}-${p}`];
      const planeOk = p === n || (n > 2 && p === n - 1);
      expect(o.wheelloss > 0).toBe(p === n);
      expect(o.plane > 0).toBe(planeOk);
      expect(o.drawn.wheelloss > 0).toBe(p === n);
      expect(o.drawn.plane > 0).toBe(planeOk);
    }
  }
  expect(r.single.wheelloss).toBe(0);
  expect(r.single.plane).toBe(0);
  expect(r.noN.plane).toBe(0);
});

test('wheelLossTime: lederen lengst, lineært kortere ned til 1,5 s for trucken rett foran', async ({ page }) => {
  const t = await page.evaluate(async () => {
    const { wheelLossTime } = await import('/src/powerups.js');
    return { four: [1, 2, 3].map((p) => wheelLossTime(p, 4)), five: [1, 2, 3, 4].map((p) => wheelLossTime(p, 5)), two: wheelLossTime(1, 2) };
  });
  expect(t.four[0]).toBeCloseTo(4.5);
  expect(t.four[1]).toBeCloseTo(3);
  expect(t.four[2]).toBeCloseTo(1.5);
  expect(t.five[0]).toBeCloseTo(4.5);
  expect(t.five[3]).toBeCloseTo(1.5);
  expect(t.two).toBeCloseTo(4.5);
});

test('hjulstyv: alle foran mister hjulene (avtagende tid), den bakerste beholder dem', async ({ page }) => {
  await raceOfFour(page);
  await page.evaluate(() => {
    const g = window.__game.game;
    g.events = [];
    g.giveItem(g.trucks[3], 'wheelloss');
  });
  const nw = await noWheels(page);
  expect(nw[0]).toBeCloseTo(4.5);
  expect(nw[1]).toBeCloseTo(3);
  expect(nw[2]).toBeCloseTo(1.5);
  expect(nw[3]).toBe(0);
  const hits = await page.evaluate(() => window.__game.game.events.filter((e) => e.type === 'hit' && e.cause === 'wheelloss').map((e) => e.truck));
  expect(hits.sort()).toEqual([0, 1, 2]);
  await advance(page, 1.6);
  const after = await noWheels(page);
  expect(after[2]).toBe(0);
  expect(after[1]).toBeGreaterThan(1);
  await advance(page, 3);
  expect((await noWheels(page)).every((v) => v === 0)).toBe(true);
});

test('hjulløs truck sklir videre uten å styre, gasse eller bremse, og mister fart', async ({ page }) => {
  await raceOfFour(page);
  const r = await page.evaluate(() => {
    const g = window.__game.game, t = g.trucks[0];
    t.vx = Math.cos(t.theta) * 30; t.vz = Math.sin(t.theta) * 30;
    t.noWheels = 3;
    const theta = t.theta, speed = t.speed;
    const idle = { throttle: 0, steer: 0, brake: 0, jump: false };
    // Full gass, full sving og hopp skal ikke ha noen effekt.
    for (let i = 0; i < 60; i++) g.step([{ throttle: 1, steer: 1, brake: 0, jump: true }, idle, idle, idle]);
    return { dTheta: Math.abs(t.theta - theta), speed, now: t.speed, air: t.air };
  });
  expect(r.dTheta).toBeLessThan(0.05);
  expect(r.now).toBeLessThan(r.speed);
  expect(r.now).toBeGreaterThan(r.speed * 0.4);
  expect(r.air).toBe(false);
});

test('skjold beskytter mot hjulstyv (og brukes opp), fly påvirkes ikke', async ({ page }) => {
  await raceOfFour(page);
  const r = await page.evaluate(() => {
    const g = window.__game.game;
    g.trucks[0].shield = 8;
    g.trucks[1].plane = 3;
    g.events = [];
    g.giveItem(g.trucks[3], 'wheelloss');
    return {
      noWheels: g.trucks.map((t) => t.noWheels),
      shield0: g.trucks[0].shield,
      hit0: g.events.find((e) => e.type === 'hit' && e.truck === 0 && e.cause === 'wheelloss'),
    };
  });
  expect(r.noWheels[0]).toBe(0);
  expect(r.shield0).toBe(0);
  expect(r.hit0.shielded).toBe(true);
  expect(r.noWheels[1]).toBe(0);
  expect(r.noWheels[2]).toBeGreaterThan(0);
});

test('fly: 5 s over alt, så landing på veien med fremgang og riktig rangering', async ({ page }) => {
  await raceOfFour(page);
  const start = await page.evaluate(() => {
    const g = window.__game.game, t = g.trucks[3];
    g.events = [];
    g.giveItem(t, 'plane');
    // En veisperre rett foran flyet skal ikke stoppe det.
    g.barricades.push({ s: t.s + 60, x: 0, z: 0, theta: 0, lat: 0, halfWidth: 12, life: 14, hit: false });
    return { dist: t.dist, plane: t.plane, item: g.events.find((e) => e.type === 'item').item };
  });
  expect(start.plane).toBe(5);
  expect(start.item).toBe('plane');
  await advance(page, 2.5);
  let t = (await trucks(page))[3];
  expect(t.y - t.ground).toBeGreaterThan(10);
  expect(t.speed).toBeGreaterThan(50);
  expect(t.rescue).toBe(0);
  expect(await page.evaluate(() => window.__game.game.trucks[3].plane)).toBeGreaterThan(2);
  await advance(page, 2.6);
  t = (await trucks(page))[3];
  expect(await page.evaluate(() => window.__game.game.trucks[3].plane)).toBe(0);
  expect(t.y - t.ground).toBeLessThan(0.5);
  expect(Math.abs(t.lat)).toBeLessThan(11);
  expect(t.dist - start.dist).toBeGreaterThan(200);
  expect(t.rescue).toBe(0);
  expect(t.place).toBeLessThan(4);
});

test('fly: raketter, miner, olje og andre trucker påvirker ikke flyet', async ({ page }) => {
  await raceOfFour(page);
  const r = await page.evaluate(() => {
    const g = window.__game.game, t = g.trucks[3];
    g.giveItem(t, 'plane');
    window.__game.advance(1.5);
    g.projectiles.push({ x: t.x, z: t.z, owner: 0, target: 3, age: 0, dir: 0 });
    g.mines.push({ x: t.x, z: t.z, owner: 0, age: 5 });
    g.oils.push({ x: t.x, z: t.z, owner: 0, age: 5, life: 14 });
    g.trucks[0].x = t.x; g.trucks[0].z = t.z;
    window.__game.advance(0.2);
    return { rescue: t.rescue, stun: t.stun, slick: t.slick, speed: t.speed, shield: t.shield };
  });
  expect(r.rescue).toBe(0);
  expect(r.stun).toBe(0);
  expect(r.slick).toBe(0);
  expect(r.speed).toBeGreaterThan(50);
});

test('fly og hjulstyv synkroniseres via snapshot', async ({ page }) => {
  await raceOfFour(page);
  const r = await page.evaluate(async () => {
    const { Game } = await import('/src/game.js');
    const host = window.__game.game;
    host.trucks[0].noWheels = 2.5;
    host.trucks[3].plane = 4;
    const client = new Game(Math.random, 4);
    client.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
    return { nw: client.trucks[0].noWheels, plane: client.trucks[3].plane };
  });
  expect(r.nw).toBe(2.5);
  expect(r.plane).toBe(4);
});

test('AI gir ingen input som hjulløs eller fly', async ({ page }) => {
  await raceOfFour(page);
  const ok = await page.evaluate(async () => {
    const { createAI } = await import('/src/ai.js');
    const g = window.__game.game;
    const ai = createAI(g.seed, 1, 2);
    g.trucks[1].noWheels = 2;
    const a = ai.input(g, 1);
    g.trucks[1].noWheels = 0;
    g.trucks[1].plane = 2;
    const b = ai.input(g, 1);
    return a.throttle === 0 && b.throttle === 0;
  });
  expect(ok).toBe(true);
});
