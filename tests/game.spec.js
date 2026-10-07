import { test, expect } from '@playwright/test';
import { BTN, mockGamepads, open, state, advance, startRace, padSet } from './helpers.js';

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
  test('viser kontrollene for DualSense og tastatur på norsk', async ({ page }) => {
    await open(page);
    const menu = page.locator('#menu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('MONSTERTRUCK');
    await expect(menu).toContainText('Spiller 1');
    await expect(menu).toContainText('Spiller 2');
    for (const w of ['Gass', 'Revers', 'Hopp', 'DualSense', 'Tastatur', 'R2', 'L2', '✕', 'for å starte']) {
      await expect(menu).toContainText(w);
    }
    const p1 = page.locator('#menu .ctl.p1');
    const p2 = page.locator('#menu .ctl.p2');
    for (const k of ['D', 'A', 'W']) await expect(p1.locator('kbd', { hasText: new RegExp(`^${k}$`) })).toHaveCount(1);
    for (const k of ['→', '←', '↑']) await expect(p2.locator('kbd', { hasText: k })).toHaveCount(1);
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
    await expect.poll(async () => (await state(page)).state, { timeout: 8000 }).toBe('racing');
    const x0 = (await state(page)).trucks[0].x;
    await page.keyboard.down('d');
    await page.waitForTimeout(1500);
    await page.keyboard.up('d');
    expect((await state(page)).trucks[0].x).toBeGreaterThan(x0 + 5);
  });
});

test.describe('Styring', () => {
  test('trucker står stille under nedtellingen', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Enter');
    await page.keyboard.down('d');
    await advance(page, 2);
    await page.keyboard.up('d');
    const s = await state(page);
    expect(s.state).toBe('countdown');
    expect(Math.abs(s.trucks[0].vx)).toBeLessThan(0.2);
  });

  test('spiller 1 kjører med tastaturet (D/A/W) uten å påvirke spiller 2', async ({ page }) => {
    await open(page);
    await startRace(page);
    const s0 = await state(page);
    await page.keyboard.down('d');
    await advance(page, 2);
    await page.keyboard.up('d');
    const s1 = await state(page);
    expect(s1.trucks[0].x).toBeGreaterThan(s0.trucks[0].x + 8);
    expect(Math.abs(s1.trucks[1].x - s0.trucks[1].x)).toBeLessThan(0.3);

    // Revers (from standstill at the start)
    await page.evaluate(() => { window.__game.teleport(0, 10); window.__game.teleport(1, 10); });
    await advance(page, 0.5);
    const s2 = await state(page);
    await page.keyboard.down('a');
    await advance(page, 3);
    await page.keyboard.up('a');
    const s3 = await state(page);
    expect(s3.trucks[0].x).toBeLessThan(s2.trucks[0].x - 1);
    expect(Math.abs(s3.trucks[1].x - s2.trucks[1].x)).toBeLessThan(0.3);
  });

  test('spiller 2 kjører med piltastene uten å påvirke spiller 1', async ({ page }) => {
    await open(page);
    await startRace(page);
    const s0 = await state(page);
    await page.keyboard.down('ArrowRight');
    await advance(page, 2);
    await page.keyboard.up('ArrowRight');
    const s1 = await state(page);
    expect(s1.trucks[1].x).toBeGreaterThan(s0.trucks[1].x + 8);
    expect(Math.abs(s1.trucks[0].x - s0.trucks[0].x)).toBeLessThan(0.3);
    await page.evaluate(() => { window.__game.teleport(0, 10); window.__game.teleport(1, 10); });
    await advance(page, 0.5);
    const s2 = await state(page);
    await page.keyboard.down('ArrowLeft');
    await advance(page, 3);
    await page.keyboard.up('ArrowLeft');
    const s3 = await state(page);
    expect(s3.trucks[1].x).toBeLessThan(s2.trucks[1].x - 1);
    expect(Math.abs(s3.trucks[0].x - s2.trucks[0].x)).toBeLessThan(0.3);
  });

  test('begge spillere på samme tastatur samtidig', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.keyboard.down('d');
    await page.keyboard.down('ArrowRight');
    await advance(page, 2);
    const s = await state(page);
    expect(s.trucks[0].x).toBeGreaterThan(14);
    expect(s.trucks[1].x).toBeGreaterThan(14);
  });

  test('to DualSense-kontrollere styrer hver sin truck samtidig (R2/L2)', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__pads.connect(0); window.__pads.connect(1); });
    await startRace(page);
    const s0 = await state(page);
    expect(s0.pads.map((p) => p && p.name)).toEqual(['DualSense', 'DualSense']);

    // Only controller 1 accelerates
    await padSet(page, 0, BTN.R2, 1);
    await advance(page, 1.5);
    await padSet(page, 0, BTN.R2, 0);
    let s = await state(page);
    expect(s.trucks[0].x).toBeGreaterThan(s0.trucks[0].x + 5);
    expect(Math.abs(s.trucks[1].x - s0.trucks[1].x)).toBeLessThan(0.3);

    // Only controller 2 accelerates
    const reset = () => page.evaluate(() => { window.__game.teleport(0, 10); window.__game.teleport(1, 10); window.__game.advance(0.5); });
    await reset();
    const mid = await state(page);
    await padSet(page, 1, BTN.R2, 1);
    await advance(page, 1.5);
    await padSet(page, 1, BTN.R2, 0);
    s = await state(page);
    expect(s.trucks[1].x).toBeGreaterThan(mid.trucks[1].x + 5);
    expect(Math.abs(s.trucks[0].x - mid.trucks[0].x)).toBeLessThan(0.3);

    // Both at the same time: controller 1 forward, controller 2 in reverse
    await reset();
    const b0 = await state(page);
    await padSet(page, 0, BTN.R2, 1);
    await padSet(page, 1, BTN.L2, 1);
    await advance(page, 2);
    const b1 = await state(page);
    expect(b1.trucks[0].x).toBeGreaterThan(b0.trucks[0].x + 5);
    expect(b1.trucks[1].x).toBeLessThan(b0.trucks[1].x - 1);
  });

  test('analog R2: halvt trykk gir lavere fart enn fullt trykk', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__pads.connect(0); window.__pads.connect(1); });
    await startRace(page);
    await padSet(page, 0, BTN.R2, 0.35);
    await padSet(page, 1, BTN.R2, 1);
    await advance(page, 2);
    const s = await state(page);
    expect(s.trucks[1].x).toBeGreaterThan(s.trucks[0].x + 2);
    expect(s.trucks[0].x).toBeGreaterThan(8);
  });

  test('blandet: spiller 1 med kontroller, spiller 2 med tastatur', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__pads.connect(0));
    await startRace(page);
    const s0 = await state(page);
    expect(s0.pads[0]?.name).toBe('DualSense');
    expect(s0.pads[1]).toBeNull();
    await padSet(page, 0, BTN.R2, 1);
    await page.keyboard.down('ArrowRight');
    await advance(page, 2);
    const s1 = await state(page);
    expect(s1.trucks[0].x).toBeGreaterThan(s0.trucks[0].x + 8);
    expect(s1.trucks[1].x).toBeGreaterThan(s0.trucks[1].x + 8);
    // P1's keyboard keys still work alongside the controller
    await padSet(page, 0, BTN.R2, 0);
    await page.keyboard.up('ArrowRight');
    await page.evaluate(() => { window.__game.teleport(0, 10); window.__game.advance(0.5); });
    const s2 = await state(page);
    await page.keyboard.down('d');
    await advance(page, 1.5);
    await page.keyboard.up('d');
    expect((await state(page)).trucks[0].x).toBeGreaterThan(s2.trucks[0].x + 4);
  });

  test('blandet: spiller 1 med tastatur, spiller 2 med kontroller', async ({ page }) => {
    await open(page);
    // A single controller is assigned to player 1; to give player 2 a controller, connect two
    // and leave the first idle while player 1 uses the keyboard.
    await page.evaluate(() => { window.__pads.connect(0); window.__pads.connect(1); });
    await startRace(page);
    const s0 = await state(page);
    await page.keyboard.down('d');
    await padSet(page, 1, BTN.R2, 1);
    await advance(page, 2);
    const s1 = await state(page);
    expect(s1.trucks[0].x).toBeGreaterThan(s0.trucks[0].x + 8);
    expect(s1.trucks[1].x).toBeGreaterThan(s0.trucks[1].x + 8);
  });

  for (const [who, how] of [[0, 'W'], [1, 'ArrowUp'], [0, 'pad'], [1, 'pad']]) {
    test(`hopp: spiller ${who + 1} med ${how === 'pad' ? '✕ på kontrolleren' : how} (beskjedent hopp)`, async ({ page }) => {
      await open(page);
      await page.evaluate(() => { window.__pads.connect(0); window.__pads.connect(1); });
      await startRace(page);
      const s0 = await state(page);
      if (how === 'pad') await padSet(page, who, BTN.CROSS, 1);
      else await page.keyboard.down(how);
      let maxY = s0.trucks[who].y, otherMaxY = s0.trucks[1 - who].y;
      for (let i = 0; i < 40; i++) {
        await advance(page, 1 / 60);
        const s = await state(page);
        maxY = Math.max(maxY, s.trucks[who].y);
        otherMaxY = Math.max(otherMaxY, s.trucks[1 - who].y);
      }
      if (how === 'pad') await padSet(page, who, BTN.CROSS, 0);
      else await page.keyboard.up(how);
      const rise = maxY - s0.trucks[who].y;
      expect(rise).toBeGreaterThan(0.6);
      expect(rise).toBeLessThan(2.2); // modest, not huge
      expect(otherMaxY - s0.trucks[1 - who].y).toBeLessThan(0.1);
      await advance(page, 1.5);
      expect((await state(page)).trucks[who].grounded).toBe(true);
    });
  }

  test('hopp i fart beholder bevegelsesmengden', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.keyboard.down('d');
    await advance(page, 1.5);
    const before = (await state(page)).trucks[0];
    await page.keyboard.up('d');
    await page.keyboard.press('w');
    await advance(page, 0.25);
    const after = (await state(page)).trucks[0];
    expect(after.grounded).toBe(false);
    expect(after.vx).toBeGreaterThan(before.vx * 0.8);
    expect(after.y).toBeGreaterThan(before.y + 0.4);
  });

  test('kan ikke hoppe igjen i lufta', async ({ page }) => {
    await open(page);
    await startRace(page);
    const y0 = (await state(page)).trucks[0].y;
    let maxY = y0;
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('w');
      for (let k = 0; k < 6; k++) {
        await advance(page, 1 / 60);
        maxY = Math.max(maxY, (await state(page)).trucks[0].y);
      }
    }
    expect(maxY - y0).toBeLessThan(2.2);
  });
});

test.describe('Spillmekanikk', () => {
  test('truckene kolliderer ikke med hverandre', async ({ page }) => {
    await open(page);
    await startRace(page);
    // Park player 2 right in front of player 1, then drive player 1 straight through.
    await page.evaluate(() => window.__game.teleport(1, 14));
    await advance(page, 0.5);
    const s0 = await state(page);
    await page.keyboard.down('d');
    await advance(page, 2);
    await page.keyboard.up('d');
    const s1 = await state(page);
    expect(s1.trucks[0].x).toBeGreaterThan(s0.trucks[1].x + 4);
    expect(Math.abs(s1.trucks[1].x - s0.trucks[1].x)).toBeLessThan(0.3);
    expect(Math.abs(s1.trucks[1].vx)).toBeLessThan(0.2);
  });

  test('faller du i et hull, starter du på bakken før hullet', async ({ page }) => {
    await open(page);
    await startRace(page);
    const { pits } = await page.evaluate(() => window.__game.track());
    expect(pits.length).toBeGreaterThanOrEqual(3);
    for (const [k, pit] of pits.entries()) {
      const mid = (pit.x0 + pit.x1) / 2;
      await page.evaluate(([mid, y]) => window.__game.dropAt(0, mid, y), [mid, pit.rimY + 1]);
      await advance(page, 2.5);
      const t = (await state(page)).trucks[0];
      expect(t.respawns).toBe(k + 1);
      expect(t.x).toBeLessThan(pit.x0 - 10); // not right above the pit
      expect(t.x).toBeGreaterThan(pit.x0 - 45);
      const g = await page.evaluate((x) => window.__game.ground(x), t.x);
      expect(t.y - g).toBeGreaterThan(0.5);
      expect(t.y - g).toBeLessThan(2.5); // standing on the ground
      expect(t.grounded).toBe(true);
    }
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
      window.__game.game.coins.forEach((c) => { if (c.x < 60) c.taken = true; });
      window.__game.addCoin(30, window.__game.ground(30) + 1.3);
    });
    await page.keyboard.down('ArrowRight');
    await advance(page, 2.5);
    await page.keyboard.up('ArrowRight');
    const s = await state(page);
    expect(s.trucks[1].score).toBe(1);
    expect(s.trucks[0].score).toBe(0);
    await expect(page.locator('#score-1')).toHaveText('1');
    await expect(page.locator('#score-0')).toHaveText('0');
  });

  test('flippet truck settes på hjulene igjen', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.evaluate(() => {
      const t = window.__game.game.trucks[0];
      t.place(40, window.__game.ground(40) + 0.5, Math.PI);
    });
    await advance(page, 3);
    const t = (await state(page)).trucks[0];
    expect(Math.cos(t.angle)).toBeGreaterThan(0.8);
  });
});

test.describe('Kamera og UI', () => {
  test('kameraet zoomer ut så begge truckene alltid er synlige', async ({ page }) => {
    await open(page);
    await startRace(page);
    const z0 = (await state(page)).zoom;
    await page.keyboard.down('d');
    for (let i = 0; i < 12; i++) {
      await advance(page, 0.5);
      const s = await state(page);
      for (const t of s.trucks) {
        expect(t.screen.x).toBeGreaterThan(0);
        expect(t.screen.x).toBeLessThan(s.canvas.w);
        expect(t.screen.y).toBeGreaterThan(0);
        expect(t.screen.y).toBeLessThan(s.canvas.h);
      }
    }
    await page.keyboard.up('d');
    const s = await state(page);
    expect(s.trucks[0].x - s.trucks[1].x).toBeGreaterThan(60);
    expect(s.zoom).toBeLessThan(z0 * 0.6);

    // Very far apart
    await page.evaluate(() => window.__game.teleport(0, 1000));
    await advance(page, 1.5);
    const f = await state(page);
    for (const t of f.trucks) {
      expect(t.screen.x).toBeGreaterThan(0);
      expect(t.screen.x).toBeLessThan(f.canvas.w);
    }
  });

  test('UI skalerer ikke med kamerazoom og ligger utenfor spillområdet', async ({ page }) => {
    await open(page);
    await startRace(page);
    const box = async () => ({
      hud: await page.locator('#hud').boundingBox(),
      score: await page.locator('#score-0').boundingBox(),
      font: await page.locator('#score-0').evaluate((e) => getComputedStyle(e).fontSize),
      canvas: await page.locator('#game').boundingBox(),
    });
    const a = await box();
    expect(a.hud.y + a.hud.height).toBeLessThanOrEqual(a.canvas.y + 0.5);
    const z0 = (await state(page)).zoom;
    await page.evaluate(() => window.__game.teleport(0, 700));
    await advance(page, 2);
    expect((await state(page)).zoom).toBeLessThan(z0 * 0.3);
    const b = await box();
    expect(b.hud).toEqual(a.hud);
    expect(b.font).toEqual(a.font);
    expect(b.score.height).toEqual(a.score.height);
    expect(b.canvas).toEqual(a.canvas);
  });

  test('all synlig tekst er på norsk', async ({ page }) => {
    await open(page);
    const text = await page.locator('body').innerText();
    for (const english of ['Player', 'Score', 'Press', 'Start game', 'Winner', 'Controls', 'Jump', 'Reverse', 'Accelerate', 'Keyboard']) {
      expect(text).not.toContain(english);
    }
    await expect(page.locator('#hud')).toContainText('Spiller 1');
    await expect(page.locator('#hud')).toContainText('mynter');
  });
});

test.describe('Hele løpet', () => {
  test('løpet kan fullføres: en spiller når mål og vinner, og nytt løp kan startes', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__pads.connect(0); window.__pads.connect(1); });
    await startRace(page);
    // Drive both trucks over the whole track with the controllers (simple driver policy).
    const result = await page.evaluate(({ BTN }) => {
      const g = window.__game;
      const pits = g.track().pits;
      for (let step = 0; step < 60 * 200 && g.game.state === 'racing'; step++) {
        g.game.trucks.forEach((t, i) => {
          const a = Math.atan2(Math.sin(t.angle), Math.cos(t.angle));
          let th = 1;
          if (!t.grounded) th = Math.max(-1, Math.min(1, -a * 2.5));
          else if (a > 0.7) th = 0.2;
          if (i === 1) th *= 0.92;
          window.__pads.set(i, BTN.R2, Math.max(0, th));
          window.__pads.set(i, BTN.L2, Math.max(0, -th));
          const pit = pits.find((q) => t.x > q.x0 - 3.5 && t.x < q.x0 - 0.5);
          window.__pads.set(i, BTN.CROSS, pit ? 1 : 0);
        });
        g.advance(1 / 60);
      }
      return g.state();
    }, { BTN });
    expect(result.state).toBe('finished');
    expect([0, 1]).toContain(result.winner);
    const goalX = (await page.evaluate(() => window.__game.track())).goalX;
    expect(result.trucks[result.winner].x).toBeGreaterThanOrEqual(goalX);
    expect(result.trucks[0].score + result.trucks[1].score).toBeGreaterThan(0);

    await expect(page.locator('#results')).toBeVisible();
    await expect(page.locator('#winner-text')).toHaveText(`Spiller ${result.winner + 1} vant!`);
    await expect(page.locator('#res-score-0')).toHaveText(String(result.trucks[0].score));
    await expect(page.locator('#res-score-1')).toHaveText(String(result.trucks[1].score));
    await expect(page.locator('#winner-time')).toContainText('Tid:');

    // New race from the controller
    for (const b of [BTN.R2, BTN.L2, BTN.CROSS]) { await padSet(page, 0, b, 0); await padSet(page, 1, b, 0); }
    await advance(page, 1.5);
    await padSet(page, 0, BTN.CROSS, 1);
    await advance(page, 0.05);
    await padSet(page, 0, BTN.CROSS, 0);
    const s = await state(page);
    expect(s.state).toBe('countdown');
    expect(s.trucks[0].score).toBe(0);
    expect(s.trucks[0].x).toBeLessThan(10);
    await expect(page.locator('#results')).toBeHidden();
  });

  test('mål med tastaturet: spiller 2 vinner, Esc går til startskjermen', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.teleport(0, g.track().goalX - 40);
      g.teleport(1, g.track().goalX - 25);
    });
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('d');
    await advance(page, 4);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('d');
    const s = await state(page);
    expect(s.state).toBe('finished');
    expect(s.winner).toBe(1);
    await expect(page.locator('#winner-text')).toHaveText('Spiller 2 vant!');
    await expect(page.locator('#status')).toHaveText('Spiller 2 vant!');
    await page.keyboard.press('Escape');
    await advance(page, 0.05);
    expect((await state(page)).state).toBe('menu');
    await expect(page.locator('#menu')).toBeVisible();
  });
});
