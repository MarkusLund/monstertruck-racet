import { test, expect } from '@playwright/test';
import { open, advance, state, mockGamepads, driveAll } from './helpers.js';

// Finner et løpsfrø der banen krysser seg selv (bro over undergang) i nettleseren.
const findBridgeSeed = (page) => page.evaluate(async () => {
  const { buildTrack } = await import('/src/track.js');
  const { mulberry } = await import('/src/game.js');
  for (let seed = 1; seed < 400; seed++) if (buildTrack(mulberry(seed)).bridge) return seed;
  return null;
});

// Starter et løp (Enter, så spillerne får kontrollerne sine) og bytter til en bane med bro, uten item-bokser og pads.
async function startOnBridge(page) {
  await page.keyboard.press('Enter');
  await advance(page, 0.05);
  const seed = await findBridgeSeed(page);
  await page.evaluate((seed) => { window.__game.game.start(2, seed); window.__game.quiet(); }, seed);
  await advance(page, 3.3);
  expect((await state(page)).state).toBe('racing');
}

test('startoppstilling: alle trucker står på samme s, side om side innenfor veibredden', async ({ page }) => {
  await open(page);
  const rows = await page.evaluate(async () => {
    const { halfWidthAt } = await import('/src/track.js');
    const g = window.__game.game;
    const out = [];
    for (let seed = 1; seed <= 12; seed++) {
      g.start(4, seed * 101);
      out.push({
        s: g.trucks.map((t) => t.s),
        lat: g.trucks.map((t) => t.lat),
        dist: g.trucks.map((t) => t.dist),
        onRoad: g.trucks.map((t) => t.onRoad),
        hw: halfWidthAt(g.track, g.trucks[0].s),
      });
    }
    return out;
  });
  for (const r of rows) {
    for (const s of r.s) expect(s).toBeCloseTo(r.s[0], 1); // ingen starter bak noen
    for (const d of r.dist) expect(d).toBeCloseTo(r.dist[0], 5);
    for (const lat of r.lat) expect(Math.abs(lat) + 1.5).toBeLessThanOrEqual(r.hw); // plass til hele bilen på asfalten
    const sorted = [...r.lat].sort((a, b) => a - b);
    sorted.slice(1).forEach((lat, i) => expect(lat - sorted[i]).toBeGreaterThan(4)); // ikke oppå hverandre
    expect(r.onRoad.every(Boolean)).toBe(true);
  }
});

test('veien er bred ved start og smalner gradvis', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { buildTrack, halfWidthAt, HALF_WIDTH, START_HALF_WIDTH } = await import('/src/track.js');
    const { mulberry } = await import('/src/game.js');
    const out = [];
    for (let seed = 1; seed <= 10; seed++) {
      const track = buildTrack(mulberry(seed));
      const taper = [];
      for (let s = 40; s <= 150; s += 5) taper.push(halfWidthAt(track, s));
      // Banens krumning (rad per meter) de første og siste ~70 m rundt startstreken.
      let maxCurv = 0;
      for (let o = -35; o <= 35; o++) {
        const p = track.pts[(o + track.count) % track.count], q = track.pts[(o + 1 + track.count) % track.count];
        maxCurv = Math.max(maxCurv, Math.abs(Math.atan2(p.tx * q.tz - p.tz * q.tx, p.tx * q.tx + p.tz * q.tz)) / 2);
      }
      out.push({
        start: halfWidthAt(track, 0), before: halfWidthAt(track, track.length - 50), after: halfWidthAt(track, 30),
        taper, min: Math.min(...track.pts.map((p) => p.hw)), far: halfWidthAt(track, track.length / 2), maxCurv,
      });
    }
    return { out, HALF_WIDTH, START_HALF_WIDTH };
  });
  for (const t of r.out) {
    expect(t.start).toBeCloseTo(r.START_HALF_WIDTH, 5);
    expect(t.before).toBeCloseTo(r.START_HALF_WIDTH, 5);
    expect(t.after).toBeCloseTo(r.START_HALF_WIDTH, 5);
    t.taper.slice(1).forEach((w, i) => expect(w).toBeLessThanOrEqual(t.taper[i] + 1e-9)); // smalner bare
    expect(t.taper[0]).toBeGreaterThan(t.taper[t.taper.length - 1] + 3);
    expect(t.far).toBeCloseTo(r.HALF_WIDTH, 5);
    expect(t.min).toBeCloseTo(r.HALF_WIDTH, 5);
    expect(t.maxCurv).toBeLessThan(1 / 150); // rett startstrekning
  }
});

test('banene varierer, er gyldige og helt deterministiske fra frøet', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { buildTrack } = await import('/src/track.js');
    const { mulberry } = await import('/src/game.js');
    const tracks = [];
    for (let seed = 1; seed <= 60; seed++) {
      const t = buildTrack(mulberry(seed));
      tracks.push({ length: t.length, bridge: !!t.bridge, first: [t.pts[7].x, t.pts[7].z], zones: t.zones.length });
    }
    const again = buildTrack(mulberry(5));
    return { tracks, sameFirst: [again.pts[7].x, again.pts[7].z], sameBridge: !!again.bridge };
  });
  for (const t of r.tracks) {
    expect(t.length).toBeGreaterThan(1090);
    expect(t.length).toBeLessThan(2310);
    expect(t.zones).toBe(t.bridge ? 2 : 0);
  }
  expect(r.tracks.filter((t) => t.bridge).length).toBeGreaterThanOrEqual(10); // mange baner krysser seg selv
  expect(r.tracks.filter((t) => !t.bridge).length).toBeGreaterThanOrEqual(10);
  expect(new Set(r.tracks.map((t) => Math.round(t.length / 50))).size).toBeGreaterThan(8); // ulike lengder
  expect(r.sameFirst).toEqual(r.tracks[4].first);
  expect(r.sameBridge).toBe(r.tracks[4].bridge);
});

test('bro: banen krysser seg selv med dekket høyt over undergangen', async ({ page }) => {
  await open(page);
  const seed = await findBridgeSeed(page);
  expect(seed).not.toBeNull();
  const r = await page.evaluate(async (seed) => {
    const T = await import('/src/track.js');
    const g = window.__game.game;
    g.start(2, seed);
    const { track } = g;
    const { bridge } = track;
    const pb = track.pts[bridge.index], pu = track.pts[bridge.under];
    let maxStep = 0;
    for (let i = 0; i < track.count; i++) maxStep = Math.max(maxStep, Math.abs(track.pts[(i + 1) % track.count].deck - track.pts[i].deck));
    const inZone = (s) => track.zones.some((z) => s > z.s0 && s < z.s1);
    return {
      gap: Math.hypot(pb.x - pu.x, pb.z - pu.z),
      cross: Math.abs(pb.tx * pu.tz - pb.tz * pu.tx),
      apart: Math.min(Math.abs(bridge.index - bridge.under), track.count - Math.abs(bridge.index - bridge.under)),
      deckBridge: T.deckAt(track, pb.s), deckUnder: T.deckAt(track, pu.s), deckStart: T.deckAt(track, 0),
      heightBridge: T.heightAt(track, pb.s, 0), heightUnder: T.heightAt(track, pu.s, 0), H: T.BRIDGE_H,
      sideBridge: T.heightAt(track, pb.s, track.pts[bridge.index].hw + 6),
      maxStep,
      pickupsInZones: [...g.coins, ...g.boxes, ...track.pads].filter((c) => inZone(c.s)).length,
      jumpsInZones: track.jumps.filter((j) => inZone(j.s0) || inZone(j.s1)).length,
      railOnBridge: track.fences.kinds[0][bridge.index] === 3 && track.fences.kinds[1][bridge.index] === 3,
      railUnder: track.fences.kinds[0][bridge.under] === 3 || track.fences.kinds[1][bridge.under] === 3,
    };
  }, seed);
  expect(r.gap).toBeLessThan(5); // midtlinjene krysser
  expect(r.cross).toBeGreaterThan(0.7); // tydelig skrått (minst 45 grader)
  expect(r.apart).toBeGreaterThan(100); // delene ligger langt fra hverandre langs banen
  expect(r.deckBridge).toBeCloseTo(r.H, 5);
  expect(r.deckUnder).toBe(0);
  expect(r.deckStart).toBe(0);
  expect(r.heightBridge).toBeCloseTo(r.H, 5);
  expect(r.heightUnder).toBe(0);
  expect(r.sideBridge).toBe(0); // utenfor dekket er det bare luft
  expect(r.maxStep).toBeLessThan(0.3); // jevn oppkjørsel
  expect(r.pickupsInZones).toBe(0);
  expect(r.jumpsInZones).toBe(0);
  expect(r.railOnBridge).toBe(true);
  expect(r.railUnder).toBe(false);
});

test('bro: truckene over og under kolliderer ikke og holder hver sin s', async ({ page }) => {
  await open(page);
  await startOnBridge(page);
  const { sb, su } = await page.evaluate(() => {
    const { bridge } = window.__game.game.track;
    return { sb: bridge.index * 2, su: bridge.under * 2 };
  });
  // Begge midt i kryssingen, rett over hverandre, og de blir stående uten å skyve hverandre bort.
  await page.evaluate(([sb, su]) => { window.__game.teleport(0, sb, 0); window.__game.teleport(1, su, 0); }, [sb, su]);
  await advance(page, 0.5);
  let [a, b] = (await state(page)).trucks;
  expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(5);
  expect(a.y - b.y).toBeGreaterThan(5);
  // Så kjører begge videre langs sin egen del.
  await page.keyboard.down('s');
  await page.keyboard.down('ArrowUp');
  await advance(page, 1.5);
  await page.keyboard.up('s');
  await page.keyboard.up('ArrowUp');
  [a, b] = (await state(page)).trucks;
  expect(a.deck).toBeGreaterThan(5);
  expect(a.y - a.ground).toBeCloseTo(a.deck, 1); // oppe på dekket
  expect(b.deck).toBe(0);
  expect(b.y - b.ground).toBeCloseTo(0, 1); // nede i undergangen
  expect(a.y - b.y).toBeGreaterThan(5);
  expect(a.rescue).toBe(0);
  expect(b.rescue).toBe(0);
  expect(a.onRoad && b.onRoad).toBe(true);
  expect(a.dist).toBeGreaterThan(sb + 10); // begge kom seg framover langs sin egen del
  expect(b.dist).toBeGreaterThan(su + 10);
  expect(Math.abs(a.s - sb - 25)).toBeLessThan(25); // og s hoppet aldri over til den andre delen
  expect(Math.abs(b.s - su - 25)).toBeLessThan(25);
});

test('bro: rekkverket holder trucken på dekket', async ({ page }) => {
  await open(page);
  await startOnBridge(page);
  const sb = await page.evaluate(() => window.__game.game.track.bridge.index * 2);
  await page.evaluate((sb) => {
    window.__game.teleport(0, sb - 30, 6);
    window.__game.game.trucks[0].theta += 0.5; // skrått ut mot rekkverket
  }, sb);
  await page.keyboard.down('s');
  let maxLat = 0, minY = Infinity;
  for (let i = 0; i < 12; i++) {
    await advance(page, 0.25);
    const t = (await state(page)).trucks[0];
    maxLat = Math.max(maxLat, Math.abs(t.lat));
    minY = Math.min(minY, t.y - t.ground);
  }
  await page.keyboard.up('s');
  expect(maxLat).toBeLessThan(11); // aldri utenfor asfalten
  expect(minY).toBeGreaterThan(4); // falt aldri ned fra broen
  expect((await state(page)).trucks[0].rescue).toBe(0);
});

test('bro: autopilot kjører tre runder over og under broen med riktig rundetelling', async ({ page }) => {
  await mockGamepads(page);
  await open(page);
  await page.evaluate(() => { window.__pads.connect(0); window.__pads.connect(1); });
  await startOnBridge(page);
  const r = await page.evaluate(() => {
    const g = window.__game, { track } = g.game;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const bridgeIdx = track.bridge.index, underIdx = track.bridge.under;
    const seen = { bridge: [0, 0], under: [0, 0] }; // antall steg per truck som er midt på broen / midt i undergangen
    const near = (t, idx) => Math.min(Math.abs(t.nearest.index - idx), track.count - Math.abs(t.nearest.index - idx)) < 10;
    let rescues = 0;
    const was = [false, false];
    for (let step = 0; step < 60 * 400 && g.game.state === 'racing'; step++) {
      g.game.trucks.forEach((t, i) => {
        const target = track.pts[(t.nearest.index + 9) % track.count];
        window.__pads.axis(i, 0, Math.max(-1, Math.min(1, wrap(Math.atan2(target.z - t.z, target.x - t.x) - t.theta) * 2.2)));
        window.__pads.set(i, 7, 1);
        if (near(t, bridgeIdx)) { seen.bridge[i]++; }
        if (near(t, underIdx)) seen.under[i]++;
        if (t.rescue > 0 && !was[i]) rescues++;
        was[i] = t.rescue > 0;
      });
      g.simulate(1 / 60);
    }
    g.advance(0);
    return { ...g.state(), seen, rescues, length: track.length };
  });
  expect(r.state).toBe('finished');
  expect(r.winner).not.toBeNull();
  expect(r.trucks[r.winner].dist).toBeGreaterThanOrEqual(3 * r.length); // nøyaktig tre runder, ingen snarveier eller doble tellinger
  expect(r.trucks[r.winner].dist).toBeLessThan(3 * r.length + 40);
  for (const i of [0, 1]) {
    expect(r.seen.bridge[i]).toBeGreaterThan(30);
    expect(r.seen.under[i]).toBeGreaterThan(30);
  }
  expect(r.rescues).toBe(0);
});

// Autopiloten fullfører et helt løp på ulike baner (frøet styrer Math.random og dermed banen).
for (const seed of [1, 2, 3, 4, 5, 6]) {
  test(`autopilot fullfører løp (TEST_SEED ${seed})`, async ({ page }) => {
    await mockGamepads(page);
    await open(page, { seed });
    await page.evaluate(() => { window.__pads.connect(0); window.__pads.connect(1); });
    await page.keyboard.press('Enter');
    await advance(page, 0.05);
    await page.evaluate(() => window.__game.quiet());
    await advance(page, 3.15);
    expect((await state(page)).state).toBe('racing');
    const s = await driveAll(page);
    expect(s.state).toBe('finished');
    expect(s.winner).not.toBeNull();
    expect(s.trucks[s.winner].dist).toBeGreaterThanOrEqual(3 * s.trackLength);
  });
}
