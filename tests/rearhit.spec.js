import { test, expect } from '@playwright/test';
import { open, advance } from './helpers.js';

test('rammer man rumpa, spinner den foran', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__game.game.start(2));
  await advance(page, 4);
  const r = await page.evaluate(() => {
    const [a, b] = window.__game.game.trucks;
    b.x = a.x - Math.cos(a.theta) * 3.5; b.z = a.z - Math.sin(a.theta) * 3.5; b.theta = a.theta; b.y = a.y;
    a.vx = a.vz = 0;
    b.vx = Math.cos(a.theta) * 20; b.vz = Math.sin(a.theta) * 20;
    window.__game.game.collideTrucks();
    return { a: a.spin, b: b.spin, stun: a.stun };
  });
  expect(r.a).toBeGreaterThan(0);
  expect(r.b).toBe(0);
  expect(r.stun).toBe(0);
});
