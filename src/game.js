import { World, Vec2, Chain } from 'planck';
import { buildTrack, groundAt, slopeAt, pitAt, placeCoins } from './track.js';
import { Truck, CAT_GROUND, CAT_TRUCK } from './truck.js';

export const DT = 1 / 60;
const COUNTDOWN = 3;
const COIN_RADIUS = 1.35;

// Game states: 'menu' -> 'countdown' -> 'racing' -> 'finished'
export class Game {
  constructor(rand = Math.random) {
    this.rand = rand;
    this.track = buildTrack();
    this.state = 'menu';
    this.events = [];
    this.newRace();
  }

  newRace() {
    const world = new World({ gravity: Vec2(0, -13) });
    const ground = world.createBody({ type: 'static', userData: 'ground' });
    ground.createFixture({
      shape: new Chain(this.track.points.map((p) => Vec2(p.x, p.y)), false),
      friction: 0.95,
      filterCategoryBits: CAT_GROUND,
      filterMaskBits: CAT_TRUCK,
    });
    this.world = world;
    this.trucks = [0, 1].map((id) => new Truck(world, id, this.track.startX, 3));
    for (const t of this.trucks) t.place(this.track.startX, groundAt(this.track, this.track.startX));
    this.coins = placeCoins(this.track, this.rand);
    this.time = 0;
    this.countdown = COUNTDOWN;
    this.winner = null;
    this.finishTime = 0;
  }

  start() {
    this.newRace();
    this.state = 'countdown';
    this.stateTime = 0;
  }

  toMenu() {
    this.newRace();
    this.state = 'menu';
  }

  emit(e) { this.events.push(e); }

  step(inputs) {
    this.stateTime = (this.stateTime || 0) + DT;
    if (this.state === 'menu') return;
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= DT;
      if (Math.ceil(this.countdown) !== before && this.countdown > 0) this.emit({ type: 'tick' });
      if (this.countdown <= 0) {
        this.state = 'racing';
        this.stateTime = 0;
        this.emit({ type: 'go' });
      }
    } else if (this.state === 'racing') {
      this.time += DT;
    }
    const locked = this.state === 'countdown';
    this.trucks.forEach((t, i) => t.control(inputs[i], DT, locked));
    this.world.step(DT, 10, 4);
    for (const t of this.trucks) this.afterStep(t);
  }

  afterStep(t) {
    const track = this.track;
    const { x, y } = t.chassis.getPosition();
    t.maxX = Math.max(t.maxX, x);

    // Fell into a pit (or out of the world): respawn on the ground before the pit.
    const pit = pitAt(track, x);
    if ((pit && y < Math.min(pit.rimY, pit.landY) - 1.5) || y < -60) {
      const p = pit || [...track.pits].reverse().find((q) => q.x0 < x) || null;
      const rx = p ? p.respawnX : track.startX;
      t.place(rx, groundAt(track, rx), slopeAt(track, rx));
      t.respawns++;
      this.emit({ type: 'respawn', truck: t.id });
      return;
    }

    // Stuck on the roof: flip back upright after a moment.
    const upside = Math.cos(t.angle) < -0.1;
    if (upside && t.speed() < 3) t.flipTimer += DT; else t.flipTimer = 0;
    if (t.flipTimer > 1.5) {
      const rx = pitAt(track, x) ? pitAt(track, x).respawnX : x;
      t.place(rx, groundAt(track, rx), slopeAt(track, rx));
      this.emit({ type: 'flip', truck: t.id });
    }

    // Coins
    const wheels = t.wheels.map((w) => w.getPosition());
    for (const c of this.coins) {
      if (c.taken || Math.abs(c.x - x) > 4) continue;
      const near = Math.hypot(c.x - x, c.y - y) < COIN_RADIUS + 0.4
        || wheels.some((w) => Math.hypot(c.x - w.x, c.y - w.y) < COIN_RADIUS);
      if (near) {
        c.taken = true;
        c.takenBy = t.id;
        t.score++;
        this.emit({ type: 'coin', truck: t.id });
      }
    }

    // Finish line
    if (this.state === 'racing' && !t.finished && x >= track.goalX) {
      t.finished = true;
      if (this.winner === null) {
        this.winner = t.id;
        this.finishTime = this.time;
        this.state = 'finished';
        this.stateTime = 0;
        this.emit({ type: 'finish', truck: t.id });
      }
    }
  }

  progress(t) {
    return Math.max(0, Math.min(1, (t.x - this.track.startX) / (this.track.goalX - this.track.startX)));
  }
}
