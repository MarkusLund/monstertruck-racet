import { test, expect } from '@playwright/test';
import { open, advance, state, startRace, teleport } from './helpers.js';

test('terrenget varierer, er deterministisk og veien er slak', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { groundHeight } = await import('/src/terrain.js');
    const g = window.__game.game;
    const pts = g.track.pts;
    let rMin = Infinity, rMax = -Infinity, oMin = Infinity, oMax = -Infinity, maxStep = 0, prev = null;
    for (let i = 0; i < pts.length; i++) {
      const h = groundHeight(pts[i].x, pts[i].z);
      rMin = Math.min(rMin, h); rMax = Math.max(rMax, h);
      if (prev !== null) maxStep = Math.max(maxStep, Math.abs(h - prev));
      prev = h;
      const o = groundHeight(pts[i].x + pts[i].nx * 40, pts[i].z + pts[i].nz * 40);
      oMin = Math.min(oMin, o); oMax = Math.max(oMax, o);
    }
    const a = [groundHeight(10, 20), groundHeight(-80, 33)];
    g.newRace(g.seed);
    const b = [groundHeight(10, 20), groundHeight(-80, 33)];
    return { road: rMax - rMin, off: oMax - oMin, maxStep, same: a[0] === b[0] && a[1] === b[1] };
  });
  expect(r.road).toBeGreaterThan(0.5);
  expect(r.off).toBeGreaterThan(r.road);
  expect(r.maxStep / 2).toBeLessThan(0.45); // maks stigning langs veien
  expect(r.same).toBe(true);
});

test('trucken følger bakken', async ({ page }) => {
  await open(page);
  await startRace(page);
  await page.keyboard.down('w');
  let gap = 0, dist = 0;
  const ys = new Set();
  for (let i = 0; i < 40; i++) {
    await advance(page, 0.25);
    const t = (await state(page)).trucks[0];
    if (!t.air) gap = Math.max(gap, Math.abs(t.y - t.ground));
    ys.add(Math.round(t.y * 10));
    dist = t.dist;
  }
  await page.keyboard.up('w');
  expect(dist).toBeGreaterThan(100);
  expect(ys.size).toBeGreaterThan(3); // høyden endrer seg underveis
  expect(gap).toBeLessThan(0.01);
});

test('hopp gir fortsatt luft, relativt til bakken', async ({ page }) => {
  await open(page);
  await startRace(page);
  await teleport(page, 0, 300, 0);
  await advance(page, 0.5);
  expect((await state(page)).trucks[0].air).toBe(false);
  await page.keyboard.down('Space');
  await advance(page, 0.05);
  await page.keyboard.up('Space');
  let maxUp = 0, wasAir = false;
  for (let i = 0; i < 20; i++) {
    await advance(page, 0.05);
    const t = (await state(page)).trucks[0];
    if (t.air) wasAir = true;
    maxUp = Math.max(maxUp, t.y - t.ground);
  }
  await advance(page, 1);
  const after = (await state(page)).trucks[0];
  expect(wasAir).toBe(true);
  expect(maxUp).toBeGreaterThan(2.5);
  expect(after.air).toBe(false);
  expect(after.y).toBeCloseTo(after.ground, 2);
});

test('høyde over bakken brukes, ikke absolutt y', async ({ page }) => {
  await open(page);
  await startRace(page);
  const r = await page.evaluate(async () => {
    const { clearance } = await import('/src/game.js');
    const { groundHeight } = await import('/src/terrain.js');
    const g = window.__game.game;
    const t = g.trucks[0];
    // Finn et punkt der bakken er høyt over null og stå der med lav høyde over bakken.
    const hill = g.track.pts.map((p) => ({ x: p.x + p.nx * 14, z: p.z + p.nz * 14 })).reduce((a, b) => (groundHeight(b.x, b.z) > groundHeight(a.x, a.z) ? b : a));
    t.x = hill.x; t.z = hill.z; t.y = groundHeight(hill.x, hill.z) + 0.2;
    return { ground: groundHeight(hill.x, hill.z), c: clearance(t) };
  });
  expect(r.ground).toBeGreaterThan(1.2);
  expect(r.c).toBeCloseTo(0.2, 3);
});
