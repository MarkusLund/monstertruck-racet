// Tiny synthesized sound effects (no audio files needed).
export class Sound {
  constructor() { this.ctx = null; }
  unlock() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
  }
  // Motorbrumming: to sagtannsoscillatorer som følger farten (0..1) og gassen.
  engine(speedFrac, throttle, on) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.motor) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth';
      g.gain.value = 0;
      o.connect(g).connect(ctx.destination);
      o.start();
      this.motor = { o, g };
    }
    const t = ctx.currentTime;
    this.motor.o.frequency.setTargetAtTime(48 + speedFrac * 70 + throttle * 12, t, 0.08);
    this.motor.g.gain.setTargetAtTime(on ? 0.018 + throttle * 0.014 : 0, t, 0.1);
  }
  beep(freq, dur, type = 'square', vol = 0.08, slide = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  }
  // Støy (eksplosjon, krasj): filtrert hvit støy med fallende filterfrekvens.
  noise(dur, vol, from, to, type = 'lowpass') {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noiseBuf;
    f.type = type;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur);
  }
  explosion(scale = 1) {
    this.noise(0.9 * scale, 0.3, 2400, 90);
    this.beep(110, 0.5 * scale, 'sine', 0.3, -80);
    this.beep(60, 0.7 * scale, 'sine', 0.25, -35);
  }
  play(type, e = {}) {
    if (type === 'coin') this.beep(1200, 0.12, 'square', 0.05, 600);
    else if (type === 'tick') this.beep(440, 0.15);
    else if (type === 'go') this.beep(880, 0.35);
    else if (type === 'item') {
      if (e.item === 'rocket') this.noise(0.5, 0.12, 400, 3000, 'bandpass');
      this.beep(660, 0.1, 'triangle', 0.07, 400);
      setTimeout(() => this.beep(990, 0.18, 'triangle', 0.07), 90);
    } else if (type === 'hit') {
      if (e.cause === 'rocket' && !e.shielded) this.explosion();
      else if (e.cause === 'rocket' || e.cause === 'shield') { this.explosion(0.4); this.beep(1500, 0.3, 'triangle', 0.06, -900); }
      else { this.noise(0.35, 0.2, 3000, 300); this.beep(160, 0.45, 'sawtooth', 0.09, -110); }
    } else if (type === 'bump') {
      const power = Math.max(0, Math.min(1, ((e.power ?? 8) - 5) / 20));
      this.noise(0.12 + power * 0.18, 0.08 + power * 0.18, 2500, 200);
      this.beep(120 - power * 40, 0.14 + power * 0.1, 'square', 0.06 + power * 0.06, -50);
    } else if (type === 'land') { this.noise(0.12, 0.08, 800, 150); this.beep(90, 0.12, 'triangle', 0.09, -30); }
    else if (type === 'lap') { this.beep(520, 0.12); setTimeout(() => this.beep(780, 0.2), 110); }
    else if (type === 'finish') { this.beep(660, 0.2); setTimeout(() => this.beep(880, 0.4), 180); }
  }
}
