import { test, expect } from '@playwright/test';
import { open, startRace, advance } from './helpers.js';

test.describe('Lyd', () => {
  test('motoren girer opp med farten, faller i turtall ved girskift og ruser fritt i lufta', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async () => {
      const { EngineModel, IDLE_RPM, REDLINE, GEARS } = await import('/src/engine-sound.js');
      const dt = 1 / 60;
      const idle = new EngineModel();
      for (let k = 0; k < 60; k++) idle.update(dt, 0, 0);
      const m = new EngineModel();
      const gears = [m.gear];
      let speed = 0, maxRpm = 0, drop = false;
      for (let k = 0; k < 400; k++) {
        speed = Math.min(40, speed + 15 * dt);
        const gear = m.gear;
        m.update(dt, speed, 1, false, 15);
        maxRpm = Math.max(maxRpm, m.rpm);
        if (m.gear !== gear) {
          gears.push(m.gear);
          const before = m.rpm;
          for (let j = 0; j < 9; j++) { speed = Math.min(40, speed + 15 * dt); m.update(dt, speed, 1, false, 15); }
          if (m.rpm < before - 400) drop = true;
        }
      }
      const air = new EngineModel();
      for (let k = 0; k < 90; k++) air.update(dt, 20, 1, true);
      return { idle: idle.rpm, IDLE_RPM, gears, maxRpm, REDLINE, drop, air: air.rpm, top: GEARS.length - 1 };
    });
    expect(Math.abs(r.idle - r.IDLE_RPM)).toBeLessThan(5);
    expect(r.gears).toEqual([0, 1, 2, 3, 4]); // 40 m/s ligger i femte (øverste) gir
    expect(r.drop).toBe(true);
    expect(r.maxRpm).toBeLessThanOrEqual(r.REDLINE);
    expect(r.air).toBeGreaterThan(4500);
  });

  test('alle baner får en spillbar låt, også gjennom siste runde og menyen', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async () => {
      const { Music, makeSong } = await import('/src/music.js');
      let bad = 0;
      for (let seed = 0; seed < 300; seed++) {
        for (const menu of [false, true]) {
          const s = makeSong(seed, menu);
          for (const n of [...s.melA, ...s.melB, ...s.melB2]) if (!Number.isInteger(n.deg) || n.deg < 0 || n.deg > 13) bad++;
        }
      }
      let errors = 0;
      const orig = console.error;
      console.error = () => { errors++; };
      for (const seed of [1, 7, 42, 99, 1234]) {
        const ctx = new OfflineAudioContext(2, 4410, 44100);
        const m = new Music(ctx, ctx.destination, ctx.destination, ctx.createBuffer(1, 88200, 44100));
        clearInterval(m.timer);
        m.play('race', seed);
        m.scheduleUntil(60);
        m.setFinal(true);
        m.scheduleUntil(100);
        const steps = m.perf.step;
        m.play('menu');
        m.perf.next = 0;
        m.scheduleUntil(30);
        if (steps < 100 * 4 * 2) errors++; // minst 128 bpm: sequenceren må ha gått hele veien
      }
      console.error = orig;
      return { bad, errors };
    });
    expect(r.bad).toBe(0);
    expect(r.errors).toBe(0);
  });

  test('motorlyden gjengis uten klipping eller stillhet', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async () => {
      const { EngineVoice, makeEngineAssets, rng } = await import('/src/engine-sound.js');
      const sr = 44100, secs = 3;
      const ctx = new OfflineAudioContext(2, sr * secs, sr);
      const v = new EngineVoice(ctx, ctx.destination, makeEngineAssets(ctx, rng(1)), 0);
      let speed = 0;
      for (let k = 0; k < secs * 60; k++) {
        speed = Math.min(40, speed + 0.3);
        v.update(1 / 60, { on: true, speed, throttle: 1, accel: 18, onRoad: true, gain: 1, pan: 0 }, k / 60);
      }
      const d = (await ctx.startRendering()).getChannelData(0);
      let sum = 0, peak = 0, finite = true;
      for (const x of d) { if (!Number.isFinite(x)) finite = false; sum += x * x; peak = Math.max(peak, Math.abs(x)); }
      return { finite, rms: 20 * Math.log10(Math.sqrt(sum / d.length)), peak };
    });
    expect(r.finite).toBe(true);
    expect(r.rms).toBeGreaterThan(-40);
    expect(r.peak).toBeLessThan(1);
  });

  test('lyden følger løpet: én motor per truck, løpsmusikk, og M slår musikken av og på', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page, { query: 'ai=1' });
    await page.evaluate(() => localStorage.removeItem('monstertruck-musikk'));
    await startRace(page);
    await page.waitForFunction(() => {
      const { sound, game } = window.__game;
      return sound.ctx && sound.voices.length === game.trucks.length && sound.music.mode === 'race';
    });
    await page.keyboard.down('KeyS');
    await advance(page, 3);
    await page.keyboard.up('KeyS');
    // Motormodellen oppdateres hver frame, så vent til den har fanget opp farten.
    await page.waitForFunction(() => window.__game.sound.voices[0].model.gear >= 3);

    await page.keyboard.press('KeyM');
    await expect(page.locator('#toast')).toHaveText('Musikk av');
    expect(await page.evaluate(() => [window.__game.sound.musicOn, localStorage.getItem('monstertruck-musikk')])).toEqual([false, '0']);
    await page.keyboard.press('KeyM');
    await expect(page.locator('#toast')).toHaveText('Musikk på');
    expect(await page.evaluate(() => window.__game.sound.musicOn)).toBe(true);

    expect(await page.evaluate(() => window.__game.sound.failed)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('alle lydeffekter kan spilles, også for trucker langt unna eller som ikke finnes', async ({ page }) => {
    await open(page, { query: 'ai=1' });
    await startRace(page);
    const failed = await page.evaluate(() => {
      const { sound, game } = window.__game;
      game.trucks[2].x += 300; // boten langt unna
      sound.update(1 / 60, game, { listeners: [0, 1], pans: [-0.3, 0.3, 0] });
      const events = [{ type: 'tick' }, { type: 'go' }];
      for (const truck of [0, 2, 9]) {
        events.push({ type: 'coin', truck }, { type: 'land', truck }, { type: 'lap', truck, lap: 1 }, { type: 'lap', truck, lap: 2 },
          { type: 'bump', truck, other: 1, power: 20 }, { type: 'bump', truck, power: 6 }, { type: 'finish', truck });
        for (const item of ['turbo', 'shield', 'rocket', 'oil', 'mine', 'barricade']) events.push({ type: 'item', truck, item });
        for (const cause of ['rocket', 'mine', 'shield', 'spin']) for (const shielded of [false, true]) events.push({ type: 'hit', truck, cause, shielded });
        for (const why of ['off', 'water', 'rocket']) events.push({ type: 'rescue', truck, why });
      }
      for (const e of events) sound.event(e);
      return sound.failed;
    });
    expect(failed).toBe(0);
  });

  test('lyd fra andre trucker plasseres etter avstand og retning', async ({ page }) => {
    await open(page);
    await page.keyboard.press('KeyN'); // låser opp lyden
    const r = await page.evaluate(() => {
      const { sound } = window.__game;
      const trucks = [{ x: 0, z: 0, theta: 0 }, { x: 0, z: 10, theta: 0 }, { x: 0, z: -10, theta: 0 }, { x: 200, z: 0, theta: 0 }];
      sound.view = { trucks, listeners: [0], pans: [], ownGain: 1 };
      const w = [0, 1, 2, 3].map((i) => sound.where(i));
      return w.map(({ gain, pan, own }) => ({ gain, pan, own }));
    });
    expect(r[0]).toEqual({ gain: 1, pan: 0, own: true });
    // Trucken ser langs +x, så +z er til høyre for den (og for kameraet bak den).
    expect(r[1].pan).toBeGreaterThan(0.3);
    expect(r[2].pan).toBeLessThan(-0.3);
    expect(r[1].gain).toBeGreaterThan(0.5);
    expect(r[3].gain).toBeLessThan(0.02);
  });
});
