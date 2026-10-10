// Lyd: motorer, effekter og musikk, alt syntetisert med Web Audio (ingen lydfiler).
// Miksen: motor-, effekt- og musikkbuss → master → kompressor → høyttalere, med en felles romklang.
// Lyder plasseres i forhold til «lytterne» (trucken til hver lokale spiller): nivå og diskant faller med avstanden,
// og de panoreres etter retningen og etter hvilken del av den delte skjermen spilleren har. Hver effekt får litt
// tilfeldig tonehøyde og nivå, så den samme lyden aldri høres helt lik ut to ganger på rad.
import { EngineVoice, makeEngineAssets, rng } from './engine-sound.js';
import { Music } from './music.js';
import { driftTier } from './truck.js';
import { LAPS } from './game.js';

const MUSIC_KEY = 'monstertruck-musikk';
const MUSIC_LEVEL = 0.672; // musikken er tydelig hørbar over effektene (ca. 1.6 × den gamle verdien)
const HERE = { gain: 1, pan: 0, lp: 20000, own: true };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function readMusicPref() {
  try { return localStorage.getItem(MUSIC_KEY) !== '0'; } catch { return true; }
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.rand = rng(0x50d);
    this.musicOn = readMusicPref();
    this.voices = []; // én motor per truck
    this.memo = []; // per truck: det vi husker fra forrige frame (fart, turbo, driftnivå, fallfart …)
    this.view = null;
    this.state = 'menu';
    this.vp = this.vv = 1; // tonehøyde- og nivåvariasjon for effekten som spilles nå
    this.coinStreak = 0;
    this.coinAt = -9;
    this.failed = 0;
  }

  // Lyd må startes av en brukerhandling (tastetrykk, klikk eller kontrollerknapp).
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch { this.ctx = null; return; }
    this.build();
  }

  build() {
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    this.master = this.gain(comp, 0.9);
    this.engineBus = this.gain(this.master, 0.68);
    this.sfx = this.gain(this.master, 0.37);
    this.musicBus = this.gain(this.master, this.musicLevel());
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(1.8);
    verb.connect(this.gain(this.master, 0.3));
    this.verbIn = this.gain(verb, 1);
    this.assets = makeEngineAssets(ctx, this.rand);
    this.music = new Music(ctx, this.musicBus, this.verbIn, this.assets.noise);
    this.music.setEnabled(this.musicOn);
    // En skjult fane skal ikke fortsette å brumme (og musikkens timer går for tregt i bakgrunnen uansett).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend().catch(() => {});
      else ctx.resume().catch(() => {});
    });
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    try { localStorage.setItem(MUSIC_KEY, this.musicOn ? '1' : '0'); } catch { /* privat modus */ }
    if (this.ctx) {
      this.musicBus.gain.setTargetAtTime(this.musicLevel(), this.ctx.currentTime, 0.15);
      this.music.setEnabled(this.musicOn);
    }
    return this.musicOn;
  }

  // I menyen er det ingen motorer å ligge under, så der kan musikken være litt sterkere.
  musicLevel() {
    return this.musicOn ? MUSIC_LEVEL * (this.state === 'menu' ? 1.5 : 1) : 0;
  }

  // Romklang: stereo støy som dør ut og blir mørkere mot slutten.
  impulse(seconds) {
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.round(sr * seconds);
    const buf = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        lp += (this.rand() * 2 - 1 - lp) * (0.65 - 0.5 * x);
        d[i] = lp * (1 - x) ** 2.4 * Math.min(1, i / (sr * 0.012));
      }
    }
    return buf;
  }

  // ---------- Plassering ----------

  // Hvor en truck høres fra: nivå, panorering og lavpass (avstand) i forhold til nærmeste lytter.
  where(i) {
    const v = this.view;
    if (i === undefined || i === null || !v) return HERE;
    if (v.listeners.includes(i)) return { gain: v.ownGain, pan: v.pans[i] || 0, lp: 20000, own: true };
    const t = v.trucks[i];
    if (!t) return { gain: 0, pan: 0, lp: 20000, own: false };
    if (!v.listeners.length) return { gain: 0.5, pan: v.pans[i] || 0, lp: 20000, own: false }; // tilskuer: hører alle
    let near = null, d = Infinity;
    for (const j of v.listeners) {
      const l = v.trucks[j];
      const dj = l ? Math.hypot(t.x - l.x, t.z - l.z) : Infinity;
      if (dj < d) { d = dj; near = j; }
    }
    if (near === null) return { gain: 0, pan: 0, lp: 20000, own: false };
    const l = v.trucks[near];
    // Kameraet ser langs trucken, så høyre er (-sin θ, cos θ) i (x, z).
    const side = d > 0.5 ? ((t.x - l.x) * -Math.sin(l.theta) + (t.z - l.z) * Math.cos(l.theta)) / d : 0;
    return { gain: 1 / (1 + (d / 22) ** 2), pan: clamp((v.pans[near] || 0) + side * 0.6, -0.9, 0.9), lp: 18000 / (1 + d / 30), own: false, d };
  }

  // Inngangen en effekt kobles til: panorering, avstandsfilter og litt romklang.
  dest(w, verb = 0) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = w.gain;
    let node = g;
    if (w.lp < 15000) {
      const f = ctx.createBiquadFilter();
      f.frequency.value = w.lp;
      node = node.connect(f);
    }
    if (w.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = w.pan;
      node = node.connect(p);
    }
    node.connect(this.sfx);
    if (verb) node.connect(this.gain(this.verbIn, verb));
    return g;
  }

  // Ny tilfeldig variasjon for neste effekt: tonehøyde ± `semi` halvtoner og nivå ± 1,5 dB (0 = helt likt, for musikalske lyder).
  vary(semi) {
    this.vp = 2 ** (((this.rand() * 2 - 1) * semi) / 12);
    this.vv = semi ? 10 ** (((this.rand() * 2 - 1) * 1.5) / 20) : 1;
  }

  gain(dest, value = 1) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    g.connect(dest);
    return g;
  }

  // ---------- Byggeklosser ----------

  tone(freq, dur, { type = 'sine', vol = 0.1, attack = 0.004, slide = 0, at = 0, dest = this.sfx } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq * this.vp, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, (freq + slide) * this.vp), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * this.vv), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Filtrert støy der filterfrekvensen glir fra `from` til `to`.
  noise(dur, { vol = 0.1, type = 'lowpass', from = 2000, to = from, q = 0.8, attack = 0.002, at = 0, dest = this.sfx } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.assets.noise;
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from * this.vp, t);
    if (to !== from) f.frequency.exponentialRampToValueAtTime(Math.max(20, to * this.vp), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * this.vv), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, this.rand() * Math.max(0, this.assets.noise.duration - dur - 0.1), dur + 0.05);
  }

  // ---------- Oppdatering hver frame ----------

  // listeners: lytternes truck-indekser, pans: panorering per truck (fra skjermdelingen), throttle: gass per truck
  // når den er kjent (ellers anslås den fra akselerasjonen).
  update(dt, game, opts) {
    if (!this.ctx) return;
    // Lyden skal aldri kunne stoppe spillet: en feil her logges, og neste frame prøver på nytt.
    try { this.frame(dt, game, opts); } catch (err) { this.fail(err); }
  }

  event(e) {
    if (!this.ctx) return;
    try { this.play(e); } catch (err) { this.fail(err); }
  }

  fail(err) {
    if (this.failed++ < 5) console.error('lyd:', err);
  }

  frame(dt, game, { listeners = [], pans = [], throttle = [] } = {}) {
    dt = clamp(dt, 1 / 240, 0.1);
    const { trucks, state } = game;
    this.view = { trucks, listeners, pans, ownGain: 1 / Math.sqrt(Math.max(1, listeners.length)) };
    if (state !== this.state) {
      if (state === 'countdown') this.countBeep(false); // «3» (resten kommer som tick-hendelser)
      this.state = state;
      this.musicBus.gain.setTargetAtTime(this.musicLevel(), this.ctx.currentTime, 0.5);
    }
    const live = state === 'countdown' || state === 'racing' || state === 'finished';
    trucks.forEach((t, i) => {
      if (!this.voices[i] && live) this.voices[i] = new EngineVoice(this.ctx, this.engineBus, this.assets, i);
      const voice = this.voices[i];
      if (!voice) return;
      const m = this.memo[i] || (this.memo[i] = { speed: 0, accel: 0, turbo: 0, tier: 0, vy: 0, dist: null, dop: 1 });
      const speed = Math.hypot(t.vx || 0, t.vz || 0);
      m.accel += (clamp((speed - m.speed) / dt, -60, 60) - m.accel) * Math.min(1, dt / 0.2);
      m.speed = speed;
      const w = this.where(i);
      // Doppler: en truck som nærmer seg låter litt lysere, en som fjerner seg litt mørkere.
      if (!w.own && w.d !== undefined) {
        const vr = m.dist === null ? 0 : (w.d - m.dist) / dt;
        m.dop += (clamp(1 - vr / 343, 0.88, 1.12) - m.dop) * Math.min(1, dt / 0.15);
      } else m.dop = 1;
      m.dist = w.d ?? null;
      const known = throttle[i];
      const th = known ?? (speed > 3 ? clamp(0.55 + m.accel / 8, 0, 1) : 0);
      voice.update(dt, {
        on: live && !(t.rescue > 0),
        speed, throttle: t.turbo > 0 && state !== 'countdown' ? 1 : th, accel: m.accel,
        free: state === 'countdown' || !!t.air,
        onRoad: t.onRoad !== false, air: !!t.air, drift: t.drift || 0, turbo: t.turbo || 0,
        gain: w.gain * (state === 'finished' ? 0.6 : 1) * (t.plane > 0 ? 0.2 : 1), pan: w.pan, lowpass: w.lp, doppler: m.dop,
      });
      this.propeller(i, m, w, live && t.plane > 0 && !(t.rescue > 0));
      if (live) {
        if ((t.turbo || 0) > m.turbo + 0.25) this.boost(w);
        const tier = driftTier(t.drift || 0);
        if (tier > m.tier && w.own) this.driftChime(tier, w);
        m.tier = tier;
      }
      m.turbo = t.turbo || 0;
      if (t.air) m.vy = t.vy || 0;
    });
    for (let i = trucks.length; i < this.voices.length; i++) {
      this.voices[i]?.update(dt, { on: false, speed: 0, throttle: 0, gain: 0 });
    }
    this.updateMusic(game, listeners);
  }

  // Propell mens trucken er et fly: en tung, svevende saw-tone med luftsus. Bygges første gang og skrus bare av og på.
  propeller(i, m, w, on) {
    if (!on && !m.prop) return;
    const ctx = this.ctx;
    if (!m.prop) {
      const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
      const lp = ctx.createBiquadFilter(), air = ctx.createBufferSource(), airFilter = ctx.createBiquadFilter();
      const out = ctx.createGain(), pan = ctx.createStereoPanner();
      o.type = 'sawtooth';
      o.frequency.value = 74;
      lfo.frequency.value = 11; // bladene hakker i lufta
      lfoGain.gain.value = 5;
      lfo.connect(lfoGain).connect(o.frequency);
      lp.type = 'lowpass';
      lp.frequency.value = 520;
      air.buffer = this.assets.noise;
      air.loop = true;
      airFilter.type = 'bandpass';
      airFilter.frequency.value = 1800;
      airFilter.Q.value = 0.7;
      out.gain.value = 0;
      o.connect(lp).connect(out);
      air.connect(airFilter).connect(this.gain(out, 0.45));
      out.connect(pan).connect(this.engineBus);
      for (const n of [o, lfo, air]) n.start();
      m.prop = { o, lfo, air, lp, out, pan };
    }
    const { out, pan, lp, o } = m.prop;
    const t = ctx.currentTime;
    out.gain.setTargetAtTime(on ? 0.16 * w.gain : 0, t, 0.12);
    pan.pan.setTargetAtTime(w.pan || 0, t, 0.1);
    lp.frequency.setTargetAtTime(Math.min(520, w.lp), t, 0.1);
    o.frequency.setTargetAtTime(on ? 74 + 6 * Math.sin(t * 1.3 + i) : 74, t, 0.3);
  }

  updateMusic(game, listeners) {
    const st = game.state;
    if (st === 'menu') this.music.play('menu');
    else if (st === 'countdown') this.music.play('off');
    else if (st === 'racing') {
      this.music.play('race', game.seed);
      const watched = listeners.length ? listeners : game.trucks.map((_, i) => i);
      this.music.setFinal(watched.some((i) => game.trucks[i] && game.lap(game.trucks[i]) >= LAPS));
    } else if (st === 'finished') this.music.play('finish', game.seed, { win: !listeners.length || listeners.includes(game.winner) });
  }

  // ---------- Hendelser fra simuleringen ----------

  play(e) {
    const w = this.where(e.truck);
    if (e.type === 'tick') this.countBeep(false);
    else if (e.type === 'go') this.countBeep(true);
    else if (w.gain < 0.01) return;
    else if (e.type === 'coin') { if (w.own) this.coin(w); }
    else if (e.type === 'item') this.item(e.item, w);
    else if (e.type === 'hit') this.hit(e, w);
    else if (e.type === 'bump') {
      const o = e.other === undefined ? null : this.where(e.other);
      this.bump(e.power ?? 8, o && o.gain > w.gain ? o : w);
    } else if (e.type === 'land') this.land(-(this.memo[e.truck]?.vy ?? -8), w);
    else if (e.type === 'rescue') this.rescue(e.why, w);
    else if (e.type === 'lap') { if (w.own) this.lap(e.lap); }
    // 'finish' får fanfaren fra musikken når løpet går over i 'finished'.
  }

  // Nedtelling: tre like pip og et lysere durakkord-«KJØR!».
  countBeep(go) {
    this.vary(0);
    const d = this.dest(HERE, 0.2);
    if (!go) {
      this.tone(440, 0.3, { type: 'triangle', vol: 0.16, dest: d });
      this.tone(880, 0.18, { vol: 0.04, dest: d });
    } else {
      for (const f of [880, 1109, 1319]) this.tone(f, 0.75, { type: 'triangle', vol: 0.09, dest: d });
      this.tone(1760, 0.4, { vol: 0.035, dest: d });
    }
  }

  // Mynt: en lys to-tone «pling». Plukker man flere raskt etter hverandre, går den oppover i skalaen.
  coin(w) {
    const now = this.ctx.currentTime;
    this.coinStreak = now - this.coinAt < 1.2 ? Math.min(this.coinStreak + 1, 7) : 0;
    this.coinAt = now;
    const k = 2 ** ([0, 2, 4, 5, 7, 9, 11, 12][this.coinStreak] / 12);
    this.vary(0);
    const d = this.dest(w, 0.15);
    this.tone(988 * k, 0.09, { type: 'triangle', vol: 0.08, dest: d });
    this.tone(1319 * k, 0.3, { type: 'triangle', vol: 0.07, at: 0.065, dest: d });
    this.tone(2638 * k, 0.16, { vol: 0.018, at: 0.065, dest: d });
  }

  item(item, w) {
    if (w.own) {
      this.vary(0);
      const d = this.dest(w, 0.2);
      [0, 4, 7, 12].forEach((n, i) => this.tone(784 * 2 ** (n / 12), 0.13, { type: 'triangle', vol: 0.05, at: i * 0.045, dest: d }));
    }
    this.vary(0.6);
    const d = this.dest(w, 0.15);
    if (item === 'rocket') {
      this.noise(0.75, { vol: 0.22, type: 'bandpass', from: 300, to: 2600, q: 1.1, attack: 0.03, dest: d });
      this.tone(130, 0.22, { vol: 0.16, slide: -60, dest: d });
    } else if (item === 'shield') {
      for (const f of [523, 784, 1047]) this.tone(f, 0.7, { vol: 0.035, attack: 0.08, dest: d });
    } else if (item === 'oil') {
      this.noise(0.35, { vol: 0.15, from: 900, to: 180, dest: d });
      this.tone(260, 0.3, { vol: 0.1, slide: -150, dest: d });
    } else if (item === 'mine') {
      this.tone(520, 0.1, { type: 'triangle', vol: 0.07, dest: d });
      this.tone(1430, 0.08, { vol: 0.03, dest: d });
      for (const at of [0.18, 0.34]) this.tone(1800, 0.05, { type: 'triangle', vol: 0.035, at, dest: d });
    } else if (item === 'barricade') {
      for (const at of [0, 0.13]) {
        this.noise(0.12, { vol: 0.14, from: 700, to: 200, at, dest: d });
        this.tone(140, 0.12, { vol: 0.14, slide: -50, at, dest: d });
      }
    } else if (item === 'wheelloss') {
      this.noise(0.5, { vol: 0.12, type: 'bandpass', from: 2400, to: 500, q: 2, dest: d });
      this.tone(220, 0.4, { type: 'square', vol: 0.05, slide: -150, dest: d });
    } else if (item === 'plane') {
      this.tone(160, 0.9, { type: 'sawtooth', vol: 0.07, slide: 700, attack: 0.15, dest: d });
      this.noise(0.9, { vol: 0.15, type: 'bandpass', from: 400, to: 3000, q: 1, attack: 0.1, dest: d });
      [0, 4, 7].forEach((n, k) => this.tone(659 * 2 ** (n / 12), 0.25, { type: 'triangle', vol: 0.04, at: 0.3 + k * 0.07, dest: d }));
    }
    // Turbo får sitt «fwoosj» fra boost() når turboen starter.
  }

  // Turbo (power-up, boost-pad eller drift-boost): et luftstøt som åpner seg, med et dunk under.
  boost(w) {
    if (w.gain < 0.03) return;
    this.vary(1);
    const d = this.dest(w, 0.12);
    this.noise(0.6, { vol: 0.2, type: 'bandpass', from: 350, to: 2200, q: 1.2, attack: 0.04, dest: d });
    this.tone(70, 0.3, { vol: 0.16, slide: 60, dest: d });
  }

  // Driftnivå (gul, oransje, blå): små klokker som stiger.
  driftChime(tier, w) {
    this.vary(0);
    const d = this.dest(w, 0.2);
    const f = [0, 1047, 1319, 1568][tier];
    this.tone(f, 0.16, { type: 'triangle', vol: 0.045, dest: d });
    this.tone(f * 2, 0.12, { vol: 0.015, dest: d });
    if (tier === 3) this.tone(f * 1.5, 0.2, { type: 'triangle', vol: 0.03, at: 0.06, dest: d });
  }

  hit(e, w) {
    this.vary(1);
    if (e.cause === 'wheelloss') this.wheelLoss(w);
    else if (e.cause === 'rocket' && !e.shielded) this.explosion(w, 1);
    else if (e.cause === 'mine' && !e.shielded) this.explosion(w, 0.75);
    else if (e.cause === 'rocket' || e.cause === 'mine' || e.cause === 'shield') this.deflect(w);
    else this.spinOut(w);
  }

  // Hjulene letter: et smell og skrapende metall mot asfalten.
  wheelLoss(w) {
    const d = this.dest(w, 0.2);
    this.tone(110, 0.25, { type: 'square', vol: 0.12, slide: -60, dest: d });
    this.noise(0.9, { vol: 0.16, type: 'bandpass', from: 3200, to: 900, q: 3, attack: 0.02, dest: d });
    for (const at of [0.1, 0.25, 0.42]) this.tone(740, 0.12, { type: 'triangle', vol: 0.04, slide: -300, at, dest: d });
  }

  // Eksplosjon i lag: et kort støt, et dypt dunk som faller, en støyhale som mørkner og litt knitring.
  explosion(w, s) {
    const d = this.dest(w, 0.45);
    this.tone(95, 0.07, { type: 'square', vol: 0.16 * s, dest: d });
    this.tone(110, 0.9 * s, { vol: 0.5 * s, slide: -80, dest: d });
    this.noise(1.3 * s, { vol: 0.4 * s, from: 3200, to: 110, dest: d });
    for (let k = 0; k < 7; k++) {
      this.noise(0.03, { vol: (0.04 + 0.05 * this.rand()) * s, type: 'bandpass', from: 1200 + 2500 * this.rand(), q: 2, at: 0.1 + this.rand() * 0.8 * s, dest: d });
    }
  }

  // Skjoldet tar støyten: metallisk klang og et lite smell.
  deflect(w) {
    const d = this.dest(w, 0.35);
    for (const [r, v] of [[1, 0.07], [2.76, 0.035], [5.4, 0.015]]) this.tone(620 * r, 0.6, { vol: v, dest: d });
    this.noise(0.4, { vol: 0.14, from: 2500, to: 300, dest: d });
  }

  // Påkjørt bakfra og spinner: dekkhvin og et dunk.
  spinOut(w) {
    const d = this.dest(w, 0.15);
    this.noise(0.8, { vol: 0.1, type: 'bandpass', from: 2600, to: 1500, q: 7, attack: 0.03, dest: d });
    this.noise(0.25, { vol: 0.18, from: 2500, to: 250, dest: d });
    this.tone(150, 0.4, { vol: 0.14, slide: -100, dest: d });
  }

  // Kollisjon (truck mot truck eller veisperre): dunk, knas og litt metallklang, sterkere jo hardere smell.
  bump(power, w) {
    const p = clamp((power - 5) / 20, 0, 1);
    this.vary(1.5);
    const d = this.dest(w, 0.12);
    this.tone(120 - 40 * p, 0.18 + 0.12 * p, { vol: 0.2 + 0.25 * p, slide: -55, dest: d });
    this.noise(0.14 + 0.18 * p, { vol: 0.08 + 0.2 * p, from: 2400, to: 250, dest: d });
    [1, 2.31, 3.7].forEach((r, k) => this.tone(310 * r, 0.12 + 0.15 * p, { vol: (0.03 + 0.04 * p) / (k + 1), dest: d }));
  }

  // Landing: fjæringen tar imot. fall: fallfarten (m/s) like før landing.
  land(fall, w) {
    const s = clamp((fall - 4) / 16, 0.15, 1);
    this.vary(1);
    const d = this.dest(w, 0.08);
    this.tone(80, 0.22 + 0.1 * s, { vol: 0.08 + 0.3 * s, slide: -38, dest: d });
    this.noise(0.16, { vol: 0.03 + 0.12 * s, from: 900, to: 150, dest: d });
    if (s > 0.6) for (const f of [220, 507]) this.tone(f, 0.1, { vol: 0.03, at: 0.02, dest: d });
  }

  rescue(why, w) {
    this.vary(0.3);
    const d = this.dest(w, 0.3);
    if (why === 'water') {
      this.noise(0.6, { vol: 0.22, type: 'highpass', from: 1500, to: 400, dest: d });
      this.noise(0.5, { vol: 0.15, from: 500, to: 150, at: 0.05, dest: d });
      this.tone(180, 0.35, { vol: 0.08, slide: -90, at: 0.05, dest: d });
    }
    if (why !== 'rocket') {
      this.tone(330, 0.7, { vol: 0.05, slide: 660, attack: 0.12, at: 0.15, dest: d });
      this.tone(495, 0.7, { vol: 0.025, slide: 990, attack: 0.12, at: 0.2, dest: d });
    }
  }

  // Ny runde: et klokkespill. Inn på siste runde: en kort fanfare (musikken trappes opp samtidig).
  lap(done) {
    this.vary(0);
    const d = this.dest(HERE, 0.3);
    if (done === LAPS - 1) {
      [0, 4, 7, 12].forEach((n, i) => this.tone(880 * 2 ** (n / 12), i === 3 ? 0.6 : 0.14, { type: 'triangle', vol: 0.08, at: i * 0.11, dest: d }));
    } else {
      this.tone(1319, 0.2, { type: 'triangle', vol: 0.08, dest: d });
      this.tone(1760, 0.5, { type: 'triangle', vol: 0.08, at: 0.12, dest: d });
    }
  }

  // Til ?debug-visningen.
  info(i) {
    const v = this.voices[i];
    return v ? `turtall ${Math.round(v.model.rpm)} gir ${v.model.gear + 1}` : '';
  }
}
