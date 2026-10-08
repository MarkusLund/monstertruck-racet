// Shared helpers: a mocked Gamepad API that behaves like two DualSense controllers
// (standard mapping: 0 = ✕, 7 = R2, 9 = Options, 14/15 = d-pad venstre/høyre, akse 0 = venstre stikke X).
export const BTN = { CROSS: 0, R2: 7, OPTIONS: 9, DPAD_LEFT: 14, DPAD_RIGHT: 15 };

export async function mockGamepads(page) {
  await page.addInitScript(() => {
    const pads = [null, null, null, null];
    const mk = (index) => ({
      id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
      index, connected: true, mapping: 'standard', timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    });
    Object.defineProperty(navigator, 'getGamepads', { value: () => pads.slice(), configurable: true });
    window.__pads = {
      connect(i) { pads[i] = mk(i); },
      disconnect(i) { pads[i] = null; },
      set(i, btn, value) { pads[i].buttons[btn] = { pressed: value > 0.5, touched: value > 0, value }; },
      axis(i, a, value) { pads[i].axes[a] = value; },
    };
  });
}

// Math.random erstattes med en seedet generator, så banene (og dermed fysikktestene) blir de samme hver gang.
export const TEST_SEED = Number(process.env.TEST_SEED || 7);

export async function open(page, { manual = true, seed = TEST_SEED, query = '' } = {}) {
  await page.addInitScript((seed) => {
    let a = seed;
    Math.random = () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, seed);
  // AI-motstandere er av som standard i testene, så antall trucks er det testene forventer (?ai=N overstyrer).
  const q = /(^|&)ai=/.test(query) ? query : `ai=0${query ? `&${query}` : ''}`;
  await page.goto(manual ? `/?manual=1&${q}` : `/?${q}`);
  await page.waitForFunction(() => !!window.__game);
}

export const state = (page) => page.evaluate(() => window.__game.state());
export const advance = (page, s) => page.evaluate((s) => window.__game.advance(s), s);

// Start from the menu with Enter and skip the countdown.
// Som standard fjernes item-bokser og ramper så fysikktestene er forutsigbare (quiet: false beholder dem).
export async function startRace(page, { quiet = true } = {}) {
  await page.keyboard.press('Enter');
  await advance(page, 0.05); // selve starten (ny bane) skjer i første simuleringssteg
  if (quiet) await page.evaluate(() => window.__game.quiet());
  await advance(page, 3.15);
  const s = await state(page);
  if (s.state !== 'racing') throw new Error(`expected racing, got ${s.state}`);
}

export async function padSet(page, i, btn, value) {
  await page.evaluate(([i, btn, value]) => window.__pads.set(i, btn, value), [i, btn, value]);
}

export const padAxis = (page, i, a, value) => page.evaluate(([i, a, value]) => window.__pads.axis(i, a, value), [i, a, value]);

// Flytter en truck til s langs banen (sideforskyvning lat, `lap` fullførte runder) og lar fysikken sette seg.
export const teleport = (page, i, s, lat = 0, lap = 0) =>
  page.evaluate(([i, s, lat, lap]) => window.__game.teleport(i, s, lat, lap), [i, s, lat, lap]);

// Enkel sjåfør i nettleseren: styrer begge truckene langs midtlinjen med kontrollerne (stikke + R2).
export function driveAll(page, { maxSeconds = 400 } = {}) {
  return page.evaluate(({ maxSeconds }) => {
    const g = window.__game;
    const { track } = g.game;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    for (let step = 0; step < 60 * maxSeconds && g.game.state === 'racing'; step++) {
      g.game.trucks.forEach((t, i) => {
        const target = track.pts[(t.nearest.index + 9) % track.count];
        const want = Math.atan2(target.z - t.z, target.x - t.x);
        const steer = Math.max(-1, Math.min(1, wrap(want - t.theta) * 2.2));
        window.__pads.axis(i, 0, steer);
        window.__pads.set(i, 7, i === 1 ? 0.93 : 1);
      });
      g.simulate(1 / 60);
    }
    g.advance(0);
    return g.state();
  }, { maxSeconds });
}

export const quiet = (page, keepJumps = false) => page.evaluate((k) => window.__game.quiet(k), keepJumps);
