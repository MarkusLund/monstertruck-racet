// Tiny synthesized sound effects (no audio files needed).
export class Sound {
  constructor() { this.ctx = null; }
  unlock() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
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
    else if (type === 'respawn' || type === 'flip') this.beep(220, 0.3, 'sawtooth', 0.05, -120);
    else if (type === 'finish') { this.beep(660, 0.2); setTimeout(() => this.beep(880, 0.4), 180); }
  }
}
