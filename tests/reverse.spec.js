import { test, expect } from '@playwright/test';
import { open, advance } from './helpers.js';

test('trucken kan rygge og hoppe', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__game.game.start(1));
  await advance(page, 3.5);
  const r = await page.evaluate(() => {
    const g = window.__game.game, t = g.trucks[0];
    const run = (inp, n) => { for (let i = 0; i < n; i++) g.step([inp]); };
    run({ throttle: 1, steer: 0 }, 60);
    const fwd = t.speed;
    run({ throttle: 0, steer: 0, brake: 1 }, 120);
    const vf = t.vx * Math.cos(t.theta) + t.vz * Math.sin(t.theta);
    run({ throttle: 0, steer: 0, jump: true }, 1);
    const up = t.air;
    run({ throttle: 0, steer: 0 }, 90);
    return { fwd, vf, up, landed: !t.air };
  });
  expect(r.fwd).toBeGreaterThan(10);
  expect(r.vf).toBeLessThan(-5);
  expect(r.up).toBe(true);
  expect(r.landed).toBe(true);
});
