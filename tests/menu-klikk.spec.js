import { test, expect } from '@playwright/test';
import { open, advance, state } from './helpers.js';

// Menyvalg kan også klikkes med musepila.
test.describe('Meny med mus', () => {
  test('klikk slår spiller 2 av/på og endrer AI-antall, nivå og ekstra kontrollere', async ({ page }) => {
    await open(page, { query: 'ai=0' });
    await page.click('#ctl-p2');
    await advance(page, 0.05);
    await expect(page.locator('#ctl-p2')).toHaveClass(/off/);
    await page.click('#ai-count');
    await advance(page, 0.05);
    await expect(page.locator('#ai-count')).toHaveText('AI-motstandere: 1');
    await page.click('#ai-level');
    await advance(page, 0.05);
    expect((await state(page)).net.lvl).toBe(2);
    await page.click('#pads-extra');
    await advance(page, 0.05);
    await expect(page.locator('#pads-extra')).toHaveText('Ekstra kontrollere: av');
  });
});
