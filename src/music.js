// Enkel prosedyremusikk: en liten sequencer (16-deler) med trommer, bass, akkorder, arpeggio og melodi.
// Hver bane får sin egen låt: toneart, tempo, akkordrekker, rytmer og melodi lages fra banens frø. Menyen har en
// rolig låt, løpet en drivende en som trappes opp (og løftes en hel tone) på siste runde, og målgangen får en fanfare.
import { rng } from './engine-sound.js';

const LOOKAHEAD = 0.15; // så langt fram (sekunder) noter planlegges
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const MINOR = [0, 2, 3, 5, 7, 8, 10];
// Halvtoner over grunntonen for et skalatrinn (trinn kan være negative eller gå over flere oktaver).
const semis = (d) => MINOR[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
const mod7 = (d) => ((d % 7) + 7) % 7;
// Treklangen på et trinn. Dominanten (trinn 4) får stor ters (harmonisk moll), så den drar tilbake mot grunntonen.
const triad = (d) => [semis(d), semis(d + 2) + (mod7(d) === 4 ? 1 : 0), semis(d + 4)];

// Akkordrekker som skalatrinn (0 = i), én akkord per takt.
const PROGRESSIONS = [
  [0, 5, 2, 6], // i VI III VII
  [0, 6, 5, 6], // i VII VI VII
  [0, 3, 5, 4], // i iv VI V
  [5, 6, 0, 0], // VI VII i i
  [0, 5, 3, 4], // i VI iv V
  [0, 2, 6, 5], // i III VII VI
  [3, 5, 6, 0], // iv VI VII i
];

// Trommer (16 steg per takt): x = slag, X = aksent, o = åpen hihat.
const GROOVES = {
  rock: { k: 'x.....x.x.......', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.' },
  dans: { k: 'x...x...x...x...', s: '....X.......X...', h: '..o...o...o...o.' },
  galopp: { k: 'x.x...x.x.x...x.', s: '....X.......X..x', h: 'xxXxxxXxxxXxxxXx' },
  halv: { k: 'x.........x.....', s: '........X.......', h: 'x...x...x...x...' },
  stille: { k: 'x.......x.......', s: '................', h: '..x...x...x...x.' },
};
// Basslinjer: r = grunntone, o = oktaven over, f = kvinten, n = neste akkords grunntone.
const BASSLINES = ['r.r.r.r.r.r.r.o.', 'r..r..r.r..r..o.', 'r.rrr.rrr.rrr.on', 'r...r.o.r..rf.n.', 'rr.rrr.rrr.rro.f'];
// Arpeggio: indekser i [grunntone, ters, kvint, oktav].
const ARPS = [[0, 1, 2, 3], [0, 2, 1, 3, 2, 1], [0, 1, 2, 1], [3, 2, 1, 0], [0, 2, 3, 2]];
// Melodirytmer for én takt: [steg, varighet i 16-deler].
const RHYTHMS = [
  [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]],
  [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
  [[0, 4], [4, 2], [6, 2], [8, 6], [14, 2]],
  [[0, 3], [3, 3], [6, 4], [10, 2], [12, 2], [14, 2]],
  [[2, 2], [4, 2], [6, 2], [8, 3], [11, 3], [14, 2]],
  [[0, 6], [6, 2], [8, 2], [10, 2], [12, 4]],
];
const CADENCES = [[[0, 3], [3, 3], [6, 10]], [[0, 2], [2, 2], [4, 4], [8, 8]], [[0, 8], [8, 8]]];
const MEL_LO = 2, MEL_HI = 11; // melodiens omfang i skalatrinn

// Melodi over fire takter: takt 1 er et motiv, takt 3 gjentar det (flyttet så det passer akkorden), takt 4 lander
// på akkordens grunntone. Tunge slag får akkordtoner, de lette går trinnvis. `start` gir samme åpning som en annen melodi.
function makeMelody(r, prog, start = null) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const opening = start && start.filter((n) => n.step < 16);
  // Takt 3 gjentar motivet fra takt 1, så den må ha samme rytme (også når åpningen er lånt fra en annen melodi).
  const first = opening ? opening.map((n) => [n.step, n.dur]) : pick(RHYTHMS);
  const rhythms = [first, pick(RHYTHMS), first, pick(CADENCES)];
  const notes = [];
  const motif = [];
  let prev = 4 + Math.floor(r() * 3);
  for (let b = 0; b < 4; b++) {
    const tones = [0, 2, 4].map((k) => mod7(prog[b] + k));
    const isTone = (d) => tones.includes(mod7(d));
    const snap = (d) => {
      const order = r() < 0.5 ? [0, 1, -1, 2, -2, 3, -3] : [0, -1, 1, -2, 2, -3, 3];
      for (const k of order) if (isTone(d + k) && d + k >= MEL_LO && d + k <= MEL_HI) return d + k;
      return d;
    };
    if (b === 0 && opening) {
      for (const n of opening) { notes.push({ ...n }); motif.push(n.deg); prev = n.deg; }
      continue;
    }
    const shift = b === 2 ? snap(motif[0]) - motif[0] : 0;
    rhythms[b].forEach(([st, dur], k) => {
      const strong = st % 8 === 0 || dur >= 4;
      let d;
      if (b === 2) d = motif[k] + shift;
      else if (b === 3 && k === rhythms[b].length - 1) {
        const root = mod7(prog[b]);
        d = [root, root + 7, root + 14].reduce((best, x) => (Math.abs(x - prev) < Math.abs(best - prev) && x <= MEL_HI ? x : best), root + 7);
      } else d = prev + (strong ? pick([-2, -1, 0, 1, 2]) : pick([-2, -1, -1, 1, 1, 2]));
      if (d < MEL_LO) d += 2;
      if (d > MEL_HI) d -= 2;
      if (strong && !isTone(d)) d = snap(d);
      notes.push({ step: b * 16 + st, dur, deg: d });
      if (b === 0) motif.push(d);
      prev = d;
    });
  }
  return notes;
}

// Melodien endres litt hver gang den kommer tilbake: én tone på et lett slag flyttes et trinn (aldri sluttonen).
// Den høres fortsatt ut som samme melodi, men blir aldri helt lik.
function mutate(mel, r) {
  const n = mel[Math.floor(r() * (mel.length - 1))];
  const d = n.deg + (r() < 0.5 ? -1 : 1);
  if (n.step % 8 !== 0 && d >= MEL_LO && d <= MEL_HI) n.deg = d;
}

export function makeSong(seed, menu) {
  const r = rng(seed * 7919 + 13);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const progA = pick(PROGRESSIONS);
  let progB = pick(PROGRESSIONS);
  while (progB === progA) progB = pick(PROGRESSIONS);
  const song = {
    root: pick([40, 41, 42, 43, 45]), // bassens grunntone (E2–A2)
    bpm: menu ? 96 + 4 * Math.floor(r() * 3) : 128 + 4 * Math.floor(r() * 5),
    progA, progB,
    groove: menu ? 'halv' : pick(['rock', 'dans', 'galopp']),
    bass: pick(BASSLINES),
    arp: pick(ARPS),
    arpEvery: r() < 0.6 ? 1 : 2, // 16-deler eller 8-deler
  };
  song.melA = makeMelody(r, progA);
  song.melB = makeMelody(r, progB);
  song.melB2 = makeMelody(r, progB, song.melB);
  return song;
}

// Deler på fire takter. filter: hvor åpent musikkfilteret er (0..1), sweep: åpnes gradvis gjennom delen.
const PARTS = {
  intro: { prog: 'A', drums: 'stille', bass: 0.7, filter: 0.3, sweep: 0.85 },
  vers: { prog: 'A', drums: true, bass: 1, arp: 0.8 },
  vers2: { prog: 'A', drums: true, bass: 1, arp: 1, pad: 0.6 },
  refreng: { prog: 'B', drums: true, bass: 1, arp: 0.45, pad: 1, lead: 'melB', crash: true },
  refreng2: { prog: 'B', drums: true, bass: 1, arp: 0.45, pad: 1, lead: 'melB2' },
  brekk: { prog: 'A', drums: 'halv', pad: 1, arp: 0.8, filter: 0.45, riser: true },
  meny: { prog: 'A', drums: true, bass: 0.6, pad: 0.8, arp: 0.5, filter: 0.62 },
  meny2: { prog: 'B', drums: true, bass: 0.6, pad: 0.8, arp: 0.35, lead: 'melB', filter: 0.62 },
};
const FORMS = {
  race: ['intro', 'vers', 'vers2', 'refreng', 'refreng2', 'brekk', 'vers2', 'refreng', 'refreng2'],
  final: ['refreng', 'refreng2', 'vers2', 'refreng', 'refreng2', 'vers2'],
  menu: ['meny', 'meny', 'meny2', 'meny2'],
};
const LOOP_FROM = { race: 1, final: 0, menu: 0 }; // hit hopper formen når den er spilt ferdig
const cutoff = (f) => 200 * 90 ** f; // 0 → 200 Hz, 1 → 18 kHz

export class Music {
  constructor(ctx, out, reverb, noise) {
    this.ctx = ctx;
    this.noise = noise;
    this.rand = rng(0x6d75);
    this.reverb = reverb;
    this.enabled = true;
    this.mode = 'off';
    this.key = '';
    this.perf = null;
    this.pendingMenu = 0;
    // Musikkbuss: et filter som kan lukkes (intro, brekk, meny) og et ekko for arpeggio og melodi.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 18000;
    this.filter.Q.value = 0.8;
    this.filter.connect(out);
    this.delay = ctx.createDelay(1);
    const fb = ctx.createGain(), dl = ctx.createBiquadFilter(), wet = ctx.createGain();
    fb.gain.value = 0.32;
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    wet.gain.value = 0.3;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(wet).connect(this.filter);
    this.timer = setInterval(() => this.tick(), 25);
  }

  // mode: 'menu', 'race', 'finish' (fanfare, så menylåten) eller 'off'. Kalles hver frame; gjør bare noe ved endring.
  play(mode, seed = 0, { win = true } = {}) {
    const key = `${mode}|${mode === 'race' ? seed : ''}`;
    if (key === this.key) return;
    this.key = key;
    this.mode = mode;
    this.pendingMenu = 0;
    this.fadeOut();
    const t = this.ctx.currentTime;
    if (mode === 'race') this.start(makeSong(seed, false), 'race', t + 0.02);
    else if (mode === 'menu') this.start(makeSong(4, true), 'menu', t + 0.4);
    else if (mode === 'finish') { this.fanfare(t + 0.05, win); this.pendingMenu = t + 4.5; }
  }

  // Siste runde: refrengene tar over, trommene får mer driv og alt løftes en hel tone fra neste firetaktsdel.
  setFinal(on) { if (this.perf && this.perf.form !== 'menu') this.perf.wantFinal = on; }

  setEnabled(on) {
    this.enabled = on;
    if (!on) { this.fadeOut(); this.key = ''; }
  }

  // En «fremføring»: alt en låt spiller (også ekko og romklang) går gjennom én forsterker, så den kan tones ut samlet.
  output(level) {
    const out = this.gain(this.filter, level);
    return { out, toDelay: this.gain(this.delay, 1), toVerb: this.gain(this.reverb, 1) };
  }

  start(song, form, at) {
    const io = this.output(0.0001);
    const level = 0.7;
    io.out.gain.setValueAtTime(0.0001, at);
    io.out.gain.exponentialRampToValueAtTime(level, at + (form === 'menu' ? 1.5 : 0.05));
    for (const g of [io.toDelay, io.toVerb]) {
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(1, at + 0.05);
    }
    this.delay.delayTime.setValueAtTime((60 / song.bpm / 4) * 3, at);
    this.perf = { ...io, song, form, step: 0, next: at, stepDur: 60 / song.bpm / 4, pos: 0, part: null, final: false, wantFinal: false, transpose: 0, heard: {} };
  }

  release(io, t = this.ctx.currentTime) {
    for (const g of [io.out, io.toDelay, io.toVerb]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, 0.25);
    }
    const wait = Math.max(0, t - this.ctx.currentTime) + 2.5;
    setTimeout(() => { for (const g of [io.out, io.toDelay, io.toVerb]) g.disconnect(); }, wait * 1000);
  }

  fadeOut() {
    const p = this.perf;
    if (!p) return;
    const t = this.ctx.currentTime;
    this.release(p, t);
    this.perf = null;
    this.filter.frequency.setTargetAtTime(18000, t, 0.3);
  }

  tick() {
    const t = this.ctx.currentTime;
    if (this.pendingMenu && t >= this.pendingMenu) { this.pendingMenu = 0; this.mode = 'menu'; this.start(makeSong(4, true), 'menu', t + 0.05); }
    this.scheduleUntil(t + LOOKAHEAD);
  }

  // Planlegger alle steg fram til tidspunktet `until` (brukes også direkte av offline-gjengivelse).
  scheduleUntil(until) {
    const p = this.perf;
    if (!p || !this.enabled) return;
    // Har lyden stått stille (fanen var skjult), hopper vi over det vi gikk glipp av i stedet for å spille alt på en gang.
    if (p.next < this.ctx.currentTime - 0.2) p.next = this.ctx.currentTime + 0.05;
    while (p.next < until) {
      const step = p.step, t = p.next;
      // Telles fram før steget spilles: en feil i ett steg skal aldri føre til at det samme steget spilles om igjen.
      p.next += p.stepDur;
      p.step++;
      try { this.playStep(p, step, t); } catch (err) { console.error('musikk:', err); }
    }
  }

  newBar(p, bar, t) {
    const inPart = bar % 4;
    if (inPart === 0) {
      if (bar > 0) p.pos++;
      if (p.wantFinal !== p.final) { p.final = p.wantFinal; p.pos = 0; p.transpose = p.final ? 2 : 0; }
      const form = FORMS[p.final ? 'final' : p.form];
      if (p.pos >= form.length) p.pos = LOOP_FROM[p.final ? 'final' : p.form];
      p.part = PARTS[form[p.pos]];
      if (p.part.lead) {
        p.heard[p.part.lead] = (p.heard[p.part.lead] || 0) + 1;
        if (p.heard[p.part.lead] > 1) for (let k = 0; k < 2; k++) mutate(p.song[p.part.lead], this.rand);
      }
      const next = form[p.pos + 1 < form.length ? p.pos + 1 : LOOP_FROM[p.final ? 'final' : p.form]];
      p.nextCrash = !!PARTS[next].crash || p.wantFinal !== p.final;
    }
    const part = p.part;
    const prog = part.prog === 'B' ? p.song.progB : p.song.progA;
    p.degree = prog[inPart];
    p.nextDegree = prog[(inPart + 1) % 4];
    p.inPart = inPart;
    p.fill = inPart === 3 && (p.nextCrash || p.wantFinal !== p.final);
    const f = part.filter ?? 1;
    const target = part.sweep ? f + (part.sweep - f) * ((inPart + 1) / 4) : f;
    this.filter.frequency.setTargetAtTime(cutoff(target), t, part.sweep ? 0.6 : 0.15);
  }

  playStep(p, step, t) {
    const s = step % 16, bar = Math.floor(step / 16);
    if (s === 0) this.newBar(p, bar, t);
    const { part, song } = p;
    const root = song.root + p.transpose;
    const chord = triad(p.degree);
    const drums = part.drums === true ? (p.final ? 'galopp' : song.groove) : part.drums;

    if (s === 0 && (bar === 0 || (p.inPart === 0 && part.crash) || p.crashNow)) { this.crash(p, t); p.crashNow = false; }
    if (drums) {
      const g = GROOVES[drums];
      if (g.k[s] !== '.') this.kick(p, t, 0.9);
      if (p.fill && s >= 12) this.snare(p, t, 0.25 + 0.12 * (s - 12));
      else if (g.s[s] !== '.') this.snare(p, t, g.s[s] === 'X' ? 0.55 : 0.25);
      if (g.h[s] !== '.') this.hat(p, t, g.h[s] === 'X' ? 0.1 : 0.06, g.h[s] === 'o');
    }
    if (p.fill && s === 15) p.crashNow = true;
    if (part.bass) {
      const c = song.bass[s];
      if (c !== '.') {
        let gap = 1;
        while (gap < 4 && song.bass[(s + gap) % 16] === '.') gap++;
        const n = c === 'o' ? chord[0] + 12 : c === 'f' ? chord[0] + 7 : c === 'n' ? triad(p.nextDegree)[0] : chord[0];
        this.bass(p, t, root + (((n % 12) + 12) % 12) + (c === 'o' ? 12 : 0), gap * p.stepDur * 0.85, part.bass);
      }
    }
    if (part.pad && s === 0) this.pad(p, t, chord.map((x) => root + 12 + (((x - 3) % 12) + 12) % 12 + 3), 16 * p.stepDur, part.pad);
    if (part.arp && s % song.arpEvery === 0) {
      const tones = [chord[0], chord[1], chord[2], chord[0] + 12];
      const k = song.arp[(step / song.arpEvery) % song.arp.length | 0];
      this.arp(p, t, root + 24 + tones[k], part.arp);
    }
    if (part.lead) {
      const mel = song[part.lead];
      const at = p.inPart * 16 + s;
      for (const n of mel) if (n.step === at) this.lead(p, t, root + 24 + semis(n.deg), n.dur * p.stepDur, p.form === 'menu' ? 0.6 : 1);
    }
    if (part.riser && p.inPart === 3 && s === 0) this.riser(p, t, 16 * p.stepDur);
  }

  // ---------- Instrumenter ----------
  env(g, t, peak, attack, hold, release) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return t + attack + hold + release;
  }

  osc(type, freq, t, end, dest, detune = 0) {
    if (!Number.isFinite(freq)) throw new Error(`ugyldig tonehøyde ${freq}`);
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(end + 0.05);
    return o;
  }

  noiseHit(t, dur, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.connect(dest);
    src.start(t, this.rand() * (this.noise.duration - dur - 0.1), dur + 0.05);
    return src;
  }

  gain(dest, value = 0) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    g.connect(dest);
    return g;
  }

  bandFilter(type, freq, Q, dest) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    f.connect(dest);
    return f;
  }

  kick(p, t, v) {
    const g = this.gain(p.out);
    const end = this.env(g, t, 0.34 * v, 0.003, 0.015, 0.22);
    const o = this.osc('sine', 150, t, end, g);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.1);
    // Et lite klikk på toppen, så sparken høres på små høyttalere også.
    const c = this.gain(p.out);
    this.env(c, t, 0.08 * v, 0.001, 0, 0.012);
    this.noiseHit(t, 0.02, this.bandFilter('highpass', 2500, 0.7, c));
  }

  snare(p, t, v) {
    const g = this.gain(p.out);
    const end = this.env(g, t, 0.32 * v, 0.002, 0.01, 0.16);
    const f = this.bandFilter('highpass', 1300, 0.7, g);
    this.noiseHit(t, end - t, f);
    g.connect(this.gain(p.toVerb, 0.18));
    const b = this.gain(p.out);
    const end2 = this.env(b, t, 0.22 * v, 0.002, 0, 0.09);
    const o = this.osc('triangle', 195, t, end2, b);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
  }

  hat(p, t, v, open) {
    const g = this.gain(p.out);
    const end = this.env(g, t, v, 0.001, 0, open ? 0.22 : 0.04);
    this.noiseHit(t, end - t, this.bandFilter('highpass', 7500, 0.8, g));
  }

  crash(p, t) {
    const g = this.gain(p.out);
    g.connect(this.gain(p.toVerb, 0.3));
    const end = this.env(g, t, 0.09, 0.002, 0, 1.6);
    this.noiseHit(t, end - t, this.bandFilter('highpass', 4500, 0.6, g));
  }

  bass(p, t, midi, dur, v) {
    const g = this.gain(p.out);
    const end = this.env(g, t, 0.11 * v, 0.004, Math.max(0, dur - 0.05), 0.06);
    const f = this.bandFilter('lowpass', 2000, 5, g);
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(480, t + 0.16);
    this.osc('sawtooth', hz(midi), t, end, f);
    const sub = this.gain(f, 0.2);
    this.osc('triangle', hz(midi - 12), t, end, sub);
  }

  pad(p, t, notes, dur, v) {
    const g = this.gain(p.out);
    g.connect(this.gain(p.toVerb, 0.5));
    const end = this.env(g, t, 0.032 * v, 0.35, Math.max(0, dur - 0.35), 0.7);
    const f = this.bandFilter('lowpass', 1300, 0.6, g);
    for (const n of notes) for (const d of [-8, 8]) this.osc('sawtooth', hz(n), t, end, f, d);
  }

  arp(p, t, midi, v) {
    const g = this.gain(p.out);
    g.connect(this.gain(p.toDelay, 0.5));
    const end = this.env(g, t, 0.05 * v, 0.002, 0, 0.15);
    this.osc('square', hz(midi), t, end, this.bandFilter('lowpass', 2600, 1, g));
  }

  lead(p, t, midi, dur, v) {
    const g = this.gain(p.out);
    g.connect(this.gain(p.toDelay, 0.35));
    g.connect(this.gain(p.toVerb, 0.25));
    const end = this.env(g, t, 0.075 * v, 0.012, Math.max(0, dur - 0.06), 0.14);
    const f = this.bandFilter('lowpass', 1200, 2, g);
    f.frequency.setValueAtTime(1200, t);
    f.frequency.exponentialRampToValueAtTime(3400, t + 0.03);
    f.frequency.exponentialRampToValueAtTime(2100, t + 0.25);
    const a = this.osc('sawtooth', hz(midi), t, end, f, -6), b = this.osc('square', hz(midi), t, end, f, 6);
    // Vibrato på lange toner.
    if (dur > 0.35) {
      const lfo = this.ctx.createOscillator(), depth = this.ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(14, t + Math.min(0.45, dur));
      lfo.connect(depth);
      depth.connect(a.detune);
      depth.connect(b.detune);
      lfo.start(t);
      lfo.stop(end);
    }
  }

  riser(p, t, dur) {
    const g = this.gain(p.out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    const f = this.bandFilter('bandpass', 400, 2, g);
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + dur);
    this.noiseHit(t, dur, f);
  }

  // Målgang: en dur-fanfare for vinneren, en kortere og mykere frase ellers.
  fanfare(t, win) {
    const song = makeSong(4, true);
    const p = this.output(0.7);
    const root = song.root + 24;
    const step = 0.11;
    const notes = win ? [0, 4, 7, 12, 7, 12, 16] : [7, 3, 0, -5];
    notes.forEach((n, i) => this.lead(p, t + i * step, root + n, i === notes.length - 1 ? 1.2 : step * 0.9, win ? 1 : 0.7));
    const end = t + notes.length * step;
    if (win) {
      this.pad(p, end - step, [root - 12, root - 8, root - 5, root], 1.6, 1.4);
      this.crash(p, end - step);
      this.kick(p, end - step, 1);
    } else this.pad(p, end - step, [root - 12, root - 9, root - 5], 1.4, 1);
    this.release(p, end + 3.5);
  }
}
