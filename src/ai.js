import { mulberry } from './game.js';
import { posAt, wrapS, SPACING } from './track.js';
import { MAX_SPEED } from './truck.js';

// AI-motstander: ren funksjon av spilltilstanden (ingen DOM, ingen Math.random). Tilfeldighet kommer fra mulberry.
export const LEVELS = ['lett', 'middels', 'vanskelig'];
export const LEVEL_LABELS = ['Lett', 'Middels', 'Vanskelig'];

// tempo: andel av topptempoet i svinger og på rette; look: lookahead (m) ved stå og per m/s;
// gain: P-forsterkning på vinkelfeil; delay: reaksjonsforsinkelse i steg; wobble: feil i sideplassering (m) og styring;
// rubber: gummibånd (maks nedbremsing for leder).
const PARAMS = [
  { tempo: 0.7, look: 9, lookSpeed: 0.45, gain: 1.6, delay: 14, wobble: 4, steerErr: 0.22, rubber: 0.12 },
  { tempo: 0.88, look: 11, lookSpeed: 0.5, gain: 2, delay: 8, wobble: 2, steerErr: 0.1, rubber: 0.04 },
  { tempo: 1, look: 13, lookSpeed: 0.55, gain: 2.4, delay: 3, wobble: 0.6, steerErr: 0.02, rubber: 0 },
];

const QUIET = { throttle: 0, steer: 0, brake: 0, jump: false };
const STUCK_SPEED = 1.5; // under dette regnes trucken som stillestående
const STUCK_TIME = 2; // sekunder stillestående før rygging
const REVERSE_TIME = 1.3;
const CORNER_GRIP = 0.8; // andel av teoretisk svingegrense vi tør å ta
const BRAKE_ZONE = 8; // m/s over målfart før full brems

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Krumning (rad/m) per banepunkt, glattet over noen punkter. Bufres per bane.
const curvCache = new WeakMap();
function curvatureOf(track) {
  let k = curvCache.get(track);
  if (k) return k;
  const { pts, count } = track;
  const raw = pts.map((p, i) => {
    const q = pts[(i + 1) % count];
    return Math.abs(Math.atan2(p.tx * q.tz - p.tz * q.tx, p.tx * q.tx + p.tz * q.tz)) / SPACING;
  });
  k = raw.map((_, i) => {
    let sum = 0;
    for (let o = -2; o <= 2; o++) sum += raw[(i + o + count) % count];
    return sum / 5;
  });
  curvCache.set(track, k);
  return k;
}

export function createAI(seed, truckId, level) {
  const p = PARAMS[Math.max(0, Math.min(PARAMS.length - 1, Math.round(level)))];
  const rand = mulberry((seed * 7919 + truckId * 104729 + 17) | 0);
  const steerHist = new Array(p.delay + 1).fill(0);
  let wobbleLat = 0, wobbleTarget = 0, wobbleTimer = 0;
  let steerErr = 0;
  let stillTime = 0, reverseTime = 0;

  return {
    input(game, i) {
      const t = game.trucks[i];
      if (game.state !== 'racing' || t.finished || t.rescue > 0) {
        stillTime = reverseTime = 0;
        return { ...QUIET };
      }
      const { track } = game;
      const speed = t.speed;
      const vf = t.vx * Math.cos(t.theta) + t.vz * Math.sin(t.theta);

      // Feil: sideplasseringen drifter mot nye mål med jevne mellomrom, og styringen har et lavpassfiltrert avvik.
      wobbleTimer -= 1 / 60;
      if (wobbleTimer <= 0) {
        wobbleTarget = (rand() * 2 - 1) * p.wobble;
        wobbleTimer = 0.8 + rand() * 1.6;
      }
      wobbleLat += (wobbleTarget - wobbleLat) * 0.04;
      steerErr += ((rand() * 2 - 1) * p.steerErr - steerErr) * 0.1;

      // Stuck: nesten stille i flere sekunder uten redning -> rygg mens vi styrer mot sentrallinja.
      stillTime = speed < STUCK_SPEED ? stillTime + 1 / 60 : 0;
      if (stillTime > STUCK_TIME) {
        reverseTime = REVERSE_TIME;
        stillTime = 0;
      }

      const look = p.look + speed * p.lookSpeed;
      const target = posAt(track, t.s + look, wobbleLat);
      const want = Math.atan2(target.z - t.z, target.x - t.x);
      const err = angleDiff(want, t.theta);

      if (reverseTime > 0) {
        reverseTime -= 1 / 60;
        // Bakover snur styringen retningen trucken dreier.
        steerHist.fill(0);
        return { throttle: 0, steer: Math.max(-1, Math.min(1, -err * 2)), brake: 1, jump: false };
      }

      // Fart: ut fra største krumning de neste meterne, og bremselengde fram til den.
      const k = curvatureOf(track);
      const span = 20 + speed * 1.4;
      let kMax = 0;
      for (let d = 0; d <= span; d += SPACING * 2) {
        const idx = Math.floor(wrapS(track, t.s + d) / SPACING) % track.count;
        kMax = Math.max(kMax, k[idx]);
      }
      const cornerSpeed = (CORNER_GRIP * 1.9) / (kMax + 0.0166);
      let tempo = p.tempo;
      // Gummibånd: bare lederen bremses litt, mer jo større ledelse.
      if (p.rubber > 0 && game.trucks.length > 1) {
        const lead = t.dist - Math.max(...game.trucks.filter((o) => o !== t).map((o) => o.dist));
        if (lead > 0) tempo *= 1 - p.rubber * Math.min(1, lead / 80);
      }
      const targetSpeed = Math.min(MAX_SPEED * tempo, cornerSpeed * (0.85 + 0.15 * p.tempo));
      const over = vf - targetSpeed;
      const throttle = over < 0 ? 1 : 0;
      const brake = over > 3 ? Math.min(1, (over - 3) / BRAKE_ZONE) : 0;

      // Styring: P-regulering mot vinkelfeil, forsinket med reaksjonstiden.
      steerHist.push(Math.max(-1, Math.min(1, err * p.gain)));
      const delayed = steerHist.shift();
      const steer = Math.max(-1, Math.min(1, delayed + steerErr));

      return { throttle, steer, brake, jump: false };
    },
  };
}
