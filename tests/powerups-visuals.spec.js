import { test, expect } from '@playwright/test';
import { open, startRace, advance } from './helpers.js';

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.__errors = errors;
});

test.afterEach(async ({ page }) => {
  expect(page.__errors, 'ingen JavaScript-feil').toEqual([]);
});

test.describe('Hjulstyv og fly: visning og lyd', () => {
  test('hjulløs truck skjuler hjulene og fly vises med skygge, og alt tegnes uten feil', async ({ page }) => {
    await open(page);
    await startRace(page);
    await advance(page, 0.2);
    const r = await page.evaluate(() => {
      const { game, renderer: r } = window.__game;
      const m = r.trucks[0], p = r.trucks[1];
      const out = {};
      game.trucks[0].noWheels = 3;
      game.trucks[1].plane = 4;
      game.trucks[1].y += 12;
      for (let k = 0; k < 60; k++) window.__game.advance(1 / 60); // hjulene flyr av i løpet av under et sekund
      out.wheelsHidden = m.wheels.every((w) => !w.visible);
      out.chassisShown = m.chassis.visible;
      out.planeShown = p.plane.visible;
      out.shadowShown = p.shadow.visible;
      out.chassisHidden = !p.chassis.visible;
      game.trucks[0].noWheels = 0;
      game.trucks[1].plane = 0;
      window.__game.advance(1 / 60);
      out.restored = m.wheels.every((w) => w.visible) && !p.plane.visible && p.chassis.visible;
      return out;
    });
    expect(r).toEqual({ wheelsHidden: true, chassisShown: true, planeShown: true, shadowShown: true, chassisHidden: true, restored: true });
  });

  test('lydhendelser og propell for hjulstyv og fly kaster ikke', async ({ page }) => {
    await open(page);
    await startRace(page);
    const r = await page.evaluate(() => {
      const { game, sound } = window.__game;
      sound.unlock();
      if (!sound.ctx) return { skipped: true };
      const frames = (n) => { for (let k = 0; k < n; k++) sound.update(1 / 60, game, { listeners: [0], pans: [-0.5, 0.5], throttle: [] }); };
      game.trucks[1].plane = 3;
      for (const e of [
        { type: 'item', truck: 0, item: 'wheelloss' }, { type: 'item', truck: 1, item: 'plane' },
        { type: 'hit', truck: 0, cause: 'wheelloss' }, { type: 'hit', truck: 1, cause: 'wheelloss' },
      ]) sound.event(e);
      frames(30);
      game.trucks[1].plane = 0;
      frames(30);
      return { failed: sound.failed };
    });
    if (!r.skipped) expect(r.failed).toBe(0);
  });

  test('HUD-teksten er på norsk mens hjulstyv og fly er aktive', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.evaluate(() => {
      const { game } = window.__game;
      game.trucks[0].noWheels = 2;
      game.trucks[1].plane = 3;
    });
    await advance(page, 0.5);
    const text = await page.locator('body').innerText();
    for (const english of ['Wheel', 'Plane', 'Player', 'Lap']) expect(text).not.toContain(english);
    await expect(page.locator('.vp0')).toContainText('Spiller 1');
  });
});
