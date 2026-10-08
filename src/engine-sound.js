// Motorlyd for én truck: en V8 med automatgir (EngineModel) og lydgrafen som spiller den (EngineVoice).
//
// Lyden er bygget av enkelttenninger: en løkke på noen sekunder med eksosstøt (ujevn «burbling» fra én sylinderbank,
// små tilfeldige variasjoner i hvert slag) som spilles av med fart etter turtallet. Etterpå kommer faste eksosresonanser,
// forvrengning som øker med lasten og et lavpassfilter som åpner seg med gass og turtall. Klangen endrer seg derfor når
// turtallet sveiper forbi resonansene, i stedet for at én tone bare skifter tonehøyde.

export const IDLE_RPM = 850;
export const REDLINE = 6200;
const STALL_RPM = 2800; // turtallsomformeren: så høyt ruser motoren med full gass før hjulene tar tak
const FREE_REV = 5400; // fritt turtall med full gass (i lufta, eller i fri under nedtellingen)
export const GEARS = [10, 19, 29, 41, 60]; // fart (m/s) ved rødt felt i hvert gir
const UPSHIFT = 0.92; // girer opp ved denne andelen av girets toppfart
const DOWNSHIFT = 0.6; // girer ned når farten faller under denne andelen av forrige gir
const SHIFT_TIME = 0.17; // gassen kuttes kort mens giret skiftes
const BUF_RPM = 1800; // turtallet tenningsløkka er laget for (avspillingsfart 1)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, target, dt, tau) => v + (target - v) * (1 - Math.exp(-dt / tau));

export class EngineModel {
  constructor() {
    this.rpm = IDLE_RPM;
    this.gear = 0;
    this.load = 0;
    this.shift = 0; // tid igjen av girskiftet
    this.overrun = 0; // tid igjen der eksosen kan smelle etter at gassen ble sluppet på høyt turtall
    this.limiter = 0; // fase i turtallssperren (0 = av)
  }

  // speed: m/s (fortegnet ignoreres), throttle: 0..1, free: hjulene har ikke grep (i lufta, eller i fri),
  // accel: fartsendring i m/s². Full gass i jevn toppfart gir mindre last (roligere lyd) enn full gass i akselerasjon.
  update(dt, speed, throttle, free = false, accel = 0) {
    speed = Math.abs(speed);
    this.shift = Math.max(0, this.shift - dt);
    this.overrun = Math.max(0, this.overrun - dt);
    if (!free) {
      if (this.gear < GEARS.length - 1 && speed > GEARS[this.gear] * UPSHIFT) { this.gear++; this.shift = SHIFT_TIME; }
      else if (this.gear > 0 && speed < GEARS[this.gear - 1] * DOWNSHIFT) this.gear--;
    }
    const wheel = REDLINE * speed / GEARS[this.gear];
    const coupled = Math.max(IDLE_RPM, wheel, this.shift > 0 ? 0 : throttle * STALL_RPM);
    const target = Math.min(REDLINE, free ? IDLE_RPM + throttle * (FREE_REV - IDLE_RPM) : coupled);
    const tau = this.shift > 0 ? 0.06 : target > this.rpm ? (free ? 0.22 : 0.1) : (free ? 0.45 : 0.16);
    this.rpm = approach(this.rpm, target, dt, tau);
    this.limiter = this.rpm > REDLINE * 0.97 && throttle > 0.5 ? (this.limiter + dt * 13) % 1 : 0;
    const push = free ? 0.75 : 0.62 + 0.38 * clamp(accel / 6, 0, 1);
    const load = this.shift > 0 ? 0.08 : throttle * push;
    if (this.load > 0.5 && load < 0.15 && this.rpm > 3000) this.overrun = 0.9;
    this.load = approach(this.load, load, dt, 0.07);
    return this;
  }

  get rpmFrac() { return clamp((this.rpm - IDLE_RPM) / (REDLINE - IDLE_RPM), 0, 1); }
}

// Liten seedet generator, så lydsyntesen aldri bruker Math.random (testene seeder den for å få like baner).
export function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Kjører et ettpols lavpass rundt en løkke to ganger, så filtertilstanden er innsvingt og løkka skjøtes uten klikk.
function smoothLoop(d, a) {
  let y = 0;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < d.length; i++) { y += a * (d[i] - y); if (pass) d[i] = y; }
}

function normalize(d, peak) {
  let mean = 0, max = 0;
  for (const v of d) mean += v;
  mean /= d.length;
  for (let i = 0; i < d.length; i++) { d[i] -= mean; max = Math.max(max, Math.abs(d[i])); }
  if (max) for (let i = 0; i < d.length; i++) d[i] *= peak / max;
}

// Tenningsløkka: en V8 med tverrplan-veivaksel (tenningsrekkefølge 1-8-4-3-6-5-7-2) tenner jevnt hvert 90°, men hver
// sylinderbank får ujevne eksosstøt (270°, 180°, 90°, 180°), og det er det som gir V8-burblingen. Bankene legges i hver sin
// kanal så de kan få hver sin resonator. Hvert støt er en kort, bipolar puls som faller i tonehøyde, med litt støy fra
// forbrenningen og et lite ventilklikk. Hver sylinder har sin faste særegenhet, og hvert slag varierer litt.
const FIRING_ORDER = [1, 8, 4, 3, 6, 5, 7, 2];
function engineBuffer(ctx, rand, seconds = 4) {
  const sr = ctx.sampleRate;
  const cycle = 120 / BUF_RPM; // én arbeidssyklus = to omdreininger
  const cycles = Math.round(seconds / cycle);
  const n = Math.round(cycles * cycle * sr);
  const buf = ctx.createBuffer(2, n, sr);
  const banks = [buf.getChannelData(0), buf.getChannelData(1)];
  const slot = cycle / 8;
  const cyl = Array.from({ length: 9 }, () => ({ amp: 0.85 + 0.25 * rand(), shift: (rand() - 0.5) * 0.06 }));
  const len = Math.ceil(sr * 0.007);
  let wobble = 1;
  for (let c = 0; c < cycles; c++) {
    wobble += (1 - wobble) * 0.25 + (rand() - 0.5) * 0.16; // forbrenningen varierer sakte fra syklus til syklus
    for (let k = 0; k < 8; k++) {
      const q = cyl[FIRING_ORDER[k]];
      const d = banks[FIRING_ORDER[k] % 2];
      const amp = q.amp * wobble * (0.82 + 0.36 * rand());
      const start = Math.floor(((c * 8 + k) * slot + (q.shift + (rand() - 0.5) * 0.03) * slot) * sr);
      const rise = 0.00025 * (0.8 + 0.4 * rand()), decay = 0.0016 * (0.8 + 0.4 * rand());
      const f0 = 700 + 200 * rand(), f1 = 210 + 60 * rand();
      const grit = 0.2 + 0.2 * rand();
      const tick = 0.05 + 0.04 * rand(), tickAt = Math.floor(len * 0.5);
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = (1 - Math.exp(-t / rise)) * Math.exp(-t / decay);
        ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t / 0.0015))) / sr;
        const bump = (t / rise) * Math.exp(1 - t / rise) * 0.35; // trykkstøtet
        const noise = grit * (rand() * 2 - 1) * Math.exp(-t / (decay * 0.8));
        const valve = i >= tickAt ? tick * Math.sin((i - tickAt) * 0.42) * Math.exp(-(i - tickAt) / (sr * 0.0004)) : 0;
        d[(start + i) % n] += amp * (env * Math.sin(ph) + bump + noise) + valve;
      }
    }
  }
  const a = 1 - Math.exp(-2 * Math.PI * 5000 / sr);
  for (const d of banks) { smoothLoop(d, a); smoothLoop(d, a); normalize(d, 0.9); }
  return buf;
}

function noiseBuffer(ctx, rand, seconds = 2) {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  return buf;
}

// Grus: spredte små knaser (avspillingsfarten følger farten), med litt sus under.
function gritBuffer(ctx, rand, seconds = 2) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.round(sr * seconds), sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (rand() * 2 - 1) * 0.12;
  const hits = Math.round(seconds * 700);
  for (let h = 0; h < hits; h++) {
    const at = Math.floor(rand() * d.length), amp = rand() ** 2 * (rand() < 0.5 ? -1 : 1);
    const len = 6 + Math.floor(rand() * 30);
    for (let i = 0; i < len; i++) d[(at + i) % d.length] += amp * Math.exp(-i / (len / 4)) * (rand() * 2 - 1);
  }
  normalize(d, 0.8);
  return buf;
}

function saturation(drive = 2.2) {
  const c = new Float32Array(1024);
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return c;
}

// Lyddata som deles av alle motorene (lages én gang når lyden låses opp).
export function makeEngineAssets(ctx, rand) {
  return { engine: engineBuffer(ctx, rand), noise: noiseBuffer(ctx, rand), grit: gritBuffer(ctx, rand), curve: saturation(), rand };
}

// Hver truck har sin egen motor: litt ulik størrelse (tonehøyde) og eksos (resonanser), så de kan skilles fra hverandre.
const CHARACTERS = [
  { pitch: 1, res: [132, 455] },
  { pitch: 0.89, res: [114, 395] },
  { pitch: 1.09, res: [150, 520] },
  { pitch: 0.82, res: [100, 350] },
];

const filter = (ctx, type, frequency, Q = 0.7, gain = 0) => {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  f.gain.value = gain;
  return f;
};
const amp = (ctx, value = 0) => {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
};
const set = (param, value, t, tc = 0.04) => { if (Number.isFinite(value)) param.setTargetAtTime(value, t, tc); };

export class EngineVoice {
  constructor(ctx, out, assets, character = 0) {
    this.ctx = ctx;
    this.assets = assets;
    this.rand = assets.rand;
    this.model = new EngineModel();
    const c = CHARACTERS[character % CHARACTERS.length];
    this.pitch = c.pitch;
    this.phase = assets.rand() * 10;
    this.breath = 0; // langsom, tilfeldig variasjon i lasten (ujevnt underlag), så jevn toppfart ikke blir én flat tone

    // Utgang: avstand (nivå og lavpass) og panorering.
    this.mix = amp(ctx, 0);
    this.distance = filter(ctx, 'lowpass', 18000, 0.5);
    this.pan = ctx.createStereoPanner();
    this.mix.connect(this.distance).connect(this.pan).connect(out);

    // Motor: tenningsløkke (én kanal per sylinderbank) → hver bank sin resonator, pluss det tørre signalet →
    // felles eksosrør → forvrengning → lavpass.
    this.src = ctx.createBufferSource();
    this.src.buffer = assets.engine;
    this.src.loop = true;
    const sum = amp(ctx, 1);
    const dry = amp(ctx, 0.5);
    dry.channelCount = 1;
    dry.channelCountMode = 'explicit'; // blander bankene til mono
    this.src.connect(filter(ctx, 'highpass', 38, 0.7)).connect(dry).connect(sum);
    const split = ctx.createChannelSplitter(2);
    this.src.connect(split);
    [c.res[0], c.res[0] * 1.24].forEach((f, ch) => {
      const bank = filter(ctx, 'bandpass', f, 2.4);
      split.connect(bank, ch);
      bank.connect(amp(ctx, 1.5)).connect(sum);
    });
    const pipe = filter(ctx, 'peaking', c.res[1], 1.6, 6);
    this.drive = amp(ctx, 0.4);
    sum.connect(pipe);
    const shaper = ctx.createWaveShaper();
    shaper.curve = assets.curve;
    shaper.oversample = '2x';
    this.tone = filter(ctx, 'lowpass', 900, 0.8);
    this.engine = amp(ctx, 0);
    pipe.connect(this.drive).connect(shaper).connect(this.tone).connect(this.engine).connect(this.mix);

    // Støylag fra én felles støykilde: veibrus, sladd, turbo-brøl og innsugsus.
    this.noise = ctx.createBufferSource();
    this.noise.buffer = assets.noise;
    this.noise.loop = true;
    const layer = (type, f, Q) => {
      const flt = filter(ctx, type, f, Q), g = amp(ctx, 0);
      this.noise.connect(flt).connect(g).connect(this.mix);
      return { f: flt, g };
    };
    this.road = layer('lowpass', 320, 0.7);
    this.skid = layer('bandpass', 1150, 2.2);
    this.boost = layer('bandpass', 520, 0.9);
    this.intake = layer('bandpass', 1300, 1.3);

    // Grus utenfor veien: egen knasekilde der avspillingsfarten følger farten.
    this.gritSrc = ctx.createBufferSource();
    this.gritSrc.buffer = assets.grit;
    this.gritSrc.loop = true;
    this.gravel = { f: filter(ctx, 'bandpass', 1500, 0.6), g: amp(ctx, 0) };
    this.gritSrc.connect(this.gravel.f).connect(this.gravel.g).connect(this.mix);

    const t = ctx.currentTime;
    this.src.start(t, this.rand() * assets.engine.duration);
    this.noise.start(t, this.rand() * assets.noise.duration);
    this.gritSrc.start(t, this.rand() * assets.grit.duration);
  }

  // p: { on, speed, throttle, accel, free, onRoad, air, drift, turbo, gain, pan, lowpass, doppler }. at: tidspunkt
  // (standard: nå; en offline-gjengivelse sender egne tider).
  update(dt, p, at = this.ctx.currentTime) {
    const m = this.model.update(dt, p.speed, p.throttle, p.free, p.accel);
    const t = at;
    const rf = m.rpmFrac;
    this.phase += dt;
    this.breath += -this.breath * dt / 1.2 + (this.rand() - 0.5) * Math.sqrt(dt) * 0.5;
    const b = p.on && !p.air && p.speed > 5 ? clamp(this.breath, -0.3, 0.3) : 0;
    // Litt uro i turtallet (to langsomme svingninger som aldri går i takt), så tomgang og marsjfart aldri blir helt flate.
    const wobble = 1 + 0.006 * Math.sin(this.phase * 2.3) + 0.004 * Math.sin(this.phase * 5.1 + 1);
    const cut = m.limiter > 0.72 ? 0.5 : 1;
    const rate = (m.rpm * (cut < 1 ? 0.97 : 1) / BUF_RPM) * this.pitch * (p.doppler || 1) * wobble;
    set(this.src.playbackRate, rate, t, 0.025);
    set(this.drive.gain, 0.32 + 0.5 * m.load + 0.12 * rf + 0.15 * b, t);
    set(this.tone.frequency, Math.min(6500, (520 + 2600 * m.load + 2000 * rf) * (1 + 0.6 * b)), t);
    // Nivået følger lasten med en slakk kurve (følsomt ved lite gass), og turtallet.
    const level = p.on ? (0.17 + 0.38 * m.load ** 0.7 + 0.22 * rf) * cut * (m.shift > 0 ? 0.7 : 1) * (1 + 0.25 * b) : 0;
    set(this.engine.gain, level, t, p.on ? 0.03 : 0.12);

    const ground = p.on && !p.air;
    const sf = clamp(p.speed / 40, 0, 1.5);
    set(this.road.g.gain, ground ? (p.onRoad ? 0.07 : 0.03) * sf * (1 + 1.5 * b) : 0, t, 0.08);
    set(this.road.f.frequency, 220 + 260 * sf, t);
    set(this.gravel.g.gain, ground && !p.onRoad ? 0.16 * Math.min(1, sf * 2) : 0, t, 0.06);
    set(this.gritSrc.playbackRate, 0.5 + sf, t, 0.08);
    const skid = ground && p.drift > 0 ? 0.045 + 0.03 * Math.min(1, p.drift / 2.5) : 0;
    set(this.skid.g.gain, skid, t, skid ? 0.05 : 0.1);
    set(this.skid.f.frequency, 1000 + 250 * Math.sin(this.phase * 9) + 180 * sf, t, 0.03);
    set(this.boost.g.gain, p.on && p.turbo > 0 ? 0.11 * Math.min(1, p.turbo * 2) : 0, t, 0.06);
    set(this.boost.f.frequency, 420 + 160 * Math.sin(this.phase * 23) + 300 * rf, t, 0.02);
    // Innsug under last, og luftsus når gassen er av på høyt turtall (motorbrems uten tenning).
    set(this.intake.g.gain, p.on ? rf * (0.05 * m.load + 0.035 * (1 - m.load)) : 0, t, 0.08);
    set(this.intake.f.frequency, (900 + 1700 * rf) * (0.6 + 0.4 * m.load), t);

    set(this.mix.gain, p.gain, t, 0.06);
    set(this.distance.frequency, p.lowpass || 18000, t, 0.06);
    set(this.pan.pan, clamp(p.pan || 0, -1, 1), t, 0.06);

    // Etterbrenning: små smell i eksosen like etter at gassen slippes på høyt turtall.
    if (p.on && m.overrun > 0 && this.rand() < dt * 6 * m.overrun) this.pop(t);
  }

  pop(t) {
    const { ctx } = this;
    const src = ctx.createBufferSource(), f = filter(ctx, 'bandpass', 380 + this.rand() * 500, 1.2), g = amp(ctx, 0);
    src.buffer = this.assets.noise;
    const v = 0.25 + this.rand() * 0.3;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 + this.rand() * 0.04);
    src.connect(f).connect(g).connect(this.mix);
    src.start(t, this.rand() * 1.5, 0.12);
  }
}
