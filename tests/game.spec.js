import { test, expect } from '@playwright/test';
import { BTN, mockGamepads, open, state, advance, startRace, padSet, padAxis, teleport, driveAll } from './helpers.js';

const L = (page) => page.evaluate(() => window.__game.game.track.length);

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.__errors = errors;
  await mockGamepads(page);
});

test.afterEach(async ({ page }) => {
  expect(page.__errors, 'ingen JavaScript-feil').toEqual([]);
});

test.describe('Startskjerm', () => {
  test('viser kontrollene (gass og sving) på norsk', async ({ page }) => {
    await open(page);
    const menu = page.locator('#menu');
    await expect(menu).toBeVisible();
    for (const w of ['MONSTERTRUCK', 'Spiller 1', 'Spiller 2', 'Gass', 'Sving', 'DualSense', 'Tastatur', 'R2', 'for å starte']) {
      await expect(menu).toContainText(w);
    }
    for (const w of ['Revers', 'Hopp']) await expect(menu).not.toContainText(w);
    const p1 = page.locator('#menu .ctl.p1');
    const p2 = page.locator('#menu .ctl.p2');
    for (const k of ['W', 'A', 'D']) await expect(p1.locator('kbd', { hasText: new RegExp(`^${k}$`) })).toHaveCount(1);
    for (const k of ['↑', '←', '→']) await expect(p2.locator('kbd', { hasText: k })).toHaveCount(1);
    expect((await state(page)).state).toBe('menu');
  });

  test('viser tilkoblede kontrollere', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__pads.connect(0); window.__pads.connect(1); });
    await advance(page, 0.05);
    await expect(page.locator('#pad-status-0')).toContainText('DualSense tilkoblet');
    await expect(page.locator('#pad-status-1')).toContainText('DualSense tilkoblet');
  });

  for (const key of ['Enter', 'Space']) {
    test(`kan startes fra tastaturet (${key})`, async ({ page }) => {
      await open(page);
      await page.keyboard.press(key);
      await advance(page, 0.1);
      expect((await state(page)).state).toBe('countdown');
      await expect(page.locator('#menu')).toBeHidden();
      await advance(page, 3.1);
      expect((await state(page)).state).toBe('racing');
    });
  }

  for (const [name, btn] of [['✕', BTN.CROSS], ['Options', BTN.OPTIONS]]) {
    test(`kan startes fra kontrolleren (${name})`, async ({ page }) => {
      await open(page);
      await page.evaluate(() => window.__pads.connect(1));
      await advance(page, 0.1);
      await padSet(page, 1, btn, 1);
      await advance(page, 0.1);
      await padSet(page, 1, btn, 0);
      expect((await state(page)).state).toBe('countdown');
    });
  }

  test('starter i sanntid (uten test-modus) og trucken kjører', async ({ page }) => {
    await open(page, { manual: false });
    await page.keyboard.press('Enter');
    // Headless Chromium rendrer med programvare og er tregt, så grensene er romslige.
    await expect.poll(async () => (await state(page)).state, { timeout: 40000 }).toBe('racing');
    const d0 = (await state(page)).trucks[0].dist;
    await page.keyboard.down('w');
    await expect.poll(async () => (await state(page)).trucks[0].dist, { timeout: 20000 }).toBeGreaterThan(d0 + 5);
    await page.keyboard.up('w');
  });
});

test.describe('Styring (kun gass og sving)', () => {
  test('truckene står stille under nedtellingen', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Enter');
    await page.keyboard.down('w');
    await advance(page, 2);
    await page.keyboard.up('w');
    const s = await state(page);
    expect(s.state).toBe('countdown');
    expect(s.trucks[0].speed).toBeLessThan(0.2);
  });

  test('spiller 1 gasser med W uten å påvirke spiller 2', async ({ page }) => {
    await open(page);
    await startRace(page);
    const s0 = await state(page);
    await page.keyboard.down('w');
    await advance(page, 2);
    await page.keyboard.up('w');
    const s1 = await state(page);
    expect(s1.trucks[0].dist).toBeGreaterThan(s0.trucks[0].dist + 15);
    expect(s1.trucks[1].speed).toBeLessThan(0.2);
  });

  test('spiller 2 gasser med ↑ uten å påvirke spiller 1', async ({ page }) => {
    await open(page);
    await startRace(page);
    const s0 = await state(page);
    await page.keyboard.down('ArrowUp');
    await advance(page, 2);
    await page.keyboard.up('ArrowUp');
    const s1 = await state(page);
    expect(s1.trucks[1].dist).toBeGreaterThan(s0.trucks[1].dist + 15);
    expect(s1.trucks[0].speed).toBeLessThan(0.2);
  });

  test('uten gass blir trucken stående, og den ruller ut når man slipper', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.keyboard.down('w');
    await advance(page, 2);
    await page.keyboard.up('w');
    const fast = (await state(page)).trucks[0].speed;
    await advance(page, 6);
    expect((await state(page)).trucks[0].speed).toBeLessThan(fast * 0.5);
  });

  test('A svinger til venstre og D til høyre (spiller 1)', async ({ page }) => {
    await open(page);
    await startRace(page);
    const th0 = (await state(page)).trucks[0].theta;
    await page.keyboard.down('w');
    await page.keyboard.down('d');
    await advance(page, 0.8);
    await page.keyboard.up('d');
    const right = (await state(page)).trucks[0].theta;
    // Sving til høyre sett ovenfra = økende vinkel.
    expect(right).toBeGreaterThan(th0 + 0.4);
    await page.keyboard.down('a');
    await advance(page, 1.6);
    await page.keyboard.up('a');
    expect((await state(page)).trucks[0].theta).toBeLessThan(right - 0.8);
    await page.keyboard.up('w');
  });

  test('piltastene svinger spiller 2, ikke spiller 1', async ({ page }) => {
    await open(page);
    await startRace(page);
    const s0 = await state(page);
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowRight');
    await advance(page, 0.8);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowUp');
    const s1 = await state(page);
    expect(s1.trucks[1].theta).toBeGreaterThan(s0.trucks[1].theta + 0.4);
    expect(s1.trucks[0].theta).toBeCloseTo(s0.trucks[0].theta, 5);
  });

  test('kan ikke svinge når man står stille', async ({ page }) => {
    await open(page);
    await startRace(page);
    const th0 = (await state(page)).trucks[0].theta;
    await page.keyboard.down('d');
    await advance(page, 1);
    await page.keyboard.up('d');
    expect((await state(page)).trucks[0].theta).toBeCloseTo(th0, 3);
  });

  test('to DualSense-kontrollere styrer hver sin truck (R2 + venstre stikke)', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__pads.connect(0); window.__pads.connect(1); });
    await startRace(page);
    const s0 = await state(page);
    expect(s0.pads.map((p) => p && p.name)).toEqual(['DualSense', 'DualSense']);

    await padSet(page, 0, BTN.R2, 1);
    await advance(page, 1.5);
    let s = await state(page);
    expect(s.trucks[0].dist).toBeGreaterThan(s0.trucks[0].dist + 10);
    expect(s.trucks[1].speed).toBeLessThan(0.2);
    await padSet(page, 0, BTN.R2, 0);

    // Stikka til høyre svinger til høyre, til venstre svinger til venstre.
    await teleport(page, 0, 20);
    await teleport(page, 1, 20, 3);
    await advance(page, 0.2);
    const t0 = (await state(page)).trucks[1].theta;
    await padSet(page, 1, BTN.R2, 1);
    await padAxis(page, 1, 0, 1);
    await advance(page, 0.7);
    const tr = (await state(page)).trucks[1].theta;
    expect(tr).toBeGreaterThan(t0 + 0.3);
    await padAxis(page, 1, 0, -1);
    await advance(page, 1.4);
    expect((await state(page)).trucks[1].theta).toBeLessThan(tr - 0.5);
    expect((await state(page)).trucks[0].speed).toBeLessThan(5);
  });

  test('d-pad kan også brukes til å svinge, og små stikkeutslag ignoreres', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__pads.connect(0); });
    await startRace(page);
    const theta0 = (await state(page)).trucks[0].theta;
    await padSet(page, 0, BTN.R2, 1);
    await padAxis(page, 0, 0, 0.08); // innenfor dødsonen
    await advance(page, 1);
    const straight = (await state(page)).trucks[0].theta;
    expect(Math.abs(straight - theta0)).toBeLessThan(0.02);
    await padAxis(page, 0, 0, 0);
    await padSet(page, 0, BTN.DPAD_RIGHT, 1);
    await advance(page, 0.6);
    expect((await state(page)).trucks[0].theta).toBeGreaterThan(straight + 0.3);
  });

  test('analog R2: halvt trykk gir lavere fart enn fullt trykk', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__pads.connect(0); window.__pads.connect(1); });
    await startRace(page);
    await padSet(page, 0, BTN.R2, 0.35);
    await padSet(page, 1, BTN.R2, 1);
    await advance(page, 1.5); // kort nok til at banen fortsatt er rett (banen er tilfeldig)
    const s = await state(page);
    expect(s.trucks[1].speed).toBeGreaterThan(s.trucks[0].speed + 8);
    expect(s.trucks[0].speed).toBeGreaterThan(3);
  });

  test('blandet: spiller 1 med kontroller, spiller 2 med tastatur', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__pads.connect(0));
    await startRace(page);
    await padSet(page, 0, BTN.R2, 1);
    await page.keyboard.down('ArrowUp');
    await advance(page, 2);
    const s = await state(page);
    expect(s.trucks[0].speed).toBeGreaterThan(10);
    expect(s.trucks[1].speed).toBeGreaterThan(10);
  });
});

test.describe('Spillmekanikk', () => {
  test('gress bremser ned, asfalt er raskest', async ({ page }) => {
    await open(page);
    await startRace(page);
    await teleport(page, 0, 40, 0);
    await teleport(page, 1, 40, 11); // utenfor asfalten, men innenfor barrieren
    await page.keyboard.down('w');
    await page.keyboard.down('ArrowUp');
    await advance(page, 0.1);
    expect((await state(page)).trucks[1].onRoad).toBe(false);
    expect((await state(page)).trucks[0].onRoad).toBe(true);
    await advance(page, 1.1);
    const s = await state(page);
    expect(s.trucks[0].speed).toBeGreaterThan(s.trucks[1].speed + 5);
  });

  test('barrieren holder trucken på banen og man setter seg ikke fast', async ({ page }) => {
    await open(page);
    await startRace(page);
    const wallLat = await page.evaluate(() => window.__game.game.track.wallLat);
    await teleport(page, 0, 60, 0);
    // Rett frem er banen rett her; sving hardt til høyre og gi gass inn i barrieren.
    await page.keyboard.down('w');
    await page.keyboard.down('d');
    let maxLat = 0;
    for (let i = 0; i < 10; i++) {
      await advance(page, 0.5);
      maxLat = Math.max(maxLat, Math.abs((await state(page)).trucks[0].lat));
    }
    await page.keyboard.up('d');
    expect(maxLat).toBeLessThanOrEqual(wallLat + 0.01);
    // Slipper man sving, skal trucken rette seg langs banen og komme seg videre.
    const d0 = (await state(page)).trucks[0].dist;
    await advance(page, 6);
    expect((await state(page)).trucks[0].dist).toBeGreaterThan(d0 + 20);
    await page.keyboard.up('w');
  });

  test('mynter plasseres tilfeldig og gir poeng til riktig spiller', async ({ page }) => {
    await open(page);
    const layoutA = await page.evaluate(() => window.__game.game.coins.map((c) => c.x.toFixed(1)).join());
    await page.keyboard.press('Enter');
    await advance(page, 0.1);
    const layoutB = await page.evaluate(() => window.__game.game.coins.map((c) => c.x.toFixed(1)).join());
    expect(layoutA).not.toEqual(layoutB);
    expect(layoutB.split(',').length).toBeGreaterThan(40);
    await advance(page, 3.2);

    await page.evaluate(() => {
      window.__game.game.coins.forEach((c) => { c.taken = true; });
      window.__game.addCoin(0, 90, 0);
    });
    await teleport(page, 1, 80, 0);
    await page.keyboard.down('ArrowUp');
    await advance(page, 2);
    await page.keyboard.up('ArrowUp');
    const s = await state(page);
    expect(s.trucks[1].score).toBe(1);
    expect(s.trucks[0].score).toBe(0);
    await expect(page.locator('#score-1')).toHaveText('1');
    await expect(page.locator('#score-0')).toHaveText('0');
  });

  test('runder telles, og plasseringen følger lederen', async ({ page }) => {
    await open(page);
    await startRace(page);
    const s0 = await state(page);
    expect(s0.trucks[0].lap).toBe(1);
    await expect(page.locator('#lap-0')).toHaveText('Runde 1/3');
    await teleport(page, 0, s0.trackLength - 30, 0);
    await teleport(page, 1, s0.trackLength - 40, 0);
    await page.keyboard.down('w');
    await advance(page, 2);
    await page.keyboard.up('w');
    const s1 = await state(page);
    expect(s1.trucks[0].lap).toBe(2);
    expect(s1.trucks[1].lap).toBe(1);
    expect(s1.trucks[0].place).toBe(1);
    expect(s1.trucks[1].place).toBe(2);
    await expect(page.locator('#lap-0')).toHaveText('Runde 2/3');
    await expect(page.locator('#pos-0')).toHaveText('1.');
    await expect(page.locator('#pos-1')).toHaveText('2.');
  });

  test('kjører man feil vei vises «Feil vei!»', async ({ page }) => {
    await open(page);
    await startRace(page);
    await teleport(page, 0, 60, 0);
    // Snu trucken 180 grader og gi gass.
    await page.evaluate(() => {
      const t = window.__game.game.trucks[0];
      t.theta += Math.PI;
    });
    await page.keyboard.down('w');
    await advance(page, 2.5);
    await page.keyboard.up('w');
    await expect(page.locator('#wrong-0')).toBeVisible();
    await expect(page.locator('#wrong-1')).toBeHidden();
  });
});

test.describe('3D og delt skjerm', () => {
  test('begge halvdeler av skjermen tegner en 3D-scene', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.keyboard.down('w');
    await page.keyboard.down('ArrowUp');
    await advance(page, 1);
    expect((await state(page)).triangles).toBeGreaterThan(1000);
    const colours = await page.evaluate(() => {
      const c = document.getElementById('game');
      const copy = document.createElement('canvas');
      copy.width = c.width; copy.height = c.height;
      const ctx = copy.getContext('2d');
      ctx.drawImage(c, 0, 0);
      const count = (x0, x1) => {
        const d = ctx.getImageData(x0, 0, x1 - x0, c.height).data;
        const set = new Set();
        for (let i = 0; i < d.length; i += 4 * 97) set.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
        return set.size;
      };
      const w = c.width;
      return [count(0, Math.floor(w / 2) - 4), count(Math.floor(w / 2) + 4, w)];
    });
    expect(colours[0]).toBeGreaterThan(12);
    expect(colours[1]).toBeGreaterThan(12);
  });

  test('all synlig tekst er på norsk', async ({ page }) => {
    await open(page);
    const text = await page.locator('body').innerText();
    for (const english of ['Player', 'Score', 'Press', 'Start game', 'Winner', 'Controls', 'Jump', 'Reverse', 'Accelerate', 'Keyboard', 'Lap']) {
      expect(text).not.toContain(english);
    }
    await expect(page.locator('.vp0')).toContainText('Spiller 1');
    await expect(page.locator('.vp0')).toContainText('mynter');
    await expect(page.locator('.vp0')).toContainText('Runde');
  });
});

test.describe('Hele løpet', () => {
  test('tre runder kan kjøres: en spiller vinner, og nytt løp kan startes', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__pads.connect(0); window.__pads.connect(1); });
    await startRace(page, { quiet: false });
    const result = await driveAll(page);
    expect(result.state).toBe('finished');
    expect([0, 1]).toContain(result.winner);
    expect(result.trucks[result.winner].dist).toBeGreaterThanOrEqual(result.trackLength * 3);
    expect(result.trucks[0].score + result.trucks[1].score).toBeGreaterThan(0);

    await expect(page.locator('#results')).toBeVisible();
    await expect(page.locator('#winner-text')).toHaveText(`Spiller ${result.winner + 1} vant!`);
    await expect(page.locator('#res-score-0')).toHaveText(String(result.trucks[0].score));
    await expect(page.locator('#res-score-1')).toHaveText(String(result.trucks[1].score));
    await expect(page.locator('#winner-time')).toContainText('Tid:');

    for (const i of [0, 1]) { await padSet(page, i, BTN.R2, 0); await padAxis(page, i, 0, 0); }
    await advance(page, 1.5);
    await padSet(page, 0, BTN.CROSS, 1);
    await advance(page, 0.05);
    await padSet(page, 0, BTN.CROSS, 0);
    const s = await state(page);
    expect(s.state).toBe('countdown');
    expect(s.trucks[0].score).toBe(0);
    expect(s.trucks[0].dist).toBeLessThan(0);
    expect(Math.round(s.trackLength)).not.toBe(Math.round(result.trackLength)); // ny bane
    await expect(page.locator('#results')).toBeHidden();
  });

  test('Esc går til startskjermen', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.keyboard.press('Escape');
    await advance(page, 0.05);
    expect((await state(page)).state).toBe('menu');
    await expect(page.locator('#menu')).toBeVisible();
  });
});
