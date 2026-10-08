import { test, expect } from '@playwright/test';
import { open } from './helpers.js';

// Kjører ett helt løp med én AI-truck i ren simulering (uten main.js-løkka) og returnerer sluttid og antall redninger.
const runRace = (page, seed, level, maxSeconds = 400) => page.evaluate(async ([seed, level, maxSeconds]) => {
  const { Game, DT } = await import('/src/game.js');
  const { createAI } = await import('/src/ai.js');
  const game = new Game(() => 0.5, 1);
  game.start(1, seed);
  const ai = createAI(seed, 0, level);
  const t = game.trucks[0];
  let rescues = 0, wasRescue = false, maxStill = 0, still = 0;
  for (let n = 0; n < maxSeconds / DT && game.state !== 'finished'; n++) {
    game.step([game.state === 'racing' ? ai.input(game, 0) : { throttle: 0, steer: 0 }]);
    game.events.length = 0;
    if (t.rescue > 0 && !wasRescue) rescues++;
    wasRescue = t.rescue > 0;
    still = game.state === 'racing' && t.rescue === 0 && t.speed < 1.5 ? still + DT : 0;
    maxStill = Math.max(maxStill, still);
  }
  return { finished: game.state === 'finished', time: game.time, rescues, maxStill };
}, [seed, level, maxSeconds]);

const SEEDS = [7, 3, 11];
const LIMITS = [300, 220, 190]; // sekunder per nivå (generøse grenser)

for (const [level, name] of ['lett', 'middels', 'vanskelig'].entries()) {
  test(`AI på nivå ${name} fullfører et helt løp uten å sette seg fast`, async ({ page }) => {
    await open(page);
    for (const seed of SEEDS) {
      const r = await runRace(page, seed, level);
      expect(r.finished, `frø ${seed}`).toBe(true);
      expect(r.time, `frø ${seed}`).toBeLessThan(LIMITS[level]);
      expect(r.maxStill, `frø ${seed}`).toBeLessThan(3.5);
    }
  });
}

test('AI på Lett er tregere enn på Vanskelig', async ({ page }) => {
  await open(page);
  const seeds = [7, 3, 11, 5];
  let easy = 0, hard = 0;
  for (const seed of seeds) {
    easy += (await runRace(page, seed, 0)).time;
    hard += (await runRace(page, seed, 2)).time;
  }
  expect(easy / seeds.length).toBeGreaterThan((hard / seeds.length) * 1.1);
});

test('AI er deterministisk for samme frø og nivå', async ({ page }) => {
  await open(page);
  for (const level of [0, 1, 2]) {
    const a = await runRace(page, 7, level);
    const b = await runRace(page, 7, level);
    expect(b.time).toBe(a.time);
  }
});

test('AI kommer seg i gang igjen etter å ha stått vendt feil vei', async ({ page }) => {
  await open(page);
  const dist = await page.evaluate(async () => {
    const { Game, DT } = await import('/src/game.js');
    const { createAI } = await import('/src/ai.js');
    const game = new Game(() => 0.5, 1);
    game.start(1, 7);
    while (game.state !== 'racing') game.step([{ throttle: 0, steer: 0 }]);
    const t = game.trucks[0];
    t.theta += Math.PI;
    const ai = createAI(7, 0, 2);
    for (let n = 0; n < 40 / DT; n++) game.step([ai.input(game, 0)]);
    return t.dist;
  });
  expect(dist).toBeGreaterThan(200);
});
