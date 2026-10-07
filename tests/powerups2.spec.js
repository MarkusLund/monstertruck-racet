import { test, expect } from '@playwright/test';
import { open, advance, startRace } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await open(page);
  await startRace(page);
});

const truck = (page, i) => page.evaluate((i) => window.__game.state().trucks[i], i);

test('skjold tåler ett rakettreff, men ikke to', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game.game, t = g.trucks[0];
    t.vx = t.vz = 0;
    t.shield = 10;
    g.projectiles.push({ x: t.x, z: t.z, owner: 1, target: 0, age: 0, dir: 0 });
  });
  await advance(page, 0.1);
  let t = await truck(page, 0);
  expect(t.rescue).toBe(0);
  expect(t.shield).toBe(0);
  // Neste rakett treffer uten skjold.
  await page.evaluate(() => {
    const g = window.__game.game, t = g.trucks[0];
    g.projectiles.push({ x: t.x, z: t.z, owner: 1, target: 0, age: 0, dir: 0 });
  });
  await advance(page, 0.1);
  t = await truck(page, 0);
  expect(t.rescue).toBeGreaterThan(0);
});

test('skjoldet vises i HUD', async ({ page }) => {
  await page.evaluate(() => { window.__game.game.trucks[0].shield = 8; });
  await advance(page, 0.05);
  await expect(page.locator('#fx-0')).toContainText('Skjold');
});

test('oljeflekk gir sladd (mistet grep), og effekten går over', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game.game, t = g.trucks[0];
    t.vx = t.vz = 0;
    g.oils.push({ x: t.x, z: t.z, owner: 1, age: 5, life: 14 });
  });
  await advance(page, 0.1);
  expect((await truck(page, 0)).slick).toBeGreaterThan(0.5);
  await page.evaluate(() => { window.__game.game.oils = []; });
  await advance(page, 2);
  expect((await truck(page, 0)).slick).toBe(0);
});

test('mine: kan hoppes over, stunner ved treff, og skjold tar den', async ({ page }) => {
  // Hopp over: trucken er høyt oppe.
  await page.evaluate(async () => {
    const { groundHeight } = await import('/src/terrain.js');
    const g = window.__game.game, t = g.trucks[0];
    t.vx = t.vz = 0;
    g.mines.push({ x: t.x, z: t.z, owner: 1, age: 5 });
    t.air = true; t.y = groundHeight(t.x, t.z) + 3; t.vy = 0; // 3 over bakken
  });
  await advance(page, 0.02);
  expect((await page.evaluate(() => window.__game.state())).mines).toBe(1);
  // Lander på minen.
  await advance(page, 1);
  let s = await page.evaluate(() => window.__game.state());
  expect(s.mines).toBe(0);
  expect(s.trucks[0].stun).toBeGreaterThan(0);
  // Skjold tar neste mine.
  await page.evaluate(() => {
    const g = window.__game.game, t = g.trucks[1];
    t.vx = t.vz = 0;
    t.shield = 5;
    g.mines.push({ x: t.x, z: t.z, owner: 0, age: 5 });
  });
  await advance(page, 0.1);
  s = await page.evaluate(() => window.__game.state());
  expect(s.mines).toBe(0);
  expect(s.trucks[1].stun).toBe(0);
  expect(s.trucks[1].shield).toBe(0);
});

test('eieren er trygg for egen mine rett etter at den er sluppet', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game.game, t = g.trucks[0];
    t.vx = t.vz = 0;
    g.mines.push({ x: t.x, z: t.z, owner: 0, age: 0 });
  });
  await advance(page, 0.2);
  const s = await page.evaluate(() => window.__game.state());
  expect(s.mines).toBe(1);
  expect(s.trucks[0].stun).toBe(0);
});

test('comeback: de bakerste får sterke ting, lederen svake', async ({ page }) => {
  const { leader: L, last: B } = await page.evaluate(async () => {
    const { pickItem } = await import('/src/powerups.js');
    const { mulberry } = await import('/src/game.js');
    const tally = (rank) => {
      const rand = mulberry(42), c = { turbo: 0, shield: 0, rocket: 0, barricade: 0, oil: 0, mine: 0 };
      for (let i = 0; i < 4000; i++) c[pickItem(rank, rand())]++;
      return c;
    };
    return { leader: tally(0), last: tally(1) };
  });
  expect(L.rocket).toBe(0);
  expect(L.barricade).toBe(0);
  expect(L.oil + L.mine).toBeGreaterThan(L.turbo + L.shield);
  expect(B.rocket + B.shield).toBeGreaterThan(B.oil + B.mine);
  expect(B.rocket).toBeGreaterThan(B.oil * 3);
});

test('giveItem vekter etter plassering (host)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const g = window.__game.game;
    g.start(4);
    g.trucks.forEach((t, i) => { t.dist = 100 - i * 10; });
    const count = (idx) => {
      const c = { rocket: 0, shield: 0, oil: 0, mine: 0 };
      for (let i = 0; i < 300; i++) {
        g.events = [];
        g.giveItem(g.trucks[idx]);
        const it = g.events.find((e) => e.type === 'item').item;
        if (it in c) c[it]++;
      }
      return c;
    };
    return { leader: count(0), last: count(3) };
  });
  expect(r.leader.rocket).toBe(0);
  expect(r.last.rocket + r.last.shield).toBeGreaterThan(r.leader.rocket + r.leader.shield);
  expect(r.leader.oil + r.leader.mine).toBeGreaterThan(r.last.oil + r.last.mine);
});

test('olje og miner synkroniseres via snapshot til klienter', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { Game } = await import('/src/game.js');
    const host = window.__game.game;
    host.oils.push({ x: 12.34, z: -5.6, owner: 0, age: 0, life: 9.5 });
    host.mines.push({ x: 1.5, z: 2.5, owner: 1, age: 0 });
    const client = new Game(Math.random, host.trucks.length);
    client.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
    return { oils: client.oils, mines: client.mines };
  });
  expect(r.oils).toEqual([{ x: 12.3, z: -5.6, life: 9.5 }]);
  expect(r.mines).toEqual([{ x: 1.5, z: 2.5 }]);
});
