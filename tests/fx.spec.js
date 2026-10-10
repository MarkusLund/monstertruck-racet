import { test, expect } from '@playwright/test';
import { mockGamepads, open, state, advance, startRace, teleport } from './helpers.js';

const fxState = (page) => page.evaluate(() => {
  const fx = window.__game.renderer.fx;
  return { hits: fx.stats.hits, bumps: fx.stats.bumps, live: fx.live, trauma: [...fx.trauma], kick: [...fx.kick], scale: fx.timeScale };
});

// Effektene oppdateres når det tegnes (én gang per advance), så her simuleres og tegnes hvert steg.
const run = (page, seconds) => page.evaluate((seconds) => {
  const g = window.__game, fx = g.renderer.fx;
  for (let i = 0; i < Math.round(seconds * 60); i++) { g.simulate(1 / 60); fx.update(g.game, 1 / 60); }
}, seconds);

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.__errors = errors;
  await mockGamepads(page);
});

test.afterEach(async ({ page }) => {
  expect(page.__errors, 'ingen JavaScript-feil').toEqual([]);
});

test.describe('Treff og effekter', () => {
  test('rakettreff: eksplosjon, rist og zoom bare for den som ble truffet, og sakte-film som tar slutt', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.evaluate(() => {
      const g = window.__game.game, t = g.trucks[0];
      g.projectiles.push({ x: t.x, z: t.z, owner: 1, target: 0, age: 0, dir: t.theta });
    });
    await advance(page, 0.05);
    const hit = await fxState(page);
    expect(hit.hits).toBe(1);
    expect(hit.live).toBeGreaterThan(20);
    expect(hit.trauma[0]).toBeGreaterThan(0.7);
    expect(hit.trauma[1]).toBe(0);
    expect(hit.kick[0]).toBeGreaterThan(0.5);
    expect(hit.kick[1]).toBe(0);
    expect(hit.scale).toBeLessThan(1);
    // Fysikken (verten) går i vanlig fart: redningen telles ned i simulerte sekunder, ikke i sakte-film.
    expect((await state(page)).trucks[0].rescue).toBeGreaterThan(0);
    await run(page, 3);
    const after = await fxState(page);
    expect(after.trauma[0]).toBe(0);
    expect(after.scale).toBe(1);
    expect(after.live).toBe(0);
    expect((await state(page)).trucks[0].rescue).toBe(0);
  });

  test('kollisjon: gnister og rist skalert med støtstyrke, begge trucker rister', async ({ page }) => {
    await open(page);
    await startRace(page);
    const small = await page.evaluate(() => {
      const g = window.__game.game, fx = window.__game.renderer.fx;
      fx.onEvent({ type: 'bump', truck: 0, other: 1, power: 6 }, g);
      return [...fx.trauma];
    });
    await run(page, 3);
    const big = await page.evaluate(() => {
      const g = window.__game.game, fx = window.__game.renderer.fx;
      fx.onEvent({ type: 'bump', truck: 0, other: 1, power: 25 }, g);
      const trauma = [...fx.trauma];
      fx.update(g, 0.001);
      return { trauma, live: fx.live };
    });
    expect(small[0]).toBeGreaterThan(0);
    expect(small[1]).toBeGreaterThan(0);
    expect(big.trauma[0]).toBeGreaterThan(small[0] + 0.2);
    expect(big.live).toBeGreaterThan(10);
    await advance(page, 0.1);
  });

  test('ekte truckkollisjon gir bump-event med støtstyrke', async ({ page }) => {
    await open(page);
    await startRace(page);
    await teleport(page, 0, 60, 0);
    await teleport(page, 1, 66, 0);
    await page.evaluate(() => {
      const g = window.__game.game, [a, b] = g.trucks;
      a.vx = Math.cos(a.theta) * 20; a.vz = Math.sin(a.theta) * 20;
      b.vx = -Math.cos(a.theta) * 5; b.vz = -Math.sin(a.theta) * 5;
      window.__seen = [];
      const emit = g.emit.bind(g);
      g.emit = (e) => { if (e.type === 'bump') window.__seen.push(e); emit(e); };
    });
    await advance(page, 0.5);
    const seen = await page.evaluate(() => window.__seen);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].power).toBeGreaterThan(5);
    expect(seen[0].other).toBe(1);
    expect((await fxState(page)).bumps).toBeGreaterThan(0);
  });

  test('støv fra hjulene i fart, og effektene gir ingen feil når man kjører av banen', async ({ page }) => {
    await open(page);
    await startRace(page);
    await teleport(page, 0, 40, 0);
    await page.keyboard.down('s');
    await run(page, 1.5);
    expect((await fxState(page)).live).toBeGreaterThan(3);
    await page.evaluate(() => { window.__game.teleport(0, 300, 14); });
    await run(page, 1.5);
    expect((await fxState(page)).live).toBeGreaterThan(5);
    await page.keyboard.up('s');
  });

  test('partikkelpoolen er begrenset: mange eksplosjoner gir ingen feil', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.evaluate(() => {
      const g = window.__game.game, fx = window.__game.renderer.fx;
      for (let i = 0; i < 60; i++) fx.onEvent({ type: 'hit', truck: i % 2, cause: 'rocket', shielded: false }, g);
      for (const cause of ['rocket', 'shield', 'spin']) fx.onEvent({ type: 'hit', truck: 0, cause, shielded: true }, g);
      fx.onEvent({ type: 'land', truck: 1 }, g);
    });
    await advance(page, 0.5);
    expect((await fxState(page)).live).toBeLessThanOrEqual(1400);
  });
});

test.describe('Rekorder', () => {
  const finishRace = async (page) => {
    await startRace(page);
    const L = await page.evaluate(() => window.__game.game.track.length);
    await teleport(page, 0, L - 12, 0, 2);
    await page.keyboard.down('s');
    for (let i = 0; i < 20 && (await state(page)).state === 'racing'; i++) await advance(page, 0.5);
    await page.keyboard.up('s');
    expect((await state(page)).state).toBe('finished');
  };

  test('første løp lagrer rekord og viser NY REKORD!, treigere løp gjør ikke det', async ({ page }) => {
    await open(page);
    await finishRace(page);
    await expect(page.locator('#record-text')).toHaveText('NY REKORD!');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('monstertruck.records.v1')));
    expect(saved.best).toBeGreaterThan(0);
    expect(Object.keys(saved.seeds).length).toBe(1);
    await expect(page.locator('#best')).toContainText('Rekord:');
    await expect(page.locator('#best-time')).toContainText('Rekord:');

    // Et nytt løp med ny bane og en umulig rask tidligere rekord: ingen ny rekord.
    await page.evaluate(() => localStorage.setItem('monstertruck.records.v1', JSON.stringify({ best: 0.1, seeds: {} })));
    await page.keyboard.press('Escape');
    await advance(page, 0.1);
    await finishRace(page);
    await expect(page.locator('#record-text')).toBeHidden();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('monstertruck.records.v1')));
    expect(after.best).toBe(0.1);
  });

  test('lagret rekord vises i HUD ved oppstart', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('monstertruck.records.v1', JSON.stringify({ best: 83.4, seeds: {} })));
    await open(page);
    await expect(page.locator('#best')).toHaveText('Rekord: 1:23.4');
  });

  test('ødelagt JSON i localStorage gir ingen feil', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('monstertruck.records.v1', '{not json'));
    await open(page);
    await expect(page.locator('#best')).toHaveText('');
    await finishRace(page);
    await expect(page.locator('#record-text')).toHaveText('NY REKORD!');
  });

  test('blokkert localStorage gir ingen feil', async ({ page }) => {
    await page.addInitScript(() => {
      const boom = () => { throw new Error('blokkert'); };
      Storage.prototype.getItem = boom;
      Storage.prototype.setItem = boom;
    });
    await open(page);
    await finishRace(page);
    await expect(page.locator('#winner-time')).toContainText('Tid:');
  });
});
