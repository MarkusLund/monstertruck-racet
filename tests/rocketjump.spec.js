import { test, expect } from '@playwright/test';
import { open, advance } from './helpers.js';

test('rakett: varsel bakfra, og man kan hoppe over den', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__game.game.start(2));
  await advance(page, 4);
  // Rakett 40 enheter bak lokal spiller 1 (truck 0).
  await page.evaluate(() => {
    const g = window.__game.game, t = g.trucks[0];
    g.projectiles.push({ x: t.x - Math.cos(t.theta) * 40, z: t.z - Math.sin(t.theta) * 40, owner: 1, target: 0, age: 0, dir: t.theta });
  });
  await advance(page, 0.05);
  await expect(page.locator('#rw-0')).toContainText('BAKFRA');
  // Hopp og la raketten passere.
  await page.evaluate(() => { window.__game.game.trucks[0].vx = window.__game.game.trucks[0].vz = 0; });
  const r = await page.evaluate(() => {
    const t = window.__game.game.trucks[0]; t.air = true; t.vy = 14; t.y += 0.5; return 1;
  });
  await advance(page, 1.2);
  const s = await page.evaluate(() => ({ stun: window.__game.game.trucks[0].stun }));
  expect(s.stun).toBe(0);
});
