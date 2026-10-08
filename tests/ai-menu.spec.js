import { test, expect } from '@playwright/test';
import { open, state, advance } from './helpers.js';

// Menyvalg for AI-motstandere: antall og vanskelighetsgrad, og at de blir til trucks i løpet.
const net = (page) => state(page).then((s) => s.net);

test.describe('AI-meny', () => {
  test('standardvalget er én AI-motstander på nivå Middels', async ({ page }) => {
    await open(page, { query: 'ai=1' });
    await expect(page.locator('#ai-count')).toHaveText('AI-motstandere: 1');
    await expect(page.locator('#ai-level')).toHaveText('Vanskelighet: Middels');
  });

  test('tastene N og V endrer antall AI og nivå', async ({ page }) => {
    await open(page, { query: 'ai=0' });
    await page.keyboard.press('KeyP'); // én lokal spiller
    await page.keyboard.press('KeyN');
    await advance(page, 0.05);
    expect((await net(page)).ai).toBe(1);
    await expect(page.locator('#ai-count')).toHaveText('AI-motstandere: 1');
    await page.keyboard.press('KeyV');
    await advance(page, 0.05);
    expect((await net(page)).lvl).toBe(2);
    await expect(page.locator('#ai-level')).toHaveText('Vanskelighet: Vanskelig');
    await page.keyboard.press('KeyV');
    await advance(page, 0.05);
    expect((await net(page)).lvl).toBe(0);
    await expect(page.locator('#ai-level')).toHaveText('Vanskelighet: Lett');
  });

  test('antallet går rundt fra 3 til 0', async ({ page }) => {
    await open(page, { query: 'ai=3' });
    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyN');
    await advance(page, 0.05);
    expect((await net(page)).ai).toBe(0);
  });

  test('løp med én lokal spiller og N AI gir 1+N trucks', async ({ page }) => {
    for (const n of [1, 2, 3]) {
      await open(page, { query: `ai=${n}` });
      await page.keyboard.press('KeyP');
      await page.keyboard.press('Enter');
      await advance(page, 0.05);
      const s = await state(page);
      expect(s.trucks.length).toBe(1 + n);
      expect(s.net.aiSlots).toBe(n);
    }
  });

  test('totalt aldri flere enn 4 trucks', async ({ page }) => {
    await open(page, { query: 'ai=3' }); // to lokale spillere + 3 AI skal trimmes til 4
    await page.keyboard.press('Enter');
    await advance(page, 0.05);
    const s = await state(page);
    expect(s.trucks.length).toBe(4);
    expect(s.net.aiSlots).toBe(2);
  });

  test('AI-trucks kjører fremover og heter Bot', async ({ page }) => {
    await open(page, { query: 'ai=2&lvl=2' });
    await page.keyboard.press('KeyP');
    await page.keyboard.press('Enter');
    await advance(page, 0.05);
    await page.evaluate(() => window.__game.quiet());
    await advance(page, 3.15);
    const before = await state(page);
    await page.evaluate(() => window.__game.simulate(8));
    const after = await state(page);
    expect(after.state).toBe('racing');
    for (const i of [1, 2]) expect(after.trucks[i].dist).toBeGreaterThan(before.trucks[i].dist + 20);
    await expect(page.locator('.vp.vp1 .pname')).toHaveText('Bot 1');
    await expect(page.locator('.vp.vp2 .pname')).toHaveText('Bot 2');
    await expect(page.locator('.vp.vp0 .pname')).toHaveText('Spiller 1');
  });
});
