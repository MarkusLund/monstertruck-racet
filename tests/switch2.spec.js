import { test, expect } from '@playwright/test';
import { mockGamepads, open, startRace, advance, state, padSet, BTN } from './helpers.js';

const SWITCH_ID = 'Pro Controller 2 (Vendor: 057e Product: 2069)';

test.describe('Switch 2-kontrollere og opptil fire lokale spillere', () => {
  test('fire kontrollere gir fire lokale spillere, én per spiller', async ({ page }) => {
    await mockGamepads(page);
    await open(page);
    await page.evaluate((id) => {
      window.__pads.connect(0);
      window.__pads.connect(1);
      window.__pads.connect(2, { id });
      window.__pads.connect(3, { id });
    }, SWITCH_ID);
    await advance(page, 0.1);
    await expect(page.locator('#pad-status-2')).toContainText('Switch 2 tilkoblet');
    await expect(page.locator('#pad-status-3')).toContainText('Switch 2 tilkoblet');
    await startRace(page);
    const s = await state(page);
    expect(s.trucks).toHaveLength(4);
    // Spiller 4 gasser med sin egen kontroller (R2) og de andre står stille.
    await padSet(page, 3, BTN.R2, 1);
    await advance(page, 1.5);
    const t = (await state(page)).trucks;
    expect(t[3].speed).toBeGreaterThan(2);
    expect(t[2].speed).toBeLessThan(0.5);
  });

  test('Switch 2 uten standard mapping: ZR gasser, hat-bryteren styrer og A bekrefter', async ({ page }) => {
    await mockGamepads(page);
    await open(page);
    await page.evaluate((id) => {
      window.__pads.connect(0, { id, mapping: '', axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] });
    }, SWITCH_ID);
    await advance(page, 0.1);
    await expect(page.locator('#pad-status-0')).toContainText('Switch 2 tilkoblet');
    await padSet(page, 0, 1, 1); // A
    await advance(page, 0.1);
    await padSet(page, 0, 1, 0);
    expect((await state(page)).state).not.toBe('menu');
  });
});
