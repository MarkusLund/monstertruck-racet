import { test, expect } from '@playwright/test';

// Tilskuermodus: en fjernskjerm som ikke er med i løpet ser alle truckene på delt skjerm,
// med minikart, runder igjen og stilling i midten.
const wait = (page, fn, arg, timeout = 90_000) => page.waitForFunction(fn, arg, { timeout });

async function openPage(browser, url, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(url);
  await wait(page, () => !!window.__game);
  return page;
}

test.describe('Tilskuer', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('en ?watch-skjerm tar ikke plass, og ser alle truckene med minikart og stilling', async ({ browser }) => {
    const room = `t-${Date.now()}-w`;
    const host = await openPage(browser, `/?room=${room}&role=host&manual=1&ai=0`, { width: 640, height: 400 });
    const player = await openPage(browser, `/?room=${room}&role=client&manual=1`, { width: 400, height: 260 });
    const tv = await openPage(browser, `/?room=${room}&role=client&manual=1&watch`, { width: 960, height: 600 });
    await wait(host, () => window.__game.host.peers.size === 2);
    await wait(host, () => [...window.__game.host.peers.values()].some((p) => p.watch));
    await wait(tv, () => window.__game.client.status === 'lobby' && window.__game.client.slot === null);
    await expect(tv.locator('#client-status')).toContainText('Tilskuerskjerm');

    // Verten har to lokale spillere + én fjernspiller. Tilskuerskjermen skal ikke få noen truck.
    await host.keyboard.press('Enter');
    await host.evaluate(() => window.__game.advance(0.05));
    expect((await host.evaluate(() => window.__game.state())).trucks).toHaveLength(3);
    await host.evaluate(() => {
      const g = window.__game;
      const iv = setInterval(() => g.simulate(1 / 20), 50);
      window.__stop = () => clearInterval(iv);
    });

    await wait(tv, () => window.__game.client.status === 'spectate' && window.__game.game.state !== 'menu');
    await expect(tv.locator('.vp')).toHaveCount(3);
    await expect(tv.locator('#racecenter')).toBeVisible();
    await expect(tv.locator('#racecenter.n3')).toHaveCount(1);
    await expect(tv.locator('#client-panel')).toBeHidden();
    await expect(tv.locator('.rc-list li')).toHaveCount(3);
    await expect(tv.locator('.rc-badge')).toHaveText('Tilskuer');
    await wait(tv, () => window.__game.game.state === 'racing', null, 60_000);
    await expect(tv.locator('#rc-lap')).toHaveText('Runde 1/3');
    await expect(tv.locator('#rc-left')).toHaveText('2 runder igjen');

    // Spilleren ser fortsatt bare sin egen truck, uten tilskuerpanel.
    await wait(player, () => window.__game.client.status === 'playing');
    await expect(player.locator('.vp')).toHaveCount(1);
    await expect(player.locator('#racecenter')).toBeHidden();

    // Vertens delte skjerm får også minikartet.
    await host.evaluate(() => window.__game.advance(0));
    await expect(host.locator('#racecenter')).toBeVisible();

    await host.evaluate(() => window.__stop());
    for (const p of [host, player, tv]) expect(p.errors, 'ingen JavaScript-feil').toEqual([]);
  });

  test('en som kobler til midt i et løp ser på til neste løp', async ({ browser }) => {
    const room = `t-${Date.now()}-l`;
    const host = await openPage(browser, `/?room=${room}&role=host&manual=1&ai=0`, { width: 640, height: 400 });
    await host.keyboard.press('Enter');
    await host.evaluate(() => window.__game.advance(0.05));
    await host.evaluate(() => {
      const g = window.__game;
      const iv = setInterval(() => g.simulate(1 / 20), 50);
      window.__stop = () => clearInterval(iv);
    });
    const late = await openPage(browser, `/?room=${room}&role=client&manual=1`, { width: 800, height: 500 });
    await wait(late, () => window.__game.client.status === 'spectate' && !!window.__game.client.cur);
    await expect(late.locator('.vp')).toHaveCount(2);
    await expect(late.locator('#racecenter.n2')).toBeVisible();
    await expect(late.locator('.rc-badge')).toContainText('neste løp');
    await host.evaluate(() => window.__stop());
    for (const p of [host, late]) expect(p.errors, 'ingen JavaScript-feil').toEqual([]);
  });
});
