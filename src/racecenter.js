import { LAPS } from './game.js';

// Tilskuerpanelet midt på delt skjerm: minikart over banen, hvor mange runder som gjenstår og stillingen.
// Vises for tilskuere (fjernspillere som ikke er med i løpet) og på vertens skjerm når den viser flere spillere.

const COLORS = ['#ff6a50', '#5aa2ff', '#4fd36a', '#ffc83a'];

export class RaceCenter {
  constructor(el) {
    this.el = el;
    el.innerHTML = `<div class="rc-badge" id="rc-badge"></div>
      <div class="rc-laps"><span id="rc-lap"></span><small id="rc-left"></small></div>
      <canvas class="rc-map"></canvas>
      <div class="rc-time" id="rc-time"></div>
      <ol class="rc-list" id="rc-list"></ol>`;
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.base = null; // ferdigtegnet bane (lages på nytt når banen eller størrelsen endres)
    this.baseKey = '';
    this.listKey = '';
  }

  // Skalerer banen inn i et kvadrat med litt luft rundt. x mot høyre, z nedover (sett rett ovenfra).
  fit(track, size) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = size * 0.09;
    const k = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ, 1);
    const ox = (size - (maxX - minX) * k) / 2 - minX * k, oz = (size - (maxZ - minZ) * k) / 2 - minZ * k;
    return (x, z) => [x * k + ox, z * k + oz];
  }

  drawBase(track, size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const map = this.fit(track, size);
    g.lineJoin = g.lineCap = 'round';
    g.beginPath();
    track.pts.forEach((p, i) => { const [x, y] = map(p.x, p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath();
    g.strokeStyle = 'rgba(8, 10, 16, .85)';
    g.lineWidth = size * 0.06;
    g.stroke();
    g.strokeStyle = '#c9ced8';
    g.lineWidth = size * 0.032;
    g.stroke();
    // Ramper og boost-pads som små markeringer langs banen.
    const mark = (p, color) => {
      const [x, y] = map(p.x, p.z);
      g.fillStyle = color;
      g.beginPath(); g.arc(x, y, size * 0.014, 0, Math.PI * 2); g.fill();
    };
    for (const j of track.jumps || []) mark(track.pts[Math.round(j.s0 / 2) % track.count], '#ff9f2e');
    for (const pad of track.pads || []) mark(pad, '#3ad1ff');
    // Start/mål: rutete strek på tvers av banen.
    const p0 = track.pts[0];
    const [sx, sy] = map(p0.x, p0.z);
    g.save();
    g.translate(sx, sy);
    g.rotate(Math.atan2(p0.tz, p0.tx));
    const w = size * 0.022, h = size * 0.07;
    for (let k = 0; k < 4; k++) for (let m = 0; m < 2; m++) {
      g.fillStyle = (k + m) % 2 ? '#111' : '#fff';
      g.fillRect(-w / 2 + (m * w) / 2, -h / 2 + (k * h) / 4, w / 2, h / 4);
    }
    g.restore();
    return { canvas: c, map };
  }

  update(game, { badge = '', name = (i) => `Spiller ${i + 1}` } = {}) {
    const { canvas, ctx } = this;
    const css = canvas.clientWidth;
    if (!css) return;
    const size = Math.round(css * Math.min(window.devicePixelRatio || 1, 2));
    if (canvas.width !== size) canvas.width = canvas.height = size;
    const key = `${game.seed}|${size}|${game.track.pads?.length}|${game.track.jumps?.length}`;
    if (key !== this.baseKey) { this.baseKey = key; this.base = this.drawBase(game.track, size); }
    const { map } = this.base;

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.base.canvas, 0, 0);
    // Veisperrer og raketter.
    for (const b of game.barricades) {
      const [x, y] = map(b.x, b.z);
      ctx.fillStyle = '#ff7a1a';
      ctx.fillRect(x - size * 0.016, y - size * 0.016, size * 0.032, size * 0.032);
    }
    for (const p of game.projectiles) {
      const [x, y] = map(p.x, p.z);
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath(); ctx.arc(x, y, size * 0.012, 0, Math.PI * 2); ctx.fill();
    }
    // Truckene, den bakerste tegnes først så lederen ligger øverst.
    const order = game.order();
    for (const t of [...order].reverse()) {
      const [x, y] = map(t.x, t.z);
      const r = size * (t === order[0] ? 0.042 : 0.034);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t.theta);
      ctx.fillStyle = COLORS[t.id];
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = size * 0.01;
      ctx.beginPath();
      ctx.moveTo(r * 1.25, 0);
      ctx.lineTo(-r * 0.8, r * 0.85);
      ctx.lineTo(-r * 0.45, 0);
      ctx.lineTo(-r * 0.8, -r * 0.85);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }

    const leader = order[0];
    const lap = game.lap(leader);
    const left = LAPS - lap;
    this.text('rc-badge', badge);
    this.el.querySelector('#rc-badge').classList.toggle('hidden', !badge);
    this.text('rc-lap', game.state === 'countdown' ? 'Klar …' : `Runde ${lap}/${LAPS}`);
    this.text('rc-left', game.state === 'countdown' ? `${LAPS} runder` : left === 0 ? 'Siste runde!' : `${left} ${left === 1 ? 'runde' : 'runder'} igjen`);
    this.el.classList.toggle('final', game.state === 'racing' && left === 0);
    this.text('rc-time', fmtTime(game.time));

    // Stillingen: plass, navn, runde og avstand til lederen.
    const { length } = game.track;
    const rows = order.map((t, i) => {
      const behind = Math.max(0, leader.dist - t.dist);
      const laps = Math.floor(behind / length);
      let gap = i === 0 ? 'Leder' : laps ? `−${laps} ${laps === 1 ? 'runde' : 'runder'}` : `−${Math.round(behind)} m`;
      if (t.finished) gap = 'I mål';
      const prog = Math.round(game.progress(t) * 100);
      return `<li class="c${t.id}"><b>${i + 1}</b><span class="nm">${name(t.id)}</span><span class="gp">${gap}</span><i style="width:${prog}%"></i></li>`;
    }).join('');
    if (rows !== this.listKey) { this.listKey = rows; this.el.querySelector('#rc-list').innerHTML = rows; }
  }

  text(id, value) {
    const e = this.el.querySelector(`#${id}`);
    if (e.textContent !== value) e.textContent = value;
  }
}

function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
