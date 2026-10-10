import { test, expect } from '@playwright/test';
import { mockGamepads, open, state, advance, startRace, teleport } from './helpers.js';

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

test.describe('Slipstream og strikk', () => {
  test('slipstream: tett bak den andre gir fartsbonus', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.evaluate(() => { window.__game.game.newRace(428960272); window.__game.quiet(); }); // fast bane: den skal ha en rett strekning her
    await teleport(page, 0, 100, 0);
    await teleport(page, 1, 80, 0);
    await page.keyboard.down('s');
    await page.keyboard.down('ArrowUp');
    await advance(page, 1.5);
    const s = await state(page);
    expect(s.trucks[1].draft).toBeGreaterThan(0.5);
    expect(s.trucks[0].draft).toBe(0);
    await expect(page.locator('#fx-1')).toHaveText('Slipstream');
    await advance(page, 0.9); // kort, så ingen rekker å kjøre i veggen i en sving
    const t = await state(page);
    expect(t.trucks[1].speed).toBeGreaterThan(t.trucks[0].speed + 1);
  });

  test('slipstream krever at man ligger rett bak, ikke ved siden av', async ({ page }) => {
    await open(page);
    await startRace(page);
    await teleport(page, 0, 100, -6);
    await teleport(page, 1, 85, 6);
    await page.keyboard.down('s');
    await page.keyboard.down('ArrowUp');
    await advance(page, 1);
    expect((await state(page)).trucks[1].draft).toBe(0);
  });

  test('strikk: den som ligger langt bak får hjelp, lederen ikke', async ({ page }) => {
    await open(page);
    await startRace(page);
    await teleport(page, 0, 300, 0);
    await teleport(page, 1, 20, 0);
    await advance(page, 0.1);
    const s = await state(page);
    expect(s.trucks[1].catchup).toBeGreaterThan(0.9);
    expect(s.trucks[0].catchup).toBe(0);
    await teleport(page, 1, 290, 0);
    await advance(page, 0.1);
    expect((await state(page)).trucks[1].catchup).toBe(0);
  });
});

test.describe('Mynter gir akselerasjon', () => {
  test('flere mynter gir raskere akselerasjon (opptil et tak)', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.evaluate(() => { window.__game.game.trucks[0].score = 30; window.__game.game.trucks[1].score = 0; });
    const s0 = await state(page);
    await page.keyboard.down('s');
    await page.keyboard.down('ArrowUp');
    await advance(page, 1);
    await page.keyboard.up('s');
    await page.keyboard.up('ArrowUp');
    const s1 = await state(page);
    const rich = s1.trucks[0].dist - s0.trucks[0].dist;
    const poor = s1.trucks[1].dist - s0.trucks[1].dist;
    expect(rich).toBeGreaterThan(poor * 1.15);
    expect(rich).toBeLessThan(poor * 1.9);
  });

  test('akselerasjonsbonusen har et tak', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.evaluate(() => { window.__game.game.trucks[0].score = 20; window.__game.game.trucks[1].score = 200; });
    const s0 = await state(page);
    await page.keyboard.down('s');
    await page.keyboard.down('ArrowUp');
    await advance(page, 1);
    const s1 = await state(page);
    const a = s1.trucks[0].dist - s0.trucks[0].dist, b = s1.trucks[1].dist - s0.trucks[1].dist;
    expect(Math.abs(a - b) / b).toBeLessThan(0.08);
  });
});

test.describe('Power-ups', () => {
  test('item-boks gir power-up og forsvinner en stund', async ({ page }) => {
    await open(page);
    await startRace(page, { quiet: false });
    const got = await page.evaluate(() => {
      const g = window.__game.game;
      const t = g.trucks[0];
      g.boxes[0].x = t.x; g.boxes[0].z = t.z; g.boxes[0].cooldown = 0;
      g.step([{ throttle: 0, steer: 0 }, { throttle: 0, steer: 0 }]);
      return { cooldown: g.boxes[0].cooldown, events: g.events.filter((e) => e.type === 'item').length, msg: t.msg };
    });
    expect(got.cooldown).toBeGreaterThan(5);
    expect(got.events).toBe(1);
    expect(got.msg).not.toBe('');
    expect((await state(page)).boxes).toBeGreaterThanOrEqual(12);
  });

  test('den som leder får aldri raketter eller veisperrer, den bakerste kan få begge', async ({ page }) => {
    await open(page);
    await startRace(page);
    const r = await page.evaluate(() => {
      const g = window.__game.game;
      g.trucks[0].dist = 500; g.trucks[1].dist = 100;
      const kinds = (id) => {
        const seen = new Set();
        for (let i = 0; i < 80; i++) {
          g.events.length = 0; g.projectiles = []; g.barricades = [];
          g.giveItem(g.trucks[id]);
          seen.add(g.events.find((e) => e.type === 'item').item);
        }
        return [...seen].sort();
      };
      return { leader: kinds(0), trailing: kinds(1) };
    });
    expect(r.leader).toEqual(['mine', 'oil', 'shield', 'turbo']);
    expect(r.trailing).toEqual(expect.arrayContaining(['barricade', 'rocket', 'turbo']));
  });

  test('turbo gir fart over normal toppfart, selv uten gass', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.evaluate(() => { window.__game.game.trucks[0].turbo = 2; });
    const s0 = await state(page);
    await advance(page, 1.5);
    const s1 = await state(page);
    expect(s1.trucks[0].speed).toBeGreaterThan(30);
    expect(s1.trucks[0].dist).toBeGreaterThan(s0.trucks[0].dist + 20);
  });

  test('rakett: trucken sprenges og settes tilbake på veien, men skjold tar støyten', async ({ page }) => {
    await open(page);
    await startRace(page);
    await page.keyboard.down('ArrowUp');
    await advance(page, 1.5);
    const before = await state(page);
    await page.evaluate(() => window.__game.game.hitByRocket(window.__game.game.trucks[1]));
    await advance(page, 0.3);
    const hit = await state(page);
    expect(hit.trucks[1].rescue).toBeGreaterThan(1);
    expect(hit.trucks[1].speed).toBeLessThan(1);
    await expect(page.locator('#fx-1')).toContainText('BOOM');
    await advance(page, 2);
    const back = await state(page);
    expect(back.trucks[1].rescue).toBe(0);
    expect(Math.abs(back.trucks[1].lat)).toBeLessThanOrEqual(11);
    expect(Math.abs(back.trucks[1].dist - before.trucks[1].dist)).toBeLessThan(15); // tilbake omtrent der den ble truffet

    await page.evaluate(() => { const g = window.__game.game; g.trucks[1].shield = 5; g.hitByRocket(g.trucks[1]); });
    const sh = await state(page);
    expect(sh.trucks[1].rescue).toBe(0);
    expect(sh.trucks[1].shield).toBe(0);
  });

  test('rakett flyr mot lederen og treffer', async ({ page }) => {
    await open(page);
    await startRace(page);
    await teleport(page, 0, 150, 0);
    await teleport(page, 1, 100, 0);
    await page.evaluate(() => {
      const g = window.__game.game;
      g.rand = () => 0.5; // bakerste: ['turbo','rocket','barricade'] -> rocket
      g.giveItem(g.trucks[1]);
    });
    expect((await state(page)).projectiles).toBe(1);
    await advance(page, 1.5);
    const s = await state(page);
    expect(s.projectiles).toBe(0);
    expect(s.trucks[0].rescue).toBeGreaterThan(0);
  });

  test('veisperre endrer banen: stopper den som kjører rett inn, og forsvinner etter en stund', async ({ page }) => {
    await open(page);
    await startRace(page);
    const length = await L(page);
    await teleport(page, 0, length - 50, 0, -1);
    await page.evaluate((len) => { window.__game.teleport(1, 200, 0, 0); window.__game.addBarricade(len - 12); }, length);
    await page.keyboard.down('s');
    let maxDist = -Infinity, warned = false;
    for (let i = 0; i < 20; i++) {
      await advance(page, 0.2);
      const t = (await state(page)).trucks[0];
      maxDist = Math.max(maxDist, t.dist);
      warned = warned || t.msg.includes('Veisperre');
    }
    await page.keyboard.up('s');
    expect(maxDist).toBeLessThan(-12);
    expect(warned).toBe(true);
    await advance(page, 12);
    expect((await state(page)).barricades.length).toBe(0);
  });

  test('veisperre: omveien i gresset kommer man forbi', async ({ page }) => {
    await open(page);
    await startRace(page);
    await teleport(page, 0, 400, 14); // gresset utenfor asfalten (11 m bred her)
    await page.evaluate(() => { window.__game.teleport(1, 200, 0, 0); window.__game.addBarricade(420); });
    await page.keyboard.down('s');
    await advance(page, 4);
    await page.keyboard.up('s');
    expect((await state(page)).trucks[0].dist).toBeGreaterThan(432);
  });

  test('skjold knuser veisperren', async ({ page }) => {
    await open(page);
    await startRace(page);
    const length = await L(page);
    await teleport(page, 0, length - 40, 0, -1);
    await page.evaluate((len) => {
      window.__game.teleport(1, 200, 0, 0);
      window.__game.addBarricade(len - 15);
      window.__game.game.trucks[0].shield = 8;
    }, length);
    await page.keyboard.down('s');
    await advance(page, 3);
    await page.keyboard.up('s');
    const s = await state(page);
    expect(s.trucks[0].dist).toBeGreaterThan(-12);
    expect(s.trucks[0].shield).toBe(0);
    expect(s.barricades.length).toBe(0);
  });

  test('«Veisperre foran!» vises til den som skal ta omveien', async ({ page }) => {
    await open(page);
    await startRace(page);
    await teleport(page, 0, 150, 0);
    await teleport(page, 1, 100, 0);
    await page.evaluate(() => {
      const g = window.__game.game;
      g.rand = () => 0.99; // bakerste -> veisperre
      g.giveItem(g.trucks[1]);
    });
    const s = await state(page);
    expect(s.barricades.length).toBe(1);
    expect(s.trucks[0].msg).toBe('Veisperre foran!');
    await advance(page, 0.1);
    await expect(page.locator('#fx-0')).toHaveText('Veisperre foran!');
  });
});

test.describe('Kollisjon, hopp og tilfeldige baner', () => {
  test('truckene kolliderer og dytter hverandre', async ({ page }) => {
    await open(page);
    await startRace(page);
    await teleport(page, 0, 10, 0);
    await teleport(page, 1, 40, 0);
    await page.keyboard.down('s');
    let minDist = Infinity, pushed = 0;
    for (let i = 0; i < 40; i++) {
      await advance(page, 0.1);
      const s = await state(page);
      minDist = Math.min(minDist, Math.hypot(s.trucks[0].x - s.trucks[1].x, s.trucks[0].z - s.trucks[1].z));
      pushed = Math.max(pushed, s.trucks[1].speed);
    }
    await page.keyboard.up('s');
    expect(minDist).toBeGreaterThan(4.4);
    expect(pushed).toBeGreaterThan(3); // den stillestående ble dyttet
  });

  test('ramper: trucken letter, er i lufta og lander igjen', async ({ page }) => {
    await open(page);
    await startRace(page, { quiet: false });
    const { jumps } = await state(page);
    expect(jumps.length).toBeGreaterThanOrEqual(1);
    const j = jumps[0];
    await page.evaluate(() => window.__game.game.boxes.forEach((b) => { b.cooldown = 1e9; }));
    await teleport(page, 0, j.s0 - 22, 0);
    await page.keyboard.down('s');
    let maxY = 0, wasAir = false, landed = false;
    for (let i = 0; i < 40; i++) {
      await advance(page, 0.1);
      const t = (await state(page)).trucks[0];
      maxY = Math.max(maxY, t.y - t.ground);
      if (t.air) wasAir = true;
      if (wasAir && !t.air && t.y === t.ground) landed = true;
    }
    await page.keyboard.up('s');
    expect(wasAir).toBe(true);
    expect(maxY).toBeGreaterThan(1.5);
    expect(landed).toBe(true);
  });

  test('hopper man over den andre, kolliderer man ikke', async ({ page }) => {
    await open(page);
    await startRace(page);
    await teleport(page, 0, 20, 0);
    await teleport(page, 1, 22, 0);
    await page.evaluate(() => { const t = window.__game.game.trucks[0]; t.air = true; t.y += 4; t.vy = 0.1; t.vx = 8; });
    await advance(page, 0.05);
    expect((await state(page)).trucks[1].speed).toBeLessThan(0.5);
  });

  test('ny tilfeldig bane for hvert løp', async ({ page }) => {
    await open(page);
    const lengths = [(await state(page)).trackLength];
    for (let k = 0; k < 4; k++) {
      await page.keyboard.press('Enter');
      await advance(page, 0.1);
      lengths.push((await state(page)).trackLength);
      await page.keyboard.press('Escape');
      await advance(page, 0.1);
    }
    expect(new Set(lengths.map((l) => Math.round(l))).size).toBeGreaterThanOrEqual(3);
  });

  test('alle tilfeldige baner: oppstillingen står på banen og 3D-scenen bygges på nytt', async ({ page }) => {
    await open(page);
    for (let k = 0; k < 3; k++) {
      await page.keyboard.press('Enter');
      await advance(page, 0.1);
      const s = await state(page);
      for (const t of s.trucks) { expect(t.onRoad).toBe(true); expect(Math.abs(t.lat)).toBeLessThan(5); }
      expect(s.triangles).toBeGreaterThan(1000);
      await page.keyboard.press('Escape');
      await advance(page, 0.1);
    }
  });
});
