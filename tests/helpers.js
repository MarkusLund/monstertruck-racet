// Shared helpers: a mocked Gamepad API that behaves like two DualSense controllers
// (standard mapping: 0 = ✕, 6 = L2, 7 = R2, 9 = Options).
export const BTN = { CROSS: 0, L2: 6, R2: 7, OPTIONS: 9 };

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
    };
  });
}

export async function open(page, { manual = true } = {}) {
  await page.goto(manual ? '/?manual=1' : '/');
  await page.waitForFunction(() => !!window.__game);
}

export const state = (page) => page.evaluate(() => window.__game.state());
export const advance = (page, s) => page.evaluate((s) => window.__game.advance(s), s);

// Start from the menu with Enter and skip the countdown.
export async function startRace(page) {
  await page.keyboard.press('Enter');
  await advance(page, 3.2);
  const s = await state(page);
  if (s.state !== 'racing') throw new Error(`expected racing, got ${s.state}`);
}

export async function padSet(page, i, btn, value) {
  await page.evaluate(([i, btn, value]) => window.__pads.set(i, btn, value), [i, btn, value]);
}
