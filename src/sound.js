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
  play(type) {
    if (type === 'coin') this.beep(1200, 0.12, 'square', 0.05, 600);
    else if (type === 'tick') this.beep(440, 0.15);
    else if (type === 'go') this.beep(880, 0.35);
    else if (type === 'item') { this.beep(660, 0.1, 'triangle', 0.07, 400); setTimeout(() => this.beep(990, 0.18, 'triangle', 0.07), 90); }
    else if (type === 'hit') this.beep(160, 0.45, 'sawtooth', 0.09, -110);
    else if (type === 'bump') this.beep(120, 0.14, 'square', 0.07, -50);
    else if (type === 'land') this.beep(90, 0.12, 'triangle', 0.09, -30);
    else if (type === 'lap') { this.beep(520, 0.12); setTimeout(() => this.beep(780, 0.2), 110); }
    else if (type === 'finish') { this.beep(660, 0.2); setTimeout(() => this.beep(880, 0.4), 180); }
  }
}
