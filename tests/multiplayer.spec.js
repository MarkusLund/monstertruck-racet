import { test, expect } from '@playwright/test';

// Vert (localhost) + fjernspillere i egne nettleservinduer, koblet sammen via relayen på /ws.
// Hver test bruker et eget rom, så testene kan kjøre parallelt uten å forstyrre hverandre.
const wait = (page, fn, arg, timeout = 90_000) => page.waitForFunction(fn, arg, { timeout });

async function openHost(browser, room) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(`/?room=${room}&role=host&manual=1&ai=0`);
  await wait(page, () => !!window.__game);
  return page;
}

async function openClient(browser, room) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 260 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(`/?room=${room}&role=client&manual=1`);
  await wait(page, () => !!window.__game);
  return page;
}

test.describe('Flerspiller', () => {
  test.describe.configure({ mode: 'serial', timeout: 400_000 }); // mange programvare-rendrede nettlesere samtidig er tungt
  test('tre fjernspillere kan bli med, og vertens 4-delte skjerm viser alle', async ({ browser }) => {
    const room = `t-${Date.now()}-a`;
    const host = await openHost(browser, room);
    // Verten spiller bare selv (spiller 1), så det er plass til tre fjernspillere.
    await host.keyboard.press('p');
    await host.evaluate(() => window.__game.advance(0.05));
    const clients = [];
    for (let i = 0; i < 3; i++) clients.push(await openClient(browser, room));
    await wait(host, () => window.__game.host.peers.size === 3);
    for (const c of clients) await wait(c, () => window.__game.client.status === 'lobby');

    // Spilltrafikken skal gå direkte mellom nettleserne (WebRTC), ikke via relayen.
    await wait(host, () => window.__game.state().net.direct === 3);
    for (const c of clients) await wait(c, () => window.__game.state().net.direct === 1);

    // Start løpet fra verten. Alle klientene får hver sin plass.
    await host.keyboard.press('Enter');
    await host.evaluate(() => window.__game.advance(0.05));
    const s = await host.evaluate(() => window.__game.state());
    expect(s.trucks).toHaveLength(4);
    expect(s.net.slots).toBe(4);
    await expect(host.locator('.vp')).toHaveCount(4);

    const slots = [];
    for (const c of clients) {
      await wait(c, () => window.__game.client.slot !== null);
      slots.push(await c.evaluate(() => window.__game.client.slot));
    }
    expect([...slots].sort()).toEqual([1, 2, 3]);

    // Verten trår gasen; fjernspillerne holder inne gass. Alle skal bevege seg.
    await host.keyboard.down('w');
    await clients[0].keyboard.down('w');
    await clients[1].keyboard.down('ArrowUp');
    // Sanntidskjøring (ikke manuell): sett verten i gang med stegene sine.
    await host.evaluate(() => {
      const g = window.__game;
      const iv = setInterval(() => g.simulate(1 / 20), 50);
      window.__stop = () => clearInterval(iv);
    });
    await wait(host, () => window.__game.state().state === 'racing' && window.__game.state().trucks[1].dist > 15, null, 60_000);
    const r = await host.evaluate(() => window.__game.state());
    expect(r.trucks[0].dist).toBeGreaterThan(5);
    expect(r.trucks[1].dist, 'gass fra fjernspiller 1 når fram').toBeGreaterThan(5);

    // Klientene ser samme bane og sin egen truck i bevegelse.
    const seed = r.net.seed;
    await wait(clients[0], (sd) => window.__game.game.seed === sd && window.__game.game.state === 'racing', seed, 60_000);
    const cs = await clients[0].evaluate(() => window.__game.state());
    expect(cs.net.seed).toBe(seed);
    expect(cs.trucks).toHaveLength(4);
    await expect(clients[0].locator('.vp')).toHaveCount(1);

    await host.evaluate(() => window.__stop());
    for (const p of [host, ...clients]) expect(p.errors, 'ingen JavaScript-feil').toEqual([]);
  });

  test('en femte spiller får beskjed om at løpet er fullt', async ({ browser }) => {
    const room = `t-${Date.now()}-b`;
    const host = await openHost(browser, room);
    const clients = [];
    for (let i = 0; i < 3; i++) clients.push(await openClient(browser, room));
    await wait(host, () => window.__game.host.peers.size === 3);
    await host.keyboard.press('Enter');
    await host.evaluate(() => window.__game.advance(0.05));
    // Verten spiller selv med to lokale spillere, så bare to fjernspillere får plass (maks 4 totalt).
    const s = await host.evaluate(() => window.__game.state());
    expect(s.trucks).toHaveLength(4);
    await wait(clients[2], () => window.__game.client.status === 'full');
  });

  test('en klient som kobler til uten vert venter, og får beskjed når verten kommer', async ({ browser }) => {
    const room = `t-${Date.now()}-c`;
    const client = await openClient(browser, room);
    await wait(client, () => window.__game.client.status === 'nohost');
    await expect(client.locator('#client-status')).toContainText('Venter på at verten');
    const host = await openHost(browser, room);
    await wait(client, () => window.__game.client.status === 'lobby');
    expect(host.errors).toEqual([]);
  });
});
