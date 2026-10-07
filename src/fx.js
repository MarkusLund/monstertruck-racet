import * as THREE from 'three';
import { MAX_SPEED } from './truck.js';
import { groundHeight, clearance } from './terrain.js';

// Visuelle effekter ("game feel"): partikler, eksplosjoner, kamerarist og sakte-film.
// Alt her er ren visning og leser bare spilltilstanden, så den autoritative fysikken (verten) berøres ikke.
// Alle partikler ligger i én forhåndsallokert pool (én Points-tegning), og meshene til glimt gjenbrukes.

const MAX_PARTICLES = 900;
const FLASHES = 4;
const SLOW_SCALE = 0.3; // visuell tidsskala under sakte-film
const SLOW_TIME = 0.5; // sekunder (virkelig tid) med sakte-film etter rakettreff
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

const VERT = `
attribute float size;
attribute float alpha;
attribute vec3 pcolor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = alpha;
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * 380.0 / max(0.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0 || vAlpha <= 0.01) discard;
  gl_FragColor = vec4(vColor, vAlpha * (1.0 - d * d * 0.6));
}`;

const SPARK = [1, 0.85, 0.4];
const SHIELD_SPARK = [0.5, 0.85, 1];

export class Fx {
  constructor(scene) {
    const n = MAX_PARTICLES;
    // Partikkeltilstand i typede arrayer (ingen allokering per partikkel).
    this.p = {
      pos: new Float32Array(n * 3), vel: new Float32Array(n * 3),
      life: new Float32Array(n), maxLife: new Float32Array(n),
      size: new Float32Array(n), grow: new Float32Array(n),
      grav: new Float32Array(n), drag: new Float32Array(n), a0: new Float32Array(n),
      col: new Float32Array(n * 3),
      outSize: new Float32Array(n), outAlpha: new Float32Array(n),
    };
    this.next = 0;
    this.live = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p.pos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.p.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.p.outSize, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.p.outAlpha, 1));
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    const flashGeo = new THREE.SphereGeometry(1, 12, 8);
    this.flashes = Array.from({ length: FLASHES }, () => {
      const mesh = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, depthWrite: false }));
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, age: 1, scale: 1 };
    });
    this.nextFlash = 0;

    this.trauma = [0, 0, 0, 0]; // 0..1 per spillerskjerm
    this.kick = [0, 0, 0, 0]; // zoom-støt (synkende FOV) per spillerskjerm
    this.slow = 0; // gjenstående sakte-film (virkelig tid)
    this.dustAcc = [0, 0, 0, 0];
    this.stats = { hits: 0, bumps: 0 }; // brukes av tester
  }

  // Visuell tidsskala (1 normalt, lavere under sakte-film).
  get timeScale() { return this.slow > 0 ? SLOW_SCALE : 1; }

  addTrauma(i, amount) {
    if (i === undefined || i < 0 || i >= this.trauma.length) return;
    this.trauma[i] = Math.min(1, this.trauma[i] + amount);
  }

  spawn(x, y, z, vx, vy, vz, life, size, grow, rgb, alpha, grav, drag) {
    const p = this.p, i = this.next;
    this.next = (i + 1) % MAX_PARTICLES;
    p.pos[i * 3] = x; p.pos[i * 3 + 1] = y; p.pos[i * 3 + 2] = z;
    p.vel[i * 3] = vx; p.vel[i * 3 + 1] = vy; p.vel[i * 3 + 2] = vz;
    p.life[i] = p.maxLife[i] = life;
    p.size[i] = size; p.grow[i] = grow; p.a0[i] = alpha; p.grav[i] = grav; p.drag[i] = drag;
    p.col[i * 3] = rgb[0]; p.col[i * 3 + 1] = rgb[1]; p.col[i * 3 + 2] = rgb[2];
  }

  // Gnister: gule (blå for skjold) som skyter utover og faller ned.
  sparks(x, y, z, count, speed, rgb = SPARK) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, up = rnd(0.2, 1);
      const s = rnd(0.4, 1) * speed;
      this.spawn(x, y, z, Math.cos(a) * s, up * s * 0.8, Math.sin(a) * s, rnd(0.25, 0.6), 0.35, 0, rgb, 1, -26, 0.4);
    }
  }

  dustPuff(x, y, z, count, rgb = [0.78, 0.7, 0.58]) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, s = rnd(1, 4);
      this.spawn(x, y, z, Math.cos(a) * s, rnd(0.8, 3), Math.sin(a) * s, rnd(0.5, 0.9), rnd(0.9, 1.5), 2.2, rgb, 0.4, 0.5, 2.5);
    }
  }

  explosion(x, y, z, scale = 1) {
    const f = this.flashes[this.nextFlash];
    this.nextFlash = (this.nextFlash + 1) % FLASHES;
    f.age = 0;
    f.scale = 4.5 * scale;
    f.mesh.position.set(x, y, z);
    f.mesh.visible = true;
    const fire = [[1, 0.75, 0.2], [1, 0.45, 0.1], [0.9, 0.25, 0.08]];
    for (let k = 0; k < Math.round(30 * scale); k++) {
      const a = Math.random() * Math.PI * 2, s = rnd(4, 15) * scale, up = rnd(0.1, 0.9);
      this.spawn(x, y, z, Math.cos(a) * s, up * s * 0.8, Math.sin(a) * s, rnd(0.4, 0.9), rnd(1.6, 2.8) * scale, 5, fire[k % 3], 0.9, 1, 3);
    }
    for (let k = 0; k < Math.round(18 * scale); k++) {
      const a = Math.random() * Math.PI * 2, s = rnd(1, 6) * scale, g = rnd(0.25, 0.4);
      this.spawn(x, y + 0.5, z, Math.cos(a) * s, rnd(3, 8), Math.sin(a) * s, rnd(1.1, 1.9), rnd(2, 3.2) * scale, 3.5, [g, g, g], 0.5, 1.5, 1.8);
    }
    this.sparks(x, y, z, Math.round(24 * scale), 20 * scale);
  }

  // Støv/jord bak bakhjulene når trucken kjører fort på bakken.
  updateDust(game, dt) {
    if (game.state !== 'racing' && game.state !== 'countdown') return;
    game.trucks.forEach((t, i) => {
      const frac = clamp((t.speed - 8) / (MAX_SPEED - 8), 0, 1);
      if (t.air || clearance(t) > 0.4 || frac <= 0) { this.dustAcc[i] = 0; return; }
      const offroad = !t.onRoad;
      this.dustAcc[i] += dt * frac * (offroad ? 36 : 16);
      const fx = Math.cos(t.theta), fz = Math.sin(t.theta);
      while (this.dustAcc[i] >= 1) {
        this.dustAcc[i] -= 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        const bx = t.x - fx * 2.3 - fz * side * 1.9, bz = t.z - fz * 2.3 + fx * side * 1.9;
        const back = t.speed * 0.12;
        const by = groundHeight(bx, bz);
        if (offroad) {
          const dirt = rnd(0.2, 0.3);
          this.spawn(bx, by + 0.3, bz, -fx * back + rnd(-2, 2), rnd(1, 3), -fz * back + rnd(-2, 2), rnd(0.6, 1.1), rnd(1.1, 1.8), 2.4, [0.45, 0.36, 0.24], 0.5, 0.5, 2.2);
          if (Math.random() < 0.5) this.spawn(bx, by + 0.4, bz, -fx * back * 0.6 + rnd(-3, 3), rnd(5, 9), -fz * back * 0.6 + rnd(-3, 3), rnd(0.5, 0.9), 0.5, 0, [dirt + 0.18, dirt + 0.08, dirt], 1, -22, 0);
        } else {
          this.spawn(bx, by + 0.2, bz, -fx * back + rnd(-1, 1), rnd(0.5, 1.6), -fz * back + rnd(-1, 1), rnd(0.4, 0.7), rnd(0.8, 1.2), 1.8, [0.8, 0.8, 0.82], 0.28, 0.3, 2.5);
        }
      }
    });
  }

  // Reagerer på et spill-event. `game` gir truckposisjoner. Kjøres likt hos vert og fjernspillere.
  // Høyder regnes fra truckens faktiske y (terreng + hopp).
  onEvent(e, game) {
    const t = game.trucks[e.truck];
    if (!t) return;
    const y = t.y;
    if (e.type === 'hit') {
      this.stats.hits++;
      if (e.cause === 'rocket' && !e.shielded) {
        this.explosion(t.x, y + 1.4, t.z, 1);
        this.addTrauma(e.truck, 1);
        this.kick[e.truck] = 1;
        this.slow = SLOW_TIME;
      } else if (e.cause === 'mine' && !e.shielded) {
        this.explosion(t.x, y + 0.8, t.z, 0.7);
        this.addTrauma(e.truck, 0.8);
      } else if (e.cause === 'rocket' || e.cause === 'mine') {
        this.explosion(t.x, y + 1.6, t.z, 0.5);
        this.sparks(t.x, y + 2, t.z, 22, 14, SHIELD_SPARK);
        this.addTrauma(e.truck, 0.5);
      } else if (e.cause === 'shield') {
        this.sparks(t.x, y + 1.8, t.z, 26, 14, SHIELD_SPARK);
        this.addTrauma(e.truck, 0.45);
      } else {
        this.sparks(t.x, y + 1, t.z, 20, 12);
        this.dustPuff(t.x, y + 0.4, t.z, 10);
        this.addTrauma(e.truck, 0.6);
      }
    } else if (e.type === 'bump') {
      this.stats.bumps++;
      const power = clamp(((e.power ?? 8) - 5) / 20, 0, 1);
      const o = game.trucks[e.other];
      const mx = o ? (t.x + o.x) / 2 : t.x + Math.cos(t.theta) * 2.2;
      const mz = o ? (t.z + o.z) / 2 : t.z + Math.sin(t.theta) * 2.2;
      const my = o ? (y + o.y) / 2 : y;
      this.sparks(mx, my + 0.8, mz, Math.round(8 + power * 28), 8 + power * 12);
      this.addTrauma(e.truck, 0.15 + power * 0.5);
      if (o) this.addTrauma(e.other, 0.15 + power * 0.5);
    } else if (e.type === 'land') {
      this.dustPuff(t.x, y + 0.3, t.z, 8);
      this.addTrauma(e.truck, 0.12);
    }
  }

  update(game, dt) {
    const sdt = dt * this.timeScale;
    if (this.slow > 0) this.slow = Math.max(0, this.slow - dt);
    this.updateDust(game, dt);

    const p = this.p;
    let live = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (p.life[i] <= 0) { p.outSize[i] = 0; p.outAlpha[i] = 0; continue; }
      p.life[i] -= sdt;
      if (p.life[i] <= 0) { p.outSize[i] = 0; p.outAlpha[i] = 0; continue; }
      live++;
      const k = i * 3, drag = Math.exp(-p.drag[i] * sdt);
      p.vel[k] *= drag; p.vel[k + 2] *= drag;
      p.vel[k + 1] = p.vel[k + 1] * drag + p.grav[i] * sdt;
      p.pos[k] += p.vel[k] * sdt; p.pos[k + 1] += p.vel[k + 1] * sdt; p.pos[k + 2] += p.vel[k + 2] * sdt;
      const floor = groundHeight(p.pos[k], p.pos[k + 2]) + 0.05; // partikler legger seg på terrenget
      if (p.pos[k + 1] < floor) { p.pos[k + 1] = floor; p.vel[k + 1] = 0; }
      const f = p.life[i] / p.maxLife[i];
      p.outSize[i] = p.size[i] + p.grow[i] * (1 - f);
      p.outAlpha[i] = p.a0[i] * Math.min(1, f * 2.5);
    }
    this.live = live;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.attributes.pcolor.needsUpdate = true;

    for (const f of this.flashes) {
      if (!f.mesh.visible) continue;
      f.age += sdt / 0.35;
      if (f.age >= 1) { f.mesh.visible = false; continue; }
      f.mesh.scale.setScalar(f.scale * (0.35 + f.age * 0.9));
      f.mesh.material.opacity = (1 - f.age) * 0.85;
    }
    for (let i = 0; i < this.trauma.length; i++) {
      this.trauma[i] = Math.max(0, this.trauma[i] - sdt * 1.5);
      this.kick[i] *= Math.exp(-sdt * 5);
    }
  }

  // Rister og zoomer kameraet til én spillerskjerm (kalles etter at kameraet er plassert).
  applyCamera(cam, i, time) {
    const tr = this.trauma[i];
    if (tr > 0.001) {
      const a = tr * tr * 1.6; // meter
      cam.translateX((Math.sin(time * 53 + i) + Math.sin(time * 37 + 2 * i)) * 0.5 * a);
      cam.translateY((Math.sin(time * 61 + 3 * i) + Math.sin(time * 29)) * 0.5 * a);
      cam.rotateZ(Math.sin(time * 43 + i) * tr * tr * 0.06);
    }
    cam.fov -= this.kick[i] * 9;
  }
}
