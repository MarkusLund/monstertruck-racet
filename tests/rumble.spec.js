import { test, expect } from '@playwright/test';
import { mockGamepads, open, startRace, advance } from './helpers.js';
import { rumbleFor } from '../src/rumble.js';
import { rumblePacket } from '../server/joycon.js';

test.describe('Vibrasjon', () => {
  test('hendelser gir vibrasjon etter hvor hardt det treffer', () => {
    const rocket = rumbleFor({ type: 'hit', truck: 2, cause: 'rocket', shielded: false })[0];
    const shielded = rumbleFor({ type: 'hit', truck: 2, cause: 'rocket', shielded: true })[0];
    expect(rocket).toMatchObject({ truck: 2 });
    expect(rocket.strong).toBeGreaterThan(shielded.strong);
    // Et hardt støt kjennes mer enn et lett, og begge trucker kjenner det.
    const soft = rumbleFor({ type: 'bump', truck: 0, other: 1, power: 5.5 });
    const hard = rumbleFor({ type: 'bump', truck: 0, other: 1, power: 20 });
    expect(soft.map((r) => r.truck)).toEqual([0, 1]);
    expect(hard[0].strong).toBeGreaterThan(soft[0].strong);
    expect(hard[0].ms).toBeGreaterThan(soft[0].ms);
    expect(rumbleFor({ type: 'bump', truck: 3, power: 8 }).map((r) => r.truck)).toEqual([3]);
    // Start gjelder alle, og ukjente hendelser (som nedtellingen) er stille.
    expect(rumbleFor({ type: 'go' })[0].truck).toBeNull();
    expect(rumbleFor({ type: 'tick' })).toEqual([]);
    for (const type of ['land', 'rescue', 'item', 'coin', 'lap', 'finish']) {
      const r = rumbleFor({ type, truck: 1 });
      expect(r, type).toHaveLength(1);
      expect(r[0].strong + r[0].weak, type).toBeGreaterThan(0);
    }
  });

  test('rumble-pakken til switch2mac har riktig format og begrenses til 0–255', () => {
    expect([...rumblePacket(255, 128)]).toEqual([0x53, 0x32, 0x52, 0x31, 255, 128]);
    expect([...rumblePacket(-5, 999)]).toEqual([0x53, 0x32, 0x52, 0x31, 0, 255]);
    expect([...rumblePacket('x', undefined)]).toEqual([0x53, 0x32, 0x52, 0x31, 0, 0]);
  });

  test('en rakett-treff vibrerer kontrolleren til spilleren som ble truffet, ikke de andres', async ({ page }) => {
    await mockGamepads(page);
    await open(page);
    await page.evaluate(() => {
      window.__fx = [];
      const spy = (i) => ({ playEffect: (type, p) => { window.__fx.push({ i, type, ...p }); return Promise.resolve(); } });
      window.__pads.connect(0, { vibrationActuator: spy(0) });
      window.__pads.connect(1, { vibrationActuator: spy(1) });
    });
    await advance(page, 0.1);
    await startRace(page);
    await page.evaluate(() => { window.__fx.length = 0; window.__game.game.emit({ type: 'hit', truck: 1, cause: 'rocket', shielded: false }); });
    await advance(page, 0.05);
    const fx = await page.evaluate(() => window.__fx);
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ i: 1, type: 'dual-rumble' });
    expect(fx[0].strongMagnitude).toBeGreaterThan(0.8);
    expect(fx[0].duration).toBeGreaterThan(300);
  });

  test('Joy-Con via broen: rumble sendes jevnlig mens den varer, og nullstilles til slutt', async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { toPad } = await import('/src/joycon.js');
      window.__sent = [];
      window.__game.input.bridge = {
        pads: () => [toPad(2, { b: 0, lx: 0, ly: 0 }, 'Joy-Con 2 (L)')],
        rumble: (slot, strong, weak) => window.__sent.push({ slot, strong, weak }),
      };
    });
    await advance(page, 0.1);
    await page.evaluate(() => window.__game.input.rumble(0, 0.8, 0.4, 300));
    await advance(page, 0.1);
    let sent = await page.evaluate(() => window.__sent.slice());
    expect(sent[0]).toEqual({ slot: 2, strong: 0.8, weak: 0.4 }); // pad.index 102 → plass 2 i appen
    await page.waitForTimeout(450);
    await advance(page, 0.05);
    sent = await page.evaluate(() => window.__sent.slice());
    expect(sent.at(-1)).toEqual({ slot: 2, strong: 0, weak: 0 });
    const n = sent.length;
    await advance(page, 0.2);
    expect(await page.evaluate(() => window.__sent.length)).toBe(n); // ingen mer etter at den er stoppet
  });
});
