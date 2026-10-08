import { test, expect } from '@playwright/test';
import { mockGamepads, open, state } from './helpers.js';

// Sanntid: spillet går av seg selv. (Headless Chromium rendrer med programvare og er tregt, derfor romslig grense.)
test('sanntid: nedtellingen går av seg selv og spillet kommer i gang', async ({ page }) => {
  await mockGamepads(page);
  await open(page, { manual: false });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).state, { timeout: 40000 }).toBe('racing');
  await page.keyboard.down('s');
  const t0 = (await state(page)).trucks[0].dist;
  await expect.poll(async () => (await state(page)).trucks[0].dist, { timeout: 20000 }).toBeGreaterThan(t0 + 10);
  await page.keyboard.up('s');
});
