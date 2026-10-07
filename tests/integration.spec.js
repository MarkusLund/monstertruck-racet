import { test, expect } from '@playwright/test';
import { open, startRace, mockGamepads } from './helpers.js';

// Alt på en gang: terreng, boost-pads, ramper, olje/miner og effekter i et vanlig løp, uten JS-feil.
test('integrasjon: løp med terreng, pads, olje, miner og effekter kjører uten feil', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
  await mockGamepads(page);
  await open(page);
  await page.evaluate(() => { window.__pads.connect(0); window.__pads.connect(1); });
  await startRace(page, { quiet: false });

  const r = await page.evaluate(async () => {
    const { groundHeight, clearance } = await import('/src/terrain.js');
    const g = window.__game, game = g.game, { track } = game;
    // Legg olje og en mine rett foran begge truckene.
    game.trucks.forEach((t) => {
      const ahead = { x: t.x + Math.cos(t.theta) * 25, z: t.z + Math.sin(t.theta) * 25 };
      game.oils.push({ ...ahead, owner: 9, age: 5, life: 14 });
      game.mines.push({ x: ahead.x + Math.cos(t.theta) * 12, z: ahead.z + Math.sin(t.theta) * 12, owner: 9, age: 5 });
    });
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const hits0 = g.renderer.fx.stats.hits;
    let maxParticles = 0, minClearance = Infinity;
    for (let frame = 0; frame < 60 * 8; frame++) {
      game.trucks.forEach((t, i) => {
        const target = track.pts[(t.nearest.index + 9) % track.count];
        window.__pads.axis(i, 0, Math.max(-1, Math.min(1, wrap(Math.atan2(target.z - t.z, target.x - t.x) - t.theta) * 2.2)));
        window.__pads.set(i, 7, 1);
        if (!t.air) minClearance = Math.min(minClearance, clearance(t));
      });
      g.advance(1 / 60); // tegner hver ramme: render, fx og HUD kjøres
      maxParticles = Math.max(maxParticles, g.renderer.fx.live);
    }
    const t = game.trucks[0];
    return {
      state: game.state,
      pads: track.pads.length,
      padsOnGround: track.pads.every((p) => Math.abs(p.y - groundHeight(p.x, p.z)) < 1e-6),
      hilly: track.pts.some((p) => Math.abs(groundHeight(p.x, p.z)) > 0.5),
      dist: t.dist,
      hits: g.renderer.fx.stats.hits - hits0, maxParticles, minClearance,
      snapshot: Object.keys(game.snapshot()),
    };
  });

  expect(errors).toEqual([]);
  expect(r.state).toBe('racing');
  expect(r.pads).toBeGreaterThan(0);
  expect(r.padsOnGround).toBe(true);
  expect(r.hilly).toBe(true);
  expect(r.dist).toBeGreaterThan(100);
  expect(r.hits).toBeGreaterThan(0); // minene ble truffet
  expect(r.maxParticles).toBeGreaterThan(0);
  expect(Math.abs(r.minClearance)).toBeLessThan(0.3); // trucken kjører på terrenget, ikke under eller over
  expect(r.snapshot).toEqual(expect.arrayContaining(['oi', 'mi']));
});
