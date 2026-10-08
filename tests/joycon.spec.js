import { test, expect } from '@playwright/test';
import { open, advance, startRace, state } from './helpers.js';
import { parsePacket } from '../server/joycon.js';

// Knappebiter fra switch2mac (samme som i src/joycon.js).
const BIT = { srR: 0x10, slR: 0x20, srL: 0x100000, slL: 0x200000, zl: 0x800000, dpadRight: 0x40000, plus: 0x200 };

test.describe('Joy-Con 2 via UDP-broen', () => {
  test('pakkene fra switch2mac leses riktig', () => {
    const buf = Buffer.alloc(44);
    buf.write('S2B1', 0, 'latin1');
    buf.writeUInt32LE(7, 4);
    buf.writeUInt32LE(BIT.srL | BIT.dpadRight, 8);
    buf.writeFloatLE(0.5, 12);
    buf.writeFloatLE(-0.25, 16);
    expect(parsePacket(buf)).toEqual({ t: 'j', b: BIT.srL | BIT.dpadRight, lx: 0.5, ly: -0.25 });
    expect(parsePacket(Buffer.concat([Buffer.from('S2N1'), Buffer.from('Joy-Con 2 (R)')]))).toEqual({ t: 'n', n: 'Joy-Con 2 (R)' });
    expect(parsePacket(Buffer.from('tull'))).toBeNull();
  });

  test('enkelt Joy-Con holdt sidelengs: SR gasser, SL bremser, knapp hopper, stikken styrer', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async (BIT) => {
      const { toPad } = await import('/src/joycon.js');
      const pad = (slot, name, b, ly = 0) => toPad(slot, { b, lx: 0, ly }, name);
      const btn = (p, i) => p.buttons[i].pressed;
      const L = pad(0, 'Joy-Con 2 (L)', BIT.srL | BIT.dpadRight, 0.8);
      const R = pad(1, 'Joy-Con 2 (R)', BIT.slR | BIT.plus, 0.8);
      return {
        lGass: btn(L, 7), lBrems: btn(L, 6), lHopp: btn(L, 2), lStyr: L.axes[0],
        rGass: btn(R, 7), rBrems: btn(R, 6), rBekreft: btn(R, 9), rStyr: R.axes[0],
        mapping: L.mapping, index: L.index,
      };
    }, BIT);
    expect(r).toMatchObject({ lGass: true, lBrems: false, lHopp: true, rGass: false, rBrems: true, rBekreft: true });
    expect(r.lStyr).toBeCloseTo(-0.8); // verifisert på ekte venstre Joy-Con (første forsøk styrte feil vei)
    expect(r.rStyr).toBeCloseTo(0.8); // høyre Joy-Con er rotert motsatt vei (ikke verifisert på maskinvare)
    expect(r.mapping).toBe('standard');
    expect(r.index).toBe(100);
  });

  test('frontknappene: høyre gasser, ned bremser, opp og venstre hopper (venstre og høyre Joy-Con)', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(async () => {
      const { toPad } = await import('/src/joycon.js');
      const press = (name, b) => { const p = toPad(0, { b, lx: 0, ly: 0 }, name); return [7, 6, 2].map((i) => p.buttons[i].pressed); };
      // [gass, brems, hopp]
      const L = { right: 0x10000, down: 0x80000, up: 0x40000, left: 0x20000 }; // pil ned, venstre, høyre, opp
      const R = { right: 0x2, down: 0x8, up: 0x1, left: 0x4 }; // X, A, Y, B
      const out = {};
      for (const [side, m] of [['L', L], ['R', R]]) {
        for (const dir of Object.keys(m)) out[`${side}-${dir}`] = press(`Joy-Con 2 (${side})`, m[dir]);
      }
      return out;
    });
    for (const side of ['L', 'R']) {
      expect(r[`${side}-right`]).toEqual([true, false, false]);
      expect(r[`${side}-down`]).toEqual([false, true, false]);
      expect(r[`${side}-up`]).toEqual([false, false, true]);
      expect(r[`${side}-left`]).toEqual([false, false, true]);
    }
  });

  test('fire Joy-Con-er blir fire lokale spillere som gasser hver for seg', async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const { toPad } = await import('/src/joycon.js');
      const names = ['Joy-Con 2 (L)', 'Joy-Con 2 (R)', 'Joy-Con 2 (R)', 'Joy-Con 2 (L)'];
      window.__jc = { b: [0, 0, 0, 0] };
      const SR = { 'Joy-Con 2 (L)': 0x100000, 'Joy-Con 2 (R)': 0x10 };
      window.__setBridge = () => {
        window.__game.input.bridge = {
          pads: () => names.map((n, i) => toPad(i, { b: window.__jc.b[i] ? SR[n] : 0, lx: 0, ly: 0 }, n)),
          rumble() {},
        };
      };
    });
    await page.evaluate(() => window.__setBridge());
    await advance(page, 0.1);
    await expect(page.locator('#pad-status-2')).toContainText('Joy-Con tilkoblet');
    await expect(page.locator('#pad-status-3')).toContainText('Joy-Con tilkoblet');
    await startRace(page);
    expect((await state(page)).trucks).toHaveLength(4);
    await page.evaluate(() => { window.__jc.b[3] = 1; });
    await advance(page, 1.5);
    const t = (await state(page)).trucks;
    expect(t[3].speed).toBeGreaterThan(2);
    expect(t[2].speed).toBeLessThan(0.5);
  });
});
