import { buildTrack, placeCoins, placeItemBoxes, posAt, wrapS } from './track.js';
import { Truck, TURBO_TIME, SHIELD_TIME, STUN_TIME } from './truck.js';

export const DT = 1 / 60;
export const LAPS = 3;
const COUNTDOWN = 3;
const COIN_RADIUS = 2.4;
const BOX_RADIUS = 3.4;
const BOX_COOLDOWN = 6;
const TRUCK_RADIUS = 2.5; // sirkel brukt til kollisjon mellom trucker
const ROCKET_SPEED = 80;
const BARRICADE_AHEAD = 60;
const BARRICADE_LIFE = 14;
const BARRICADE_HALF_WIDTH = 9.4; // dekker hele asfalten: den som ligger foran må kjøre omveien i gresset
const GRID = [{ lat: -3.5, back: 7 }, { lat: 3.5, back: 7 }]; // startoppstilling bak streken

const wrapDiff = (d, length) => d - Math.round(d / length) * length;

// Spilltilstander: 'menu' -> 'countdown' -> 'racing' -> 'finished'
export class Game {
  constructor(rand = Math.random) {
    this.rand = rand;
    this.trucks = [new Truck(0), new Truck(1)];
    this.state = 'menu';
    this.events = [];
    this.newRace(true);
  }

  // Ny bane hver gang et løp starter (og for forhåndsvisningen på startskjermen).
  newRace(newTrack = false) {
    if (newTrack || !this.track) this.track = buildTrack(this.rand);
    const { track } = this;
    this.trucks.forEach((t, i) => {
      t.score = 0;
      t.finished = false;
      t.lapsDone = 0;
      t.place(track, track.length - GRID[i].back, GRID[i].lat, -GRID[i].back);
    });
    this.coins = placeCoins(track, this.rand);
    this.boxes = placeItemBoxes(track);
    this.projectiles = [];
    this.barricades = [];
    this.time = 0;
    this.countdown = COUNTDOWN;
    this.winner = null;
    this.finishTime = 0;
    this.coinLap = 0;
  }

  start() {
    this.newRace(true);
    this.state = 'countdown';
    this.stateTime = 0;
  }

  toMenu() {
    this.newRace(true);
    this.state = 'menu';
  }

  emit(e) { this.events.push(e); }

  // Rundenummer (1..LAPS) for en truck.
  lap(t) { return Math.min(LAPS, Math.floor(Math.max(0, t.dist) / this.track.length) + 1); }

  progress(t) {
    return Math.max(0, Math.min(1, t.dist / (this.track.length * LAPS)));
  }

  // 1 for lederen, 2 for den bakerste.
  place(t) {
    const other = this.trucks[1 - t.id];
    return t.dist >= other.dist ? 1 : 2;
  }

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
    if (!locked) this.updateAssists();
    this.trucks.forEach((t, i) => {
      t.step(inputs[i], DT, this.track, locked);
      if (t.landed) this.emit({ type: 'land', truck: t.id });
    });
    this.collideTrucks();
    this.updateBarricades();
    this.updateProjectiles();
    this.trucks.forEach((t) => this.afterStep(t));
    for (const b of this.boxes) b.cooldown = Math.max(0, b.cooldown - DT);
  }

  // Slipstream (kjører tett bak den andre) og strikk-effekt (den som ligger langt bak får litt hjelp).
  updateAssists() {
    const { length } = this.track;
    for (const t of this.trucks) {
      const o = this.trucks[1 - t.id];
      const ahead = wrapDiff(o.s - t.s, length);
      const inTow = ahead > 3 && ahead < 26 && Math.abs(o.lat - t.lat) < 4.5 && o.speed > 12 && t.speed > 8 && !t.air && !t.finished;
      t.draft = inTow ? Math.min(1, t.draft + DT / 0.7) : Math.max(0, t.draft - DT / 0.4);
      const gap = o.dist - t.dist;
      t.catchup = this.state === 'racing' ? Math.max(0, Math.min(1, (gap - 25) / 120)) : 0;
    }
  }

  // Trucker som kjører inn i hverandre dytter og spretter. Hopper man over den andre (høydeforskjell) går man klar.
  collideTrucks() {
    const [a, b] = this.trucks;
    const dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 0.001;
    const min = TRUCK_RADIUS * 2;
    if (d >= min || Math.abs(a.y - b.y) > 1.8) return;
    const nx = dx / d, nz = dz / d;
    const push = (min - d) / 2;
    a.x -= nx * push; a.z -= nz * push;
    b.x += nx * push; b.z += nz * push;
    const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
    if (rel < 0) {
      const j = (-(1 + 0.5) * rel) / 2;
      a.vx -= nx * j; a.vz -= nz * j;
      b.vx += nx * j; b.vz += nz * j;
      if (-rel > 5) this.emit({ type: 'bump', truck: a.id });
    }
  }

  // Veisperrer: tette kloss over hele asfalten som forsvinner etter en stund.
  updateBarricades() {
    const { length } = this.track;
    this.barricades = this.barricades.filter((bar) => (bar.life -= DT) > 0);
    for (const bar of this.barricades) {
      for (const t of this.trucks) {
        const ds = wrapDiff(t.s - bar.s, length);
        if (Math.abs(ds) > 4.2 || Math.abs(t.lat - bar.lat) > bar.halfWidth + 1.4 || t.y > 1.4) continue;
        if (t.shield > 0) {
          t.shield = 0;
          bar.life = 0;
          t.say('Skjoldet knuste veisperren!');
          this.emit({ type: 'hit', truck: t.id });
          continue;
        }
        // Skyv trucken tilbake på den siden den kom fra, og ta av mesteparten av farten.
        const side = ds >= 0 ? 1 : -1;
        const n = t.nearest;
        const move = side * 4.2 - ds;
        t.x += n.tx * move;
        t.z += n.tz * move;
        const along = t.vx * n.tx + t.vz * n.tz;
        if (along * side < 0) {
          t.vx -= n.tx * along * 1.3;
          t.vz -= n.tz * along * 1.3;
        }
        t.vx *= 0.6; t.vz *= 0.6;
        if (!bar.hit) { bar.hit = true; this.emit({ type: 'bump', truck: t.id }); }
        t.say('Veisperre! Ta omveien i gresset');
      }
    }
  }

  updateProjectiles() {
    this.projectiles = this.projectiles.filter((p) => {
      p.age += DT;
      const target = this.trucks[p.target];
      const dx = target.x - p.x, dz = target.z - p.z;
      const d = Math.hypot(dx, dz) || 0.001;
      if (d < 3 || p.age > 4) {
        if (d < 3) this.hitByRocket(target);
        return false;
      }
      p.x += (dx / d) * ROCKET_SPEED * DT;
      p.z += (dz / d) * ROCKET_SPEED * DT;
      p.dir = Math.atan2(dz, dx);
      return true;
    });
  }

  hitByRocket(t) {
    if (t.shield > 0) {
      t.shield = 0;
      t.say('Skjoldet reddet deg!');
    } else {
      t.stun = STUN_TIME;
      t.say('Truffet av rakett!');
    }
    this.emit({ type: 'hit', truck: t.id });
  }

  // Delte ut et tilfeldig power-up. Den som ligger bak får bedre (og mer skadelige) ting enn lederen.
  giveItem(t) {
    const other = this.trucks[1 - t.id];
    const pool = this.place(t) === 1 ? ['turbo', 'shield'] : ['turbo', 'rocket', 'barricade'];
    const item = pool[Math.floor(this.rand() * pool.length)];
    if (item === 'turbo') {
      t.turbo = TURBO_TIME;
      t.say('TURBO!');
    } else if (item === 'shield') {
      t.shield = SHIELD_TIME;
      t.say('Skjold!');
    } else if (item === 'rocket') {
      this.projectiles.push({ x: t.x, z: t.z, owner: t.id, target: other.id, age: 0, dir: t.theta });
      t.say('Rakett!');
    } else {
      let s = other.s + BARRICADE_AHEAD;
      for (const j of this.track.jumps) {
        const w = ((s % this.track.length) + this.track.length) % this.track.length;
        if (w > j.s0 - 6 && w < j.s1 + 12) s = j.s1 + 14;
      }
      const p = posAt(this.track, s, 0);
      this.barricades.push({ s: wrapS(this.track, s), x: p.x, z: p.z, theta: p.theta, lat: 0, halfWidth: BARRICADE_HALF_WIDTH, life: BARRICADE_LIFE, hit: false });
      t.say('Veisperre lagt ut!');
      other.say('Veisperre foran!', 2.4);
    }
    this.emit({ type: 'item', truck: t.id, item });
  }

  afterStep(t) {
    // Mynter
    for (const c of this.coins) {
      if (c.taken || Math.abs(c.x - t.x) > COIN_RADIUS || Math.abs(c.z - t.z) > COIN_RADIUS) continue;
      if (Math.hypot(c.x - t.x, c.z - t.z) < COIN_RADIUS) {
        c.taken = true;
        c.takenBy = t.id;
        t.score++;
        this.emit({ type: 'coin', truck: t.id });
      }
    }
    // Item-bokser
    if (this.state === 'racing' && t.y < 2.5) {
      for (const b of this.boxes) {
        if (b.cooldown > 0 || Math.abs(b.x - t.x) > BOX_RADIUS || Math.abs(b.z - t.z) > BOX_RADIUS) continue;
        if (Math.hypot(b.x - t.x, b.z - t.z) < BOX_RADIUS) {
          b.cooldown = BOX_COOLDOWN;
          this.giveItem(t);
        }
      }
    }

    if (this.state !== 'racing') return;

    // Ny runde
    const done = Math.max(0, Math.floor(t.dist / this.track.length));
    if (done > t.lapsDone && !t.finished) {
      t.lapsDone = done;
      if (done < LAPS) this.emit({ type: 'lap', truck: t.id });
    }
    // Mynter dukker opp igjen når en ny runde starter for den som leder.
    const lead = Math.max(...this.trucks.map((q) => Math.floor(Math.max(0, q.dist) / this.track.length)));
    if (lead > this.coinLap) {
      this.coinLap = lead;
      for (const c of this.coins) { c.taken = false; c.takenBy = null; }
    }

    // Mål
    if (!t.finished && t.dist >= this.track.length * LAPS) {
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
}
