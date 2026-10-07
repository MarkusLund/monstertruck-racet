import { test, expect } from '@playwright/test';
import { open, startRace, advance, teleport, state } from './helpers.js';

test('boost-pads er deterministiske fra bane-seed', async ({ page }) => {
  await open(page);
  const a = await page.evaluate(() => {
    const { Game } = window.__game.game.constructor === Object ? {} : { Game: window.__game.game.constructor };
    const g1 = new Game(Math.random, 2), g2 = new Game(Math.random, 2);
    g1.newRace(1234); g2.newRace(1234);
    return { same: JSON.stringify(g1.track.pads) === JSON.stringify(g2.track.pads), n: g1.track.pads.length };
  });
  expect(a.same).toBe(true);
  expect(a.n).toBeGreaterThanOrEqual(2);
});

test('kjører man over en boost-pad får man turbo og blir raskere', async ({ page }) => {
  await open(page);
  await startRace(page, { quiet: false });
  const pad = await page.evaluate(() => window.__game.game.track.pads[2]);
  await page.evaluate(() => window.__game.game.boxes.forEach((b) => { b.cooldown = 1e9; }));
  await teleport(page, 0, pad.s - 12, pad.lat);
  await page.evaluate(() => { const t = window.__game.game.trucks[0]; t.vx = Math.cos(t.theta) * 25; t.vz = Math.sin(t.theta) * 25; });
  const before = (await state(page)).trucks[0];
  expect(before.turbo).toBe(0);
  let sawTurbo = 0;
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => { window.__game.game.trucks[0].step({ throttle: 1, steer: 0, brake: 0, jump: false }, 1 / 60, window.__game.game.track, false); window.__game.game.afterStep(window.__game.game.trucks[0]); });
    sawTurbo = Math.max(sawTurbo, (await state(page)).trucks[0].turbo);
  }
  expect(sawTurbo).toBeGreaterThan(1);
  const after = (await state(page)).trucks[0];
  expect(after.speed).toBeGreaterThan(before.speed);
});

test('pad påvirker ikke trucker som ikke er på den', async ({ page }) => {
  await open(page);
  await startRace(page, { quiet: false });
  const pad = await page.evaluate(() => window.__game.game.track.pads[2]);
  await teleport(page, 0, pad.s - 12, pad.lat > 0 ? pad.lat - 7 : pad.lat + 7);
  await advance(page, 0.2);
  expect((await state(page)).trucks[0].turbo).toBe(0);
});

test('rampe gir lufthopp, og mer fart gir lengre hopp', async ({ page }) => {
  await open(page);
  await startRace(page, { quiet: false });
  const fly = (speed) => page.evaluate((speed) => {
    const g = window.__game, t = g.game.trucks[0];
    g.game.boxes.forEach((b) => { b.cooldown = 1e9; });
    const j = g.game.track.jumps[0];
    g.teleport(0, j.s0 - 8, 0, 0);
    t.vx = Math.cos(t.theta) * speed; t.vz = Math.sin(t.theta) * speed;
    let maxY = 0, airTime = 0, took = false;
    for (let i = 0; i < 240; i++) {
      t.step({ throttle: 1, steer: 0, brake: 0, jump: false }, 1 / 60, g.game.track, false);
      maxY = Math.max(maxY, t.y);
      if (t.air) { airTime += 1 / 60; took = true; } else if (took) break;
    }
    return { maxY, airTime, took };
  }, speed);
  const slow = await fly(14);
  const fast = await fly(38);
  expect(fast.took).toBe(true);
  expect(fast.maxY).toBeGreaterThan(2.5);
  expect(fast.airTime).toBeGreaterThan(slow.airTime);
  expect(fast.maxY).toBeGreaterThan(slow.maxY);
});
