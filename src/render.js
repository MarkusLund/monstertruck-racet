import { TRUCK } from './truck.js';

export const PLAYER_COLORS = [
  { body: '#e8412c', dark: '#a82513', light: '#ff8a6b' },
  { body: '#2f7fe8', dark: '#1a4fa8', light: '#8ec1ff' },
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.clouds = Array.from({ length: 14 }, (_, i) => ({ x: i * 260 + Math.random() * 120, y: 40 + Math.random() * 140, s: 0.6 + Math.random() * 0.8 }));
  }

  draw(game, cam, time) {
    const { ctx } = this;
    const W = cam.w, H = cam.h;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSky(ctx, W, H, cam);

    const z = cam.zoom;
    ctx.setTransform(z, 0, 0, -z, W / 2 - cam.x * z, H / 2 + cam.y * z);
    const x0 = cam.toWorldX(0) - 2, x1 = cam.toWorldX(W) + 2;
    const yBottom = cam.y - H / 2 / z - 2;

    this.drawPits(ctx, game.track, x0, x1);
    this.drawGround(ctx, game.track, x0, x1, yBottom, z);
    this.drawFlags(ctx, game.track, z);
    this.drawCoins(ctx, game.coins, x0, x1, time);
    // Draw player 2 first so player 1 is on top when they overlap.
    for (let i = game.trucks.length - 1; i >= 0; i--) this.drawTruck(ctx, game.trucks[i], PLAYER_COLORS[i], z);

    // Player markers (constant screen size).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    game.trucks.forEach((t, i) => {
      const p = cam.toScreen(t.x, t.y + 2.2);
      const s = Math.max(1, window.devicePixelRatio || 1);
      ctx.fillStyle = PLAYER_COLORS[i].body;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 8 * s, p.y - 12 * s);
      ctx.lineTo(p.x + 8 * s, p.y - 12 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.font = `900 ${13 * s}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(`P${i + 1}`, p.x, p.y - 16 * s);
    });
  }

  drawSky(ctx, W, H, cam) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#5fb4f0');
    g.addColorStop(1, '#d9f0ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Parallax mountains, anchored just above the ground under the camera.
    const horizon = Math.min(H * 0.95, cam.toScreen(cam.x, cam.groundRef ?? 0).y + 20);
    const layers = [
      { f: 0.05, c: '#a9cde6', h: 0.26, w: 0.004 },
      { f: 0.12, c: '#8fb8a4', h: 0.15, w: 0.007 },
    ];
    for (const L of layers) {
      ctx.fillStyle = L.c;
      ctx.beginPath();
      ctx.moveTo(0, H);
      ctx.lineTo(0, horizon);
      const off = cam.x * 40 * L.f;
      for (let sx = 0; sx <= W + 10; sx += 8) {
        const u = (sx * 1600 / Math.max(W, 1) + off) * L.w;
        const n = Math.sin(u) * 0.5 + Math.sin(u * 2.3 + 1) * 0.3 + Math.sin(u * 5.1 + 2) * 0.2;
        ctx.lineTo(sx, horizon - H * L.h * (0.55 + 0.45 * n));
      }
      ctx.lineTo(W, H);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const span = 14 * 260;
    for (const c of this.clouds) {
      let x = ((c.x - cam.x * 4) % span + span) % span - 200;
      x = x * (W / 1600);
      const y = c.y * (H / 800), r = 26 * c.s * (W / 1600);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.arc(x + r * 1.1, y + r * 0.2, r * 0.8, 0, Math.PI * 2);
      ctx.arc(x - r * 1.1, y + r * 0.25, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawPits(ctx, track, x0, x1) {
    for (const p of track.pits) {
      if (p.x1 < x0 || p.x0 > x1) continue;
      const top = Math.max(p.rimY, p.landY) + 0.5;
      const g = ctx.createLinearGradient(0, top, 0, p.floorY);
      g.addColorStop(0, '#3b2a1c');
      g.addColorStop(1, '#120b06');
      ctx.fillStyle = g;
      ctx.fillRect(p.x0, p.floorY, p.x1 - p.x0, top - p.floorY);
      // Mud at the bottom
      ctx.fillStyle = '#5a3d1a';
      ctx.fillRect(p.x0, p.floorY, p.x1 - p.x0, 1.2);
    }
  }

  visiblePoints(track, x0, x1) {
    const pts = track.points;
    let a = 0;
    while (a < pts.length - 1 && pts[a + 1].x < x0) a++;
    let b = a;
    while (b < pts.length - 1 && pts[b].x < x1) b++;
    return pts.slice(a, b + 1);
  }

  drawGround(ctx, track, x0, x1, yBottom, z) {
    const pts = this.visiblePoints(track, x0, x1);
    if (pts.length < 2) return;
    const minY = Math.min(yBottom, ...pts.map((p) => p.y)) - 5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, minY);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(pts[pts.length - 1].x, minY);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 20, 0, -30);
    g.addColorStop(0, '#9a6b3c');
    g.addColorStop(1, '#5e3d20');
    ctx.fillStyle = g;
    ctx.fill();

    // Grass edge
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#3f9a2e';
    ctx.lineWidth = Math.max(0.35, 5 / z);
    ctx.stroke();
    ctx.strokeStyle = '#6cc443';
    ctx.lineWidth = Math.max(0.12, 2 / z);
    ctx.stroke();
  }

  drawFlags(ctx, track, z) {
    const draw = (x, label, checkered) => {
      const gy = this.groundY(track, x);
      const h = 7;
      ctx.fillStyle = '#eee';
      ctx.fillRect(x - 0.12, gy, 0.24, h);
      if (checkered) {
        const s = 0.6;
        for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
          ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff';
          ctx.fillRect(x + 0.12 + c * s, gy + h - (r + 1) * s, s, s);
        }
        // Finish line on the ground
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
          ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff';
          ctx.fillRect(x - 0.5 + c * 0.5, gy - 0.5 + r * 0.25, 0.5, 0.25);
        }
      } else {
        ctx.fillStyle = '#ffd400';
        ctx.fillRect(x + 0.12, gy + h - 1.6, 3, 1.6);
      }
      ctx.save();
      ctx.scale(1, -1);
      ctx.fillStyle = checkered ? '#111' : '#333';
      ctx.font = `900 1.1px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x + (checkered ? 1.9 : 1.6), -(gy + h + 0.5));
      ctx.restore();
    };
    draw(track.startX + 3, 'START', false);
    draw(track.goalX, 'MÅL', true);
  }

  groundY(track, x) {
    const pts = track.points;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].x >= x) {
        const a = pts[i - 1], b = pts[i];
        return b.x === a.x ? b.y : a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
      }
    }
    return 0;
  }

  drawCoins(ctx, coins, x0, x1, time) {
    for (const c of coins) {
      if (c.taken || c.x < x0 || c.x > x1) continue;
      const sx = Math.abs(Math.cos(time * 3 + c.x * 0.4)) * 0.8 + 0.2;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(sx, 1);
      ctx.beginPath();
      ctx.arc(0, 0, 0.55, 0, Math.PI * 2);
      ctx.fillStyle = '#f5b800';
      ctx.fill();
      ctx.lineWidth = 0.1;
      ctx.strokeStyle = '#a86f00';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 0.33, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd84a';
      ctx.fill();
      ctx.restore();
    }
  }

  drawTruck(ctx, t, col, z) {
    const c = t.chassis.getPosition();
    const a = t.chassis.getAngle();
    // Suspension struts
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 0.18;
    for (const [i, w] of t.wheels.entries()) {
      const wp = w.getPosition();
      const side = i === 0 ? -1 : 1;
      const ax = c.x + Math.cos(a) * side * 0.9 - Math.sin(a) * -0.1;
      const ay = c.y + Math.sin(a) * side * 0.9 + Math.cos(a) * -0.1;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(wp.x, wp.y);
      ctx.stroke();
    }
    // Body
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(a);
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(-1.6, -0.45, 3.2, 0.25); // frame
    ctx.fillStyle = col.body;
    roundRect(ctx, -1.8, -0.3, 3.6, 0.65, 0.15);
    ctx.fill();
    ctx.fillStyle = col.dark;
    ctx.fillRect(-1.8, -0.3, 3.6, 0.14);
    // Cabin
    ctx.beginPath();
    ctx.moveTo(-0.75, 0.33);
    ctx.lineTo(0.8, 0.33);
    ctx.lineTo(0.5, 1.05);
    ctx.lineTo(-0.6, 1.05);
    ctx.closePath();
    ctx.fillStyle = col.body;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-0.52, 0.42);
    ctx.lineTo(0.62, 0.42);
    ctx.lineTo(0.42, 0.93);
    ctx.lineTo(-0.44, 0.93);
    ctx.closePath();
    ctx.fillStyle = '#bfe6ff';
    ctx.fill();
    ctx.fillStyle = col.light;
    ctx.fillRect(1.55, 0.05, 0.25, 0.18); // headlight
    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(-1.3, 0.12, 1.0, 0.1); // stripe
    ctx.fillRect(0.9, 0.12, 0.5, 0.1);
    ctx.restore();

    for (const w of t.wheels) {
      const p = w.getPosition(), r = TRUCK.wheelRadius;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(w.getAngle());
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = '#1b1b1b';
      ctx.fill();
      // Treads
      ctx.fillStyle = '#333';
      for (let k = 0; k < 12; k++) {
        ctx.save();
        ctx.rotate((k / 12) * Math.PI * 2);
        ctx.fillRect(r - 0.12, -0.08, 0.14, 0.16);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#9aa0a6';
      ctx.fill();
      ctx.strokeStyle = '#5b6168';
      ctx.lineWidth = 0.07;
      for (let k = 0; k < 5; k++) {
        const ang = (k / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang) * r * 0.48, Math.sin(ang) * r * 0.48);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = col.body;
      ctx.fill();
      ctx.restore();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
