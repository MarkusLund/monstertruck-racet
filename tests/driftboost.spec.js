import { test, expect } from '@playwright/test';
import { open, startRace, advance } from './helpers.js';

// Kjører truck 0 rett i fysikken med fast input. Etter hvert steg legges trucken tilbake på midtlinjen
// i banens retning (farten beholdes), så en lang sving ikke ender i veggen.
async function installDriver(page) {
  await page.evaluate(() => {
    const g = window.__game;
    g.drive = (seconds, input, { speed = null, s = 40 } = {}) => {
      const t = g.game.trucks[0], { track } = g.game;
      if (speed !== null) {
        g.teleport(0, s, 0, 0);
        t.vx = Math.cos(t.theta) * speed; t.vz = Math.sin(t.theta) * speed;
      }
      const out = { maxDrift: 0, maxTurbo: 0 };
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        t.step({ brake: 0, jump: false, ...input }, 1 / 60, track, false);
        const n = t.nearest, sp = t.speed;
        t.x -= n.nx * t.lat; t.z -= n.nz * t.lat;
        t.theta = Math.atan2(n.tz, n.tx);
        t.vx = n.tx * sp; t.vz = n.tz * sp;
        out.maxDrift = Math.max(out.maxDrift, t.drift);
        out.maxTurbo = Math.max(out.maxTurbo, t.turbo);
      }
      out.drift = t.drift; out.turbo = t.turbo; out.speed = t.speed;
      return out;
    };
  });
}
const drive = (page, seconds, input, opts) => page.evaluate(([s, i, o]) => window.__game.drive(s, i, o), [seconds, input, opts]);

test.beforeEach(async ({ page }) => {
  await open(page);
  await startRace(page);
  await installDriver(page);
});

test('sladd i sving bygger drift-ladning, og turbo kommer når man går ut', async ({ page }) => {
  // Full styring i fart mens vi gasser: ladningen bygges, men ingen turbo ennå.
  const building = await drive(page, 1.2, { throttle: 1, steer: 1 }, { speed: 36 });
  expect(building.maxDrift).toBeGreaterThan(1);
  expect(building.maxTurbo).toBe(0);
  // Slipp styringen: ladningen nullstilles og trucken får turbo (ca. 1 s).
  const out = await drive(page, 0.5, { throttle: 1, steer: 0 });
  expect(out.drift).toBe(0);
  expect(out.maxTurbo).toBeGreaterThan(0.4);
  expect(out.maxTurbo).toBeLessThan(1.3);
});

test('rett fram gir ingen drift-ladning', async ({ page }) => {
  const r = await drive(page, 1.5, { throttle: 1, steer: 0 }, { speed: 36 });
  expect(r.maxDrift).toBe(0);
  expect(r.maxTurbo).toBe(0);
});

test('for kort drift gir ingen turbo, lengre drift gir mer', async ({ page }) => {
  const turboAfter = async (steerSeconds) => {
    await drive(page, steerSeconds, { throttle: 1, steer: 1 }, { speed: 36 });
    return (await drive(page, 0.4, { throttle: 1, steer: 0 })).maxTurbo;
  };
  expect(await turboAfter(0.4)).toBe(0);
  const mid = await turboAfter(1.0);
  const long = await turboAfter(2.6);
  expect(mid).toBeGreaterThan(0);
  expect(long).toBeGreaterThan(mid);
});

test('HUD viser fargetrinn for drift-ladningen', async ({ page }) => {
  for (const [charge, cls] of [[0.8, 'drift1'], [2.0, 'drift2'], [2.8, 'drift3']]) {
    await page.evaluate((c) => { const t = window.__game.game.trucks[0]; t.drift = c; t.driftGap = 1; t.msgTimer = 0; }, charge);
    await expect(async () => {
      await advance(page, 0.01);
      await expect(page.locator('#fx-0')).toHaveClass(new RegExp(cls));
    }).toPass({ timeout: 2000 });
  }
});

test('drift-ladning følger med i snapshot', async ({ page }) => {
  const r = await page.evaluate(() => {
    const g = window.__game.game;
    g.trucks[0].drift = 1.234;
    const sn = JSON.parse(JSON.stringify(g.snapshot()));
    g.trucks[0].drift = 0;
    g.applySnapshot(sn);
    return g.trucks[0].drift;
  });
  expect(r).toBeCloseTo(1.234, 2);
});
