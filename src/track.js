// Track geometry. Coordinates are in meters, y points up.
// The ground is one continuous polyline; pits are notches (walls + floor) in it.

class Builder {
  constructor() {
    this.pts = [{ x: -20, y: 30 }, { x: -20, y: 0 }, { x: 0, y: 0 }];
    this.pits = [];
    this.features = [];
  }
  get x() { return this.pts[this.pts.length - 1].x; }
  get y() { return this.pts[this.pts.length - 1].y; }
  add(x, y) { this.pts.push({ x, y }); }

  // Curve from current point over dx; f(t) maps 0..1 -> 0..1 of dy.
  curve(dx, dy, f, step = 0.5) {
    const x0 = this.x, y0 = this.y;
    const n = Math.max(2, Math.ceil(dx / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      this.add(x0 + dx * t, y0 + dy * f(t));
    }
    return this;
  }
  flat(len) { return this.curve(len, 0, (t) => t, 4); }
  line(dx, dy) { return this.curve(dx, dy, (t) => t); }
  smooth(dx, dy) { return this.curve(dx, dy, (t) => (1 - Math.cos(Math.PI * t)) / 2); }
  // Concave ramp that gets steeper toward the tip - launches the truck.
  kicker(len, h) {
    this.features.push({ type: h >= 7 ? 'bigramp' : 'ramp', x: this.x + len, h });
    return this.curve(len, h, (t) => t * t, 0.4);
  }
  hills(len, amp, waves) {
    return this.curve(len, 0, (t) => 0, 0.5).reshapeLast(len, (t) => amp * (1 - Math.cos(2 * Math.PI * waves * t)) / 2);
  }
  reshapeLast(len, g) {
    const x1 = this.x, x0 = x1 - len, base = this.y;
    for (const p of this.pts) {
      if (p.x > x0 && p.x <= x1) p.y = base + g((p.x - x0) / len);
    }
    return this;
  }
  bumps(count, width, h) {
    for (let i = 0; i < count; i++) this.curve(width, 0, () => 0, 0.25).reshapeLast(width, (t) => h * Math.sin(Math.PI * t));
    return this;
  }
  // A pit: vertical walls and a floor. Trucks that fall in respawn at `runway` meters before it.
  pit(width, depth = 10, landDy = 0, runway = 30) {
    const x0 = this.x, rimY = this.y;
    const floorY = Math.min(rimY, rimY + landDy) - depth;
    this.add(x0 + 0.3, floorY);
    this.add(x0 + width - 0.3, floorY);
    this.add(x0 + width, rimY + landDy);
    this.pits.push({ x0, x1: x0 + width, rimY, landY: rimY + landDy, floorY, respawnX: x0 - runway });
    return this;
  }
}

export function buildTrack() {
  const b = new Builder();
  b.flat(45);
  b.bumps(5, 4, 0.5);
  b.flat(15);
  b.kicker(8, 1.6).line(10, -1.6);
  b.flat(20);
  b.hills(90, 3.5, 3);
  b.flat(15);
  b.kicker(16, 4).smooth(22, -4);
  b.flat(35);
  b.kicker(6, 1).pit(8, 10, -1).flat(25); // pit 1
  b.smooth(30, 16).flat(14).smooth(36, -16); // steep hill
  b.flat(20);
  b.bumps(8, 3, 0.6);
  b.flat(35);
  b.kicker(24, 8).pit(13, 12, -3, 40).smooth(22, -5); // big jump over a pit
  b.flat(30);
  b.hills(70, 5, 2);
  b.flat(10);
  b.smooth(32, 18).flat(10); // very steep hill
  b.smooth(20, -6).kicker(5, 0.8).smooth(20, -6.8).kicker(5, 0.8).smooth(20, -6.8);
  b.flat(35);
  b.kicker(6, 1.2).pit(10, 10, -1.2).flat(25); // pit 3
  b.kicker(35, 13).line(3, 0).smooth(45, -13); // huge ramp
  b.flat(30);
  b.bumps(6, 5, 1);
  b.hills(60, 3, 3);
  b.flat(35);
  b.kicker(7, 1.5).pit(11, 12, -1.5).flat(20); // pit 4
  b.smooth(20, 8).flat(8).smooth(20, -8);
  b.bumps(10, 2.5, 0.4);
  b.flat(30);
  const goalX = b.x + 10;
  b.flat(70);
  b.add(b.x, b.y + 30); // end wall
  return {
    points: b.pts,
    pits: b.pits,
    features: b.features,
    startX: 6,
    goalX,
    endX: b.x,
  };
}

// Ground height (top surface) at x.
export function groundAt(track, x) {
  const p = track.points;
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p[mid].x <= x) lo = mid; else hi = mid;
  }
  const a = p[lo], b = p[hi];
  if (b.x === a.x) return Math.max(a.y, b.y);
  const t = Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x)));
  return a.y + (b.y - a.y) * t;
}

export function slopeAt(track, x) {
  return Math.atan2(groundAt(track, x + 1) - groundAt(track, x - 1), 2);
}

export function pitAt(track, x) {
  return track.pits.find((p) => x > p.x0 && x < p.x1) || null;
}

// Random coin placement (new layout every race).
export function placeCoins(track, rand = Math.random) {
  const coins = [];
  let x = 25;
  while (x < track.goalX - 8) {
    x += 7 + rand() * 12;
    const nearPit = track.pits.some((p) => x > p.x0 - 3 && x < p.x1 + 3);
    if (nearPit || x >= track.goalX - 5) continue;
    // Groups of 1-4 coins, most at driving height, some higher (need a jump).
    const n = 1 + Math.floor(rand() * 4);
    const lift = rand() < 0.3 ? 2.6 + rand() * 1.2 : 1.3;
    for (let i = 0; i < n && x < track.goalX - 5; i++) {
      coins.push({ x, y: groundAt(track, x) + lift, taken: false });
      x += 1.6;
    }
  }
  return coins;
}
