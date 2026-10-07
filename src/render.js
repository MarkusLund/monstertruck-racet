import * as THREE from 'three';
import { posAt, heightAt, SPACING } from './track.js';
import { MAX_SPEED, driftTier } from './truck.js';
import { groundHeight, groundSlope, roadDistance } from './terrain.js';
import { PAD_LENGTH, PAD_HALF_WIDTH } from './pads.js';
import { Countdown3D } from './countdown.js';
import { Fx } from './fx.js';

export const PLAYER_COLORS = [
  { body: 0xe8412c, dark: 0xa82513 },
  { body: 0x2f7fe8, dark: 0x1a4fa8 },
  { body: 0x2fb84a, dark: 0x1b7a2e },
  { body: 0xf2b21a, dark: 0xb07a00 },
];

// Plassering av spillerskjermene (brøkdeler av lerretet). 1 = full skjerm, 2 = side ved side, 3–4 = rutenett.
export function layoutViews(n) {
  if (n <= 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  if (n === 2) return [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }];
  return [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }];
}

// Kamera sett skrått ovenfra, bak trucken (som SNES Mario Kart, men brattere).
const CAM_BACK = 11;
const CAM_HEIGHT = 15;
const CAM_LOOK_AHEAD = 6;

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function canvasTexture(size, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  t.anisotropy = 4;
  return t;
}

const SPARKS = 28;
const DRIFT_COLORS = [0xffe23a, 0xff8a1f, 0x3aa8ff]; // gul, oransje, blå

const rnd = (a, b) => a + Math.random() * (b - a);

function grassTexture() {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#4c9f3c';
    g.fillRect(0, 0, s, s);
    // Store, myke flekker (slått gress) som gir variasjon, deretter strå.
    for (let i = 0; i < 60; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(90,170,60,.22)' : 'rgba(30,100,40,.2)';
      g.beginPath();
      g.arc(rnd(0, s), rnd(0, s), rnd(20, 70), 0, 7);
      g.fill();
    }
    for (let i = 0; i < 9000; i++) {
      const l = 100 + Math.random() * 120;
      g.strokeStyle = `hsla(${rnd(88, 125)},${rnd(45, 65)}%,${rnd(22, 48)}%,.55)`;
      g.lineWidth = 1;
      const x = rnd(0, s), y = rnd(0, s);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + rnd(-2, 2), y - rnd(3, 7));
      g.stroke();
    }
  }, 120);
}

function asphaltTexture() {
  const t = canvasTexture(512, (g, s) => {
    g.fillStyle = '#8a8d94';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 26000; i++) {
      const v = Math.floor(rnd(95, 200));
      g.fillStyle = `rgba(${v},${v},${v + 4},${rnd(0.15, 0.5)})`;
      g.fillRect(rnd(0, s), rnd(0, s), rnd(1, 2.4), rnd(1, 2.4));
    }
    // Sprekker og oljeflekker.
    g.strokeStyle = 'rgba(30,30,34,.5)';
    for (let i = 0; i < 6; i++) {
      g.lineWidth = rnd(0.6, 1.4);
      g.beginPath();
      let x = rnd(0, s), y = rnd(0, s);
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += rnd(-25, 25); y += rnd(10, 40); g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 5; i++) {
      g.fillStyle = 'rgba(20,20,26,.06)';
      g.beginPath();
      g.ellipse(rnd(0, s), rnd(0, s), rnd(15, 40), rnd(30, 80), 0, 0, 7);
      g.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function tireTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#18181c';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#2c2c33';
    // Kraftige mønsterklosser rundt dekket.
    for (let i = 0; i < 16; i++) {
      const x = (i / 16) * s;
      g.fillRect(x + 2, 8, s / 16 - 6, s * 0.34);
      g.fillRect(x + s / 32 + 2, s * 0.58, s / 16 - 6, s * 0.34);
    }
    g.fillStyle = '#101013';
    g.fillRect(0, s * 0.46, s, s * 0.08);
  });
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#3f86d8');
  grad.addColorStop(0.55, '#8cc6f0');
  grad.addColorStop(1, '#dff1fb');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function numberTexture(n, color) {
  return canvasTexture(128, (g, s) => {
    g.fillStyle = '#f4f4f4';
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.45, 0, 7);
    g.fill();
    g.fillStyle = color;
    g.font = `900 ${s * 0.68}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), s / 2, s / 2 + 5);
  });
}

// Flate bånd langs banen (vei, kantstein, midtstrek) med én farge per segment.
function strip(track, latA, latB, y, colorAt, material, vScale = 1 / 14) {
  const pos = [], col = [], uv = [];
  const { pts, count } = track;
  const c = new THREE.Color();
  const segs = Math.max(1, Math.ceil(Math.abs(latB - latA) / 3));
  for (let i = 0; i < count; i++) {
    const a = pts[i], b = pts[(i + 1) % count];
    const color = colorAt(i);
    if (!color) continue;
    c.set(color);
    const v = (p, lat) => { const x = p.x + p.nx * lat, z = p.z + p.nz * lat; return [x, groundHeight(x, z) + y, z]; };
    const va = i * SPACING * vScale, vb = (i + 1) * SPACING * vScale;
    // Delt på tvers så veien følger terrenget.
    for (let k = 0; k < segs; k++) {
      const la = latA + (latB - latA) * (k / segs), lb = latA + (latB - latA) * ((k + 1) / segs);
      const ua = k / segs, ub = (k + 1) / segs;
      const quad = [v(a, la), v(a, lb), v(b, lb), v(a, la), v(b, lb), v(b, la)];
      const uvs = [[ua, va], [ub, va], [ub, vb], [ua, va], [ub, vb], [ua, vb]];
      for (const q of quad) { pos.push(...q); col.push(c.r, c.g, c.b); }
      for (const t of uvs) uv.push(...t);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const mat = material || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  mat.vertexColors = true;
  mat.side = THREE.DoubleSide;
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

// Boost-pad som et lite rutenett der hvert hjørne følger terrenget (en flat plate ville gravd seg ned i bakkene).
// Teksturens opp-retning (v) peker i kjøreretningen.
function padGeometry(track, pad, n = 4) {
  const pos = [], uv = [], index = [];
  for (let i = 0; i <= n; i++) {
    for (let k = 0; k <= n; k++) {
      const u = k / n, v = i / n;
      const p = posAt(track, pad.s + (v - 0.5) * PAD_LENGTH, pad.lat + (u - 0.5) * PAD_HALF_WIDTH * 2);
      pos.push(p.x, groundHeight(p.x, p.z) + 0.09, p.z);
      uv.push(u, v);
      if (i < n && k < n) {
        const a = i * (n + 1) + k, b = a + n + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

// Legger en flat geometri (i XZ-planet) oppå terrenget rundt (x, z). Regnes bare om når posisjonen endres.
function drape(mesh, x, z, lift) {
  const { userData: u } = mesh;
  if (u.x === x && u.z === z) return;
  u.x = x; u.z = z;
  const pos = mesh.geometry.attributes.position;
  for (let k = 0; k < pos.count; k++) pos.setY(k, groundHeight(x + pos.getX(k), z + pos.getZ(k)) + lift);
  pos.needsUpdate = true;
  mesh.geometry.computeBoundingSphere();
  mesh.position.set(x, 0, z);
}

const TERRAIN_SIZE = 1400;
const TERRAIN_STEP = 4;
const lerp = (a, b, t) => a + (b - a) * t;

// Bakken: rutenett med høydeforskyvning og farge etter høyde (mørk grønn i daler, lysere og tørr på koller).
// Rett under veien senkes den litt, så asfalten aldri blir dekket av gresset.
function terrainGeometry(cx, cz) {
  const n = TERRAIN_SIZE / TERRAIN_STEP;
  const x0 = Math.round(cx) - TERRAIN_SIZE / 2, z0 = Math.round(cz) - TERRAIN_SIZE / 2;
  const pos = new Float32Array((n + 1) * (n + 1) * 3), col = new Float32Array((n + 1) * (n + 1) * 3), uv = new Float32Array((n + 1) * (n + 1) * 2);
  const low = [0.62, 0.86, 0.62], high = [1, 0.96, 0.74];
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      const k = iz * (n + 1) + ix;
      const x = x0 + ix * TERRAIN_STEP, z = z0 + iz * TERRAIN_STEP;
      const h = groundHeight(x, z);
      const dip = 0.15 * (1 - Math.min(1, Math.max(0, (roadDistance(x, z) - 9.5) / 3)));
      pos.set([x, h - dip, z], k * 3);
      const t = Math.max(0, Math.min(1, (h + 6) / 12));
      col.set(low.map((l, c) => lerp(l, high[c], t)), k * 3);
      uv.set([ix / n, 1 - iz / n], k * 2);
    }
  }
  const index = [];
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const a = iz * (n + 1) + ix, b = a + 1, c = a + n + 1, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function buildTruck(colors, number, tire) {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.15, ...extra });
  const paint = std(colors.body, { roughness: 0.3, metalness: 0.25 });
  const dark = std(colors.dark, { roughness: 0.5 });
  const black = std(0x1b1b1f, { roughness: 0.8, metalness: 0 });
  const chrome = std(0xdadde4, { roughness: 0.2, metalness: 0.8 });
  const glass = std(0x7fb8e6, { roughness: 0.05, metalness: 0.6 });
  const lamp = std(0xfff4c2, { emissive: 0xffe9a0, emissiveIntensity: 1.2 });
  const tail = std(0xff2a2a, { emissive: 0xff1010, emissiveIntensity: 0.8 });
  const box = (w, h, d, mat, x, y, z, parent = chassis) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  box(4.4, 0.8, 2.4, dark, 0, 1.7, 0); // understell
  box(2.0, 0.9, 2.5, paint, 1.2, 2.45, 0); // motorrom
  box(2.1, 1.0, 2.4, paint, -0.9, 2.55, 0); // førerhus
  box(0.1, 0.55, 2.0, glass, 0.15, 2.7, 0); // frontrute
  box(0.1, 0.5, 2.0, glass, -1.96, 2.7, 0); // bakrute
  box(2.0, 0.08, 2.2, dark, -0.9, 3.08, 0); // tak
  box(1.9, 0.5, 2.4, dark, -2.1, 2.1, 0); // lasteplan
  box(0.5, 0.35, 2.6, chrome, 2.35, 1.7, 0); // støtfanger
  box(0.06, 0.45, 1.5, black, 2.22, 2.4, 0); // grill
  for (const z of [0.85, -0.85]) {
    box(0.08, 0.28, 0.45, lamp, 2.22, 2.62, z);
    box(0.08, 0.22, 0.4, tail, -3.06, 2.15, z * 1.2);
  }
  // Lysbøyle på taket
  const bar = box(0.25, 0.25, 2.2, black, -0.2, 3.35, 0);
  for (const z of [-0.8, -0.3, 0.3, 0.8]) box(0.2, 0.2, 0.3, lamp, -0.2, 3.5, z, chassis);
  bar.castShadow = true;
  // Startnummer oppå panseret
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    new THREE.MeshBasicMaterial({ map: numberTexture(number, '#' + colors.body.toString(16).padStart(6, '0')), transparent: true }),
  );
  decal.rotation.x = -Math.PI / 2;
  decal.rotation.z = -Math.PI / 2;
  decal.position.set(1.5, 2.92, 0);
  chassis.add(decal);
  // Aksler
  for (const x of [1.55, -1.55]) {
    const ax = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.4, 8), black);
    ax.rotation.x = Math.PI / 2;
    ax.position.set(x, 1.15, 0);
    chassis.add(ax);
  }
  // Store hjul
  const wheelGeo = new THREE.CylinderGeometry(1.15, 1.15, 1.0, 28);
  wheelGeo.rotateX(Math.PI / 2);
  const rubber = new THREE.MeshStandardMaterial({ map: tire, roughness: 0.95, metalness: 0 });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.9 });
  const hubGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.06, 14);
  hubGeo.rotateX(Math.PI / 2);
  const wheels = [];
  for (const [x, z] of [[1.55, 1.6], [1.55, -1.6], [-1.55, 1.6], [-1.55, -1.6]]) {
    const w = new THREE.Group();
    w.position.set(x, 1.15, z);
    // Side-/toppflater får mønster, endeflatene er svarte.
    const tyre = new THREE.Mesh(wheelGeo, [rubber, sideMat, sideMat]);
    tyre.castShadow = true;
    w.add(tyre);
    const hub = new THREE.Mesh(hubGeo, chrome);
    w.add(hub);
    for (const side of [-1, 1]) {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 6), black);
      bolt.rotation.x = Math.PI / 2;
      bolt.position.z = side * 0.55;
      w.add(bolt);
    }
    root.add(w);
    wheels.push(w);
  }
  return { root, chassis, wheels };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x10131a);
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.countdown = new Countdown3D();
    this.fx = new Fx(this.scene);
    this.renderer.info.autoReset = false;
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(0xcfe8f7, 140, 420);
    this.cameras = [0, 1, 2, 3].map(() => new THREE.PerspectiveCamera(60, 1, 0.5, 600));
    this.camAngle = [0, 0, 0, 0];
    this.camGround = [0, 0, 0, 0]; // glattet bakkehøyde under hver spiller (kameraet skal ikke riste over bulker)
    this.camReady = false;
    this.trucks = [];
    this.coinMeshes = [];
    this.coinsRef = null;
    this.size = { w: 1, h: 1 };

    // Myk himmellys + varm sol. Solas skyggekart flyttes til hver spiller før hver visning tegnes.
    this.scene.add(new THREE.HemisphereLight(0xbfdcff, 0x4a6a35, 1.1));
    const sun = new THREE.DirectionalLight(0xfff0d0, 3.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 10; sc.far = 320;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.06;
    this.scene.add(sun, sun.target);
    this.sun = sun;
  }

  // Bygger banen, bakken og dekorasjonen en gang.
  buildWorld(track) {
    if (this.trackRef === track) return;
    this.trackRef = track;
    this.camReady = false;
    if (this.world) {
      this.scene.remove(this.world);
      this.world.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = [].concat(o.material || []);
        for (const m of mats) { m.map?.dispose(); m.bumpMap?.dispose(); m.dispose(); }
      });
    }
    const scene = new THREE.Group();
    this.scene.add(scene);
    this.world = scene;
    const hw = track.halfWidth;
    const xs = track.pts.map((p) => p.x), zs = track.pts.map((p) => p.z);
    const bb = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    const cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;

    const grass = grassTexture();
    grass.repeat.set(TERRAIN_SIZE / 20, TERRAIN_SIZE / 20);
    const ground = new THREE.Mesh(terrainGeometry(cx, cz), new THREE.MeshStandardMaterial({ map: grass, roughness: 1, metalness: 0, vertexColors: true }));
    ground.receiveShadow = true;
    scene.add(ground);

    const asphalt = asphaltTexture();
    asphalt.repeat.set(1, 1);
    const road = strip(track, -hw, hw, 0.04, (i) => (i % 8 < 4 ? 0xcfd0d4 : 0xe0e1e6),
      new THREE.MeshStandardMaterial({ map: asphalt, bumpMap: asphalt, bumpScale: 0.6, roughness: 0.85, metalness: 0 }), 1 / 16);
    scene.add(road);
    const curb = (a, b) => strip(track, a, b, 0.07, (i) => (Math.floor(i / 2) % 2 ? 0xe8412c : 0xf4f4f4));
    scene.add(curb(hw, hw + 1.4), curb(-hw - 1.4, -hw));
    scene.add(strip(track, -0.18, 0.18, 0.08, (i) => (i % 6 < 3 ? 0xf0f0f0 : null)));
    // Hvite kantlinjer innenfor kantsteinen.
    for (const side of [-1, 1]) scene.add(strip(track, side * (hw - 0.45), side * (hw - 0.15), 0.085, () => 0xf0f0f0));

    // Barrierer (røde og hvite blokker) langs begge sider.
    const blockGeo = new THREE.BoxGeometry(SPACING * 1.6, 1.4, 0.9);
    const blocks = new THREE.InstancedMesh(blockGeo, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05 }), Math.floor(track.count / 2) * 2);
    blocks.castShadow = true;
    blocks.receiveShadow = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (let i = 0; i < track.count; i += 2) {
      for (const side of [-1, 1]) {
        const p = track.pts[i];
        const lat = side * (track.wallLat + 0.6);
        q.setFromAxisAngle(up, -Math.atan2(p.tz, p.tx));
        const bx = p.x + p.nx * lat, bz = p.z + p.nz * lat;
        m4.compose(new THREE.Vector3(bx, groundHeight(bx, bz) + 0.7, bz), q, new THREE.Vector3(1, 1, 1));
        blocks.setMatrixAt(n, m4);
        blocks.setColorAt(n, new THREE.Color((i / 2) % 2 ? 0xe8412c : 0xf4f4f4));
        n++;
      }
    }
    scene.add(blocks);

    // Start/mål: rutete strek og portal.
    const checker = canvasTexture(128, (g, s) => {
      const cells = 8;
      for (let x = 0; x < cells; x++) for (let y = 0; y < cells; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
        g.fillRect((x * s) / cells, (y * s) / cells, s / cells + 1, s / cells + 1);
      }
    });
    const start = posAt(track, 0, 0);
    const finish = new THREE.Group();
    finish.position.set(start.x, groundHeight(start.x, start.z), start.z);
    finish.rotation.y = -start.theta;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(3, hw * 2), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7 }));
    line.receiveShadow = true;
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.1;
    finish.add(line);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.5 });
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), poleMat);
      pole.position.set(0, 4.5, side * (hw + 2.2));
      pole.castShadow = true;
      finish.add(pole);
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(2, 1.8, (hw + 2.2) * 2), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.6 }));
    banner.castShadow = true;
    banner.position.y = 9;
    finish.add(banner);
    scene.add(finish);

    // Trær utenfor banen.
    const rand = mulberry(Math.floor(track.length * 1000) % 100000);
    const spots = [];
    for (let tries = 0; tries < 2500 && spots.length < 260; tries++) {
      const x = bb.x0 - 90 + rand() * (bb.x1 - bb.x0 + 180), z = bb.z0 - 90 + rand() * (bb.z1 - bb.z0 + 180);
      let ok = true;
      for (let i = 0; i < track.count && ok; i += 2) {
        const p = track.pts[i];
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < (track.wallLat + 9) ** 2) ok = false;
      }
      if (ok) spots.push([x, z, 0.8 + rand() * 0.9]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 3, 6);
    trunkGeo.translate(0, 1.5, 0);
    const leafGeo = new THREE.ConeGeometry(2.6, 7, 7);
    leafGeo.translate(0, 6, 0);
    const bark = canvasTexture(64, (g, s) => {
      g.fillStyle = '#6b4423';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(30,15,5,${rnd(0.2, 0.5)})`; g.fillRect(rnd(0, s), 0, rnd(1, 3), s); }
    });
    const needles = canvasTexture(128, (g, s) => {
      g.fillStyle = '#2f7d32';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(15,70,25,.5)' : 'rgba(110,190,80,.35)';
        g.fillRect(rnd(0, s), rnd(0, s), 2, 5);
      }
    });
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ map: bark, roughness: 1 }), spots.length);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ map: needles, roughness: 0.9 }), spots.length);
    trunks.castShadow = leaves.castShadow = true;
    trunks.receiveShadow = leaves.receiveShadow = true;
    spots.forEach(([x, z, s], i) => {
      m4.compose(new THREE.Vector3(x, groundHeight(x, z) - 0.3, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, m4);
      leaves.setMatrixAt(i, m4);
    });
    scene.add(trunks, leaves);

    // Fjell i horisonten.
    const mountainMat = new THREE.MeshStandardMaterial({ color: 0x8fa6c4, roughness: 1, flatShading: true, fog: true });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.3;
      const h = 70 + rand() * 90;
      const m = new THREE.Mesh(new THREE.ConeGeometry(70 + rand() * 50, h, 6), mountainMat);
      m.position.set(cx + Math.cos(a) * 520, h / 2 - 2, cz + Math.sin(a) * 520);
      scene.add(m);
    }

    // Ramper (hopp): kile med farestriper.
    const hazard = canvasTexture(128, (g, sz) => {
      g.fillStyle = '#f2b705';
      g.fillRect(0, 0, sz, sz);
      g.fillStyle = '#1b1b1f';
      for (let i = -2; i < 6; i++) {
        g.beginPath();
        g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 16 + sz, sz); g.lineTo(i * 32 + sz, sz);
        g.fill();
      }
    }, 0);
    hazard.wrapS = hazard.wrapT = THREE.RepeatWrapping;
    for (const j of track.jumps) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(j.s1 - j.s0, j.h); shape.lineTo(j.s1 - j.s0, 0); shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: hw * 2, bevelEnabled: false });
      geo.translate(0, 0, -hw);
      const ramp = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.6 }));
      hazard.repeat.set(0.1, 0.1);
      ramp.castShadow = true;
      ramp.receiveShadow = true;
      const p = posAt(track, j.s0, 0);
      ramp.position.set(p.x, groundHeight(p.x, p.z) + 0.05, p.z);
      ramp.rotation.y = -p.theta;
      scene.add(ramp);
    }

    // Boost-pads: lysende piler på asfalten.
    const arrows = canvasTexture(128, (g, sz) => {
      g.fillStyle = '#06222e';
      g.fillRect(0, 0, sz, sz);
      g.fillStyle = '#35e8ff';
      for (const y of [0.08, 0.4]) {
        g.beginPath();
        g.moveTo(sz * 0.5, sz * y); g.lineTo(sz * 0.92, sz * (y + 0.34)); g.lineTo(sz * 0.7, sz * (y + 0.34));
        g.lineTo(sz * 0.5, sz * (y + 0.16)); g.lineTo(sz * 0.3, sz * (y + 0.34)); g.lineTo(sz * 0.08, sz * (y + 0.34));
        g.fill();
      }
    }, 0);
    const padMat = new THREE.MeshBasicMaterial({ map: arrows, side: THREE.DoubleSide });
    for (const pad of track.pads) scene.add(new THREE.Mesh(padGeometry(track, pad), padMat));
  }

  // Trucker og effekter lages en gang og gjenbrukes mellom løp.
  buildActors() {
    if (this.trucks.length) return;
    const tire = tireTexture();
    this.trucks = PLAYER_COLORS.map((c, i) => {
      const t = buildTruck(c, i + 1, tire);
      // Turbo-flammer bak og skjoldboble.
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa21a });
      const flames = new THREE.Group();
      for (const z of [-0.7, 0.7]) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.6, 8), flameMat);
        f.rotation.z = Math.PI / 2;
        f.position.set(-4.3, 1.9, z);
        flames.add(f);
      }
      flames.visible = false;
      t.chassis.add(flames);
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(3.7, 24, 16),
        new THREE.MeshStandardMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.28, emissive: 0x2a8fd0, emissiveIntensity: 0.7, roughness: 0.1 }),
      );
      bubble.position.y = 2;
      bubble.visible = false;
      t.root.add(bubble);
      // Drift-gnister/røyk ved bakhjulene; fargen følger drift-ladningen.
      const sparkGeo = new THREE.BufferGeometry();
      sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
      const sparkMat = new THREE.PointsMaterial({ size: 0.7, transparent: true, opacity: 0.9, depthWrite: false });
      const sparks = new THREE.Points(sparkGeo, sparkMat);
      sparks.frustumCulled = false;
      sparks.visible = false;
      t.root.add(sparks);
      this.scene.add(t.root);
      return { ...t, flames, bubble, sparks };
    });
    // Item-boks (roterende «?»-kube), veisperre og rakett deler geometri.
    this.boxGeo = new THREE.BoxGeometry(2.2, 2.2, 2.2);
    this.boxMat = new THREE.MeshStandardMaterial({
      map: canvasTexture(128, (g, sz) => {
        const grad = g.createLinearGradient(0, 0, sz, sz);
        grad.addColorStop(0, '#ffe45e'); grad.addColorStop(1, '#ff8a1c');
        g.fillStyle = grad;
        g.fillRect(0, 0, sz, sz);
        g.strokeStyle = '#fff';
        g.lineWidth = 8;
        g.strokeRect(6, 6, sz - 12, sz - 12);
        g.fillStyle = '#fff';
        g.font = `900 ${sz * 0.7}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('?', sz / 2, sz / 2 + 6);
      }),
      emissive: 0x5a3200, roughness: 0.35,
    });
    this.boxMeshes = [];
    this.rocketMeshes = [];
    this.barricadeMeshes = [];
    this.oilMeshes = [];
    this.mineMeshes = [];
    this.oilMat = new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.88 });
    this.mineBodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, metalness: 0.5, roughness: 0.4 });
    this.mineLightMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
    this.stripeMat = new THREE.MeshStandardMaterial({
      map: canvasTexture(128, (g, sz) => {
        for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f4f4f4' : '#e8412c'; g.fillRect((i * sz) / 8, 0, sz / 8 + 1, sz); }
      }),
      roughness: 0.5,
    });
  }

  buildCoins(coins) {
    for (const m of this.coinMeshes) this.scene.remove(m);
    this.coinsRef = coins;
    const geo = new THREE.CylinderGeometry(1.0, 1.0, 0.25, 18);
    geo.rotateZ(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0x7a5200, roughness: 0.25, metalness: 0.7 });
    this.coinMeshes = coins.map((c) => {
      const holder = new THREE.Group();
      holder.position.set(c.x, groundHeight(c.x, c.z) + 1.6, c.z);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      holder.add(mesh);
      this.scene.add(holder);
      return holder;
    });
  }

  // Item-bokser, raketter og veisperrer (meshene gjenbrukes).
  updateProps(game, time) {
    const grow = (list, make, count) => {
      while (list.length < count) { const m = make(); this.scene.add(m); list.push(m); }
    };
    grow(this.boxMeshes, () => { const m = new THREE.Mesh(this.boxGeo, this.boxMat); m.castShadow = true; return m; }, game.boxes.length);
    game.boxes.forEach((b, k) => {
      const m = this.boxMeshes[k];
      m.visible = b.cooldown <= 0;
      m.position.set(b.x, groundHeight(b.x, b.z) + 2.4 + Math.sin(time * 3 + k) * 0.3, b.z);
      m.rotation.set(0.4, time * 1.8 + k, 0.3);
    });
    this.boxMeshes.forEach((m, k) => { if (k >= game.boxes.length) m.visible = false; });

    grow(this.rocketMeshes, () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 2.4, 10), new THREE.MeshStandardMaterial({ color: 0xe8e8ee, metalness: 0.6, roughness: 0.3 }));
      body.rotation.z = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0xe8412c }));
      nose.rotation.z = -Math.PI / 2;
      nose.position.x = 1.6;
      const fire = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 8), new THREE.MeshBasicMaterial({ color: 0xffa21a }));
      fire.rotation.z = Math.PI / 2;
      fire.position.x = -1.9;
      g.add(body, nose, fire);
      g.traverse((o) => { o.castShadow = true; });
      return g;
    }, game.projectiles.length);
    this.rocketMeshes.forEach((m, k) => {
      const p = game.projectiles[k];
      m.visible = !!p;
      if (p) { m.position.set(p.x, groundHeight(p.x, p.z) + 2, p.z); m.rotation.y = -p.dir; }
    });

    grow(this.barricadeMeshes, () => {
      const g = new THREE.Group();
      const len = 18.8;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, len), this.stripeMat);
      beam.position.y = 1.6;
      const beam2 = beam.clone();
      beam2.position.y = 3.0;
      const legs = [-1, 1].map((sd) => {
        const l = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.6, 1.2), new THREE.MeshStandardMaterial({ color: 0x444a55 }));
        l.position.set(0, 1.8, sd * (len / 2 - 0.6));
        return l;
      });
      g.add(beam, beam2, ...legs);
      g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      return g;
    }, game.barricades.length);
    this.barricadeMeshes.forEach((m, k) => {
      const b = game.barricades[k];
      m.visible = !!b;
      if (b) {
        m.position.set(b.x, groundHeight(b.x, b.z) - 0.2, b.z);
        m.rotation.y = -b.theta;
        // Blinker når den snart forsvinner.
        m.visible = b.life > 3 || Math.floor(time * 8) % 2 === 0;
      }
    });
  }

  // Oljeflekker (blank skive som følger terrenget) og miner (flat skive med blinkende lys) på bakken.
  updateHazards(game, time) {
    const grow = (list, make, count) => {
      while (list.length < count) { const m = make(); this.scene.add(m); list.push(m); }
    };
    grow(this.oilMeshes, () => {
      // Ring med indre radius 0 og flere ringer, så skiva kan bøyes etter bakken.
      return new THREE.Mesh(new THREE.RingGeometry(0, 4.2, 28, 4).rotateX(-Math.PI / 2), this.oilMat);
    }, game.oils.length);
    this.oilMeshes.forEach((m, k) => {
      const o = game.oils[k];
      m.visible = !!o;
      if (o) drape(m, o.x, o.z, 0.11);
    });
    grow(this.mineMeshes, () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.6, 16), this.mineBodyMat);
      body.position.y = 0.3;
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), this.mineLightMat);
      light.position.y = 0.8;
      g.add(body, light);
      g.userData.light = light;
      return g;
    }, game.mines.length);
    this.mineMeshes.forEach((m, k) => {
      const b = game.mines[k];
      m.visible = !!b;
      if (b) {
        m.position.set(b.x, groundHeight(b.x, b.z), b.z);
        m.userData.light.visible = Math.floor(time * 4 + k) % 2 === 0;
      }
    });
  }

  resize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    this.size = { w: cssW, h: cssH };
  }

  updateCamera(i, truck, dt, snap) {
    const cam = this.cameras[i];
    const target = truck.speed > 4 ? Math.atan2(truck.vz, truck.vx) : truck.theta;
    const goal = snap ? truck.theta : truck.theta + angleDiff(target, truck.theta) * 0.35;
    this.camAngle[i] += angleDiff(goal, this.camAngle[i]) * (snap ? 1 : Math.min(1, 5 * dt));
    const a = this.camAngle[i];
    const fx = Math.cos(a), fz = Math.sin(a);
    const frac = Math.min(1, truck.speed / MAX_SPEED);
    const ground = groundHeight(truck.x, truck.z);
    this.camGround[i] = snap ? ground : this.camGround[i] + (ground - this.camGround[i]) * Math.min(1, 4 * dt);
    const base = this.camGround[i], up = truck.y - ground; // up: høyde over bakken (hopp)
    const cx = truck.x - fx * (CAM_BACK + frac * 2), cz = truck.z - fz * (CAM_BACK + frac * 2);
    const lx = truck.x + fx * CAM_LOOK_AHEAD, lz = truck.z + fz * CAM_LOOK_AHEAD;
    cam.position.set(cx, Math.max(base + CAM_HEIGHT + up * 0.6, groundHeight(cx, cz) + 3), cz);
    cam.lookAt(lx, base * 0.5 + groundHeight(lx, lz) * 0.5 + up * 0.4, lz);
    cam.fov = 58 + frac * 10;
  }

  updateSparks(sparks, t) {
    const tier = driftTier(t.drift);
    sparks.visible = tier > 0 && !t.air;
    if (!sparks.visible) return;
    sparks.material.color.setHex(DRIFT_COLORS[tier - 1]);
    const pos = sparks.geometry.attributes.position;
    for (let k = 0; k < SPARKS; k++) {
      const side = k % 2 ? 1 : -1;
      pos.setXYZ(k, -3 - Math.random() * 1.8, 0.2 + Math.random() * 1.1, side * 1.7 + (Math.random() - 0.5) * 1.2);
    }
    pos.needsUpdate = true;
  }

  // views: hvilke trucker som får en egen skjerm (standard: alle). En fjernspiller viser bare sin egen.
  draw(game, dt, time, views = game.trucks.map((_, i) => i)) {
    this.buildActors();
    this.buildWorld(game.track);
    if (this.coinsRef !== game.coins || this.coinMeshes.length !== game.coins.length) this.buildCoins(game.coins);
    const snap = !this.camReady;
    this.camReady = true;

    this.trucks.forEach((m, i) => { m.root.visible = i < game.trucks.length; });
    game.trucks.forEach((t, i) => {
      const m = this.trucks[i];
      m.root.position.set(t.x, t.y, t.z);
      m.root.rotation.y = -t.theta;
      const bounce = Math.sin(time * 40 + i) * 0.04 * Math.min(1, t.speed / 20) * (t.onRoad ? 0.4 : 2.5);
      m.chassis.position.y = bounce;
      // Hellingen under trucken (terreng og ramper); i lufta peker nesa etter vertikalfarten.
      let pitchGoal, rollGoal = 0;
      if (t.air) {
        pitchGoal = Math.max(-0.5, Math.min(0.5, t.vy * 0.04));
      } else {
        const slope = groundSlope(t.x, t.z, t.theta);
        const ramp = Math.max(0, (heightAt(game.track, t.s + 1, t.lat) - heightAt(game.track, t.s - 1, t.lat)) / 2);
        pitchGoal = Math.atan(slope.forward) + Math.atan(ramp);
        rollGoal = -Math.atan(slope.side);
      }
      const k = Math.min(1, 12 * dt);
      m.pitch = snap || m.pitch === undefined ? pitchGoal : m.pitch + (pitchGoal - m.pitch) * k;
      m.tilt = snap || m.tilt === undefined ? rollGoal : m.tilt + (rollGoal - m.tilt) * k;
      m.chassis.rotation.x = t.roll + m.tilt;
      m.chassis.rotation.z = m.pitch;
      m.flames.visible = t.turbo > 0;
      if (m.flames.visible) m.flames.scale.set(0.8 + Math.random() * 0.5, 1, 1);
      this.updateSparks(m.sparks, t);
      m.bubble.visible = t.shield > 0 && (t.shield > 2 || Math.floor(time * 8) % 2 === 0);
      m.bubble.material.opacity = 0.34 + Math.sin(time * 6) * 0.1;
      m.bubble.scale.setScalar(1 + Math.sin(time * 6) * 0.03);
      m.wheels.forEach((w) => { w.rotation.z = -t.wheelSpin; });
      this.updateCamera(i, t, dt, snap);
      this.fx.applyCamera(this.cameras[i], i, time);
    });
    this.fx.update(game, dt);
    game.coins.forEach((c, k) => {
      const holder = this.coinMeshes[k];
      holder.visible = !c.taken;
      holder.rotation.y = time * 3 + k;
    });

    this.updateProps(game, time);
    this.updateHazards(game, time);

    const { renderer } = this;
    const { w, h } = this.size;
    renderer.info.reset(); // statistikken dekker bare de to spillerskjermene, ikke nedtellingen
    const rects = layoutViews(views.length);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    views.forEach((ti, k) => {
      const r = rects[k];
      const x = Math.round(r.x * w) + (r.x > 0 ? 2 : 0);
      const vw = Math.round((r.x + r.w) * w) - x - (r.x + r.w < 1 ? 2 : 0);
      const vh = Math.round(r.h * h) - (r.y > 0 ? 2 : 0) - (r.y + r.h < 1 ? 2 : 0);
      const y = h - Math.round((r.y + r.h) * h) + (r.y + r.h < 1 ? 2 : 0);
      renderer.setViewport(x, y, vw, vh);
      renderer.setScissor(x, y, vw, vh);
      const cam = this.cameras[ti];
      cam.aspect = vw / vh;
      cam.updateProjectionMatrix();
      const tr = game.trucks[ti];
      this.sun.target.position.set(tr.x, tr.y, tr.z);
      this.sun.position.set(tr.x - 70, tr.y + 120, tr.z + 45);
      renderer.render(this.scene, cam);
    });
    if (this.countdown.update(game)) this.countdown.render(renderer, w, h);
  }
}

function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
