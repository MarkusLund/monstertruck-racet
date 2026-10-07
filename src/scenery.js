// Omgivelsene rundt banen: fjell og fjord, skog, steiner, røde hus ved vannet, fossefall og skyer.
// Alt lages lokalt fra terrenget (som er seedet fra banen), så ingenting av dette sendes over nettet.
// Egen tilfeldighetsstrøm (ikke Math.random), så spillets tilfeldigheter ikke påvirkes av hva som tegnes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundHeight, roadDistance, terrainLevels } from './terrain.js';

const TERRAIN_CELLS = 440; // ruter per side i bakkenettet (tett nær banen, grovere ut mot horisonten)
const INNER_FRAC = 0.74; // andel av rutene som brukes på den tette delen rundt banen
const HORIZON = 3600; // hvor langt bakkenettet strekker seg utenfor den tette delen (meter)
const CHUNKS = 8; // bakken deles i 8×8 biter, så det som er bak kameraet ikke tegnes

export const SUN_DIR = new THREE.Vector3(-95, 88, 55).normalize();
export const FOG_COLOR = 0xbcd2e2;

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => a.map((v, c) => lerp(v, b[c], t));
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sømløs verdistøy (0..1) i et kvadrat på size×size piksler, summert over flere oktaver.
function tileNoise(size, rand, octaves = [[4, 0.4], [8, 0.25], [16, 0.17], [32, 0.11], [64, 0.07]]) {
  const out = new Float32Array(size * size);
  for (const [cells, amp] of octaves) {
    const lat = Float32Array.from({ length: cells * cells }, () => rand());
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells, iy = Math.floor(fy), v = fy - iy, sv = v * v * (3 - 2 * v);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells, ix = Math.floor(fx), u = fx - ix, su = u * u * (3 - 2 * u);
        const at = (i, j) => lat[(j % cells) * cells + (i % cells)];
        const top = lerp(at(ix, iy), at(ix + 1, iy), su), bot = lerp(at(ix, iy + 1), at(ix + 1, iy + 1), su);
        out[y * size + x] += lerp(top, bot, sv) * amp;
      }
    }
  }
  return out;
}

function dataTexture(size, fill, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  fill(img.data);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Grå detaljtekstur (stein, gress og grus i ett): fargen kommer fra vertex-fargene.
function detailTexture(rand) {
  const S = 256;
  const n = tileNoise(S, rand);
  const fine = tileNoise(S, rand, [[64, 0.5], [128, 0.5]]);
  return dataTexture(S, (d) => {
    for (let i = 0; i < S * S; i++) {
      const v = 150 + (n[i] - 0.5) * 150 + (fine[i] - 0.5) * 70;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.max(0, Math.min(255, v));
      d[i * 4 + 3] = 255;
    }
  }, false); // lineære data: snittet (~0,59) kompenseres i shaderen
}

// Normalkart for småbølger på fjorden (sømløst).
function waterNormals(rand) {
  const S = 256;
  const h = tileNoise(S, rand, [[8, 0.5], [16, 0.3], [32, 0.2]]);
  return dataTexture(S, (d) => {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)]) * 6;
        const dy = (h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x]) * 6;
        const l = Math.hypot(dx, dy, 1);
        const k = (y * S + x) * 4;
        d[k] = (-dx / l * 0.5 + 0.5) * 255;
        d[k + 1] = (-dy / l * 0.5 + 0.5) * 255;
        d[k + 2] = (1 / l * 0.5 + 0.5) * 255;
        d[k + 3] = 255;
      }
    }
  }, false);
}

// Himmelen som miljøkart, så fjorden speiler himmel og sol.
const envCache = new WeakMap();
function skyEnvironment(renderer) {
  if (envCache.has(renderer)) return envCache.get(renderer);
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { sun: { value: SUN_DIR } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 sun;
      void main() {
        float y = max(vDir.y, 0.0);
        vec3 col = mix(vec3(0.78, 0.86, 0.92), vec3(0.18, 0.42, 0.78), pow(y, 0.55));
        if (vDir.y < 0.0) col = vec3(0.16, 0.24, 0.26);
        col += vec3(1.0, 0.9, 0.7) * pow(max(dot(vDir, sun), 0.0), 600.0) * 30.0;
        col += vec3(1.0, 0.85, 0.6) * pow(max(dot(vDir, sun), 0.0), 8.0) * 0.25;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0, 0.1, 1000).texture;
  pmrem.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
  envCache.set(renderer, env);
  return env;
}

// Bakkefarger (lineære RGB, ganges med den grå teksturen).
const C_GRASS = [0.075, 0.2, 0.04], C_LUSH = [0.05, 0.16, 0.03], C_MEADOW = [0.2, 0.25, 0.07], C_HEATH = [0.17, 0.14, 0.07];
const C_ROCK = [0.24, 0.235, 0.23], C_ROCK2 = [0.3, 0.27, 0.23], C_CLIFF = [0.15, 0.15, 0.16];
const C_SNOW = [0.86, 0.9, 0.98], C_SHORE = [0.27, 0.25, 0.2], C_SEABED = [0.12, 0.16, 0.12];

// Koordinater langs én akse: jevnt i midten, så stadig grovere ut mot horisonten.
function axisCoords(n, inner, outer) {
  const k = Math.min(1, (inner * (1 - INNER_FRAC)) / (INNER_FRAC * (outer - inner)));
  return Float32Array.from({ length: n + 1 }, (_, i) => {
    const u = (i / n) * 2 - 1, au = Math.abs(u);
    if (au <= INNER_FRAC) return (u / INNER_FRAC) * inner;
    const t = (au - INNER_FRAC) / (1 - INNER_FRAC);
    return Math.sign(u) * (inner + (outer - inner) * (t * k + t * t * (1 - k)));
  });
}

function terrainMesh(track, cx, cz, inner, rand) {
  const n = TERRAIN_CELLS, N1 = n + 1;
  const { water, base, top } = terrainLevels();
  const road = Math.max(base, top);
  const xs = axisCoords(n, inner, inner + HORIZON), zs = xs;
  const pos = new Float32Array(N1 * N1 * 3), col = new Float32Array(N1 * N1 * 3), uv = new Float32Array(N1 * N1 * 2);
  const hs = new Float32Array(N1 * N1);
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      const k = iz * N1 + ix;
      const x = cx + xs[ix], z = cz + zs[iz];
      const h = groundHeight(x, z);
      hs[k] = h;
      const d = roadDistance(x, z);
      const dip = 0.15 * (1 - clamp01((d - track.halfWidth - 0.5) / 3));
      pos[k * 3] = x; pos[k * 3 + 1] = h - dip; pos[k * 3 + 2] = z;
      uv[k * 2] = ix / n; uv[k * 2 + 1] = iz / n;
    }
  }
  const tint = Array.from({ length: 4 }, () => ({ a: rand() * 6.3, b: rand() * 6.3 }));
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      const k = iz * N1 + ix, h = hs[k];
      const x = pos[k * 3], z = pos[k * 3 + 2];
      const l = iz * N1 + Math.max(0, ix - 1), r = iz * N1 + Math.min(n, ix + 1);
      const u = Math.max(0, iz - 1) * N1 + ix, dn = Math.min(n, iz + 1) * N1 + ix;
      const sx = xs[Math.min(n, ix + 1)] - xs[Math.max(0, ix - 1)], sz = zs[Math.min(n, iz + 1)] - zs[Math.max(0, iz - 1)];
      const grade = Math.hypot((hs[r] - hs[l]) / sx, (hs[dn] - hs[u]) / sz);
      // Hulninger blir mørkere (skygge i skar og raviner), rygger litt lysere.
      const cav = ((hs[l] + hs[r] + hs[u] + hs[dn]) / 4 - h) / ((sx + sz) / 4);
      const wob = Math.sin(x * 0.013 + tint[0].a) * Math.cos(z * 0.011 + tint[0].b) * 9 + Math.sin(x * 0.05 + tint[1].a) * Math.sin(z * 0.047) * 3;
      const patch = 0.5 + 0.5 * Math.sin(x * 0.021 + tint[2].a) * Math.cos(z * 0.019 + tint[2].b);
      const rel = h - road;
      let c = mix(mix(C_LUSH, C_GRASS, patch), C_MEADOW, clamp01((rel + 10 + wob) / 45));
      c = mix(c, C_HEATH, clamp01((rel - 32 + wob) / 26) * 0.7);
      // Stein: over tregrensen og i alle bratte skråninger, med striper (lagdelt fjell).
      const strata = 0.82 + 0.18 * Math.sin(h * 0.42 + Math.sin(x * 0.008 + tint[3].a) * 4);
      const rock = mix(C_ROCK, C_ROCK2, patch).map((v) => v * strata);
      c = mix(c, rock, Math.max(clamp01((rel - 48 - wob) / 25), clamp01((grade - 0.85) / 0.4)));
      c = mix(c, C_CLIFF, clamp01((grade - 1.4) / 0.8) * 0.8);
      // Snø på flatere partier høyt oppe; går lenger ned i skyggefulle hulninger.
      const snowLine = road + 85 + wob * 1.5 - cav * 40;
      c = mix(c, C_SNOW, clamp01((h - snowLine) / 12) * clamp01((1.5 - grade) / 0.6));
      c = mix(c, C_SHORE, clamp01(1 - (h - water) / 2.5) * clamp01((1.2 - grade) / 0.6));
      if (h < water) c = mix(C_SHORE, C_SEABED, clamp01((water - h) / 6));
      const shade = Math.max(0.72, Math.min(1.15, 1 + cav * 0.9));
      col[k * 3] = c[0] * shade; col[k * 3 + 1] = c[1] * shade; col[k * 3 + 2] = c[2] * shade;
    }
  }
  const index = new Uint32Array(n * n * 6);
  let q = 0;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const a = iz * N1 + ix, b = a + 1, c = a + N1, d = c + 1;
      index.set([a, c, b, b, c, d], q);
      q += 6;
    }
  }
  // Normalene regnes på hele nettet (ingen sømmer), så deles det i biter som kan siles bort når de er utenfor synsfeltet.
  const full = new THREE.BufferGeometry();
  full.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  full.setIndex(new THREE.BufferAttribute(index, 1));
  full.computeVertexNormals();
  const nrm = full.attributes.normal.array;
  full.dispose();

  // Detaljteksturen legges på i verdenskoordinater fra tre kanter (triplanar), så stupene ikke blir utstrakte striper.
  const mat = new THREE.MeshStandardMaterial({ map: detailTexture(rand), roughness: 0.95, metalness: 0, vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace('#include <map_fragment>', `
        vec3 bw = pow(abs(normalize(vWNorm)), vec3(4.0));
        bw /= bw.x + bw.y + bw.z;
        vec3 d1 = texture2D(map, vWPos.zy * 0.08).rgb * bw.x + texture2D(map, vWPos.xz * 0.08).rgb * bw.y + texture2D(map, vWPos.xy * 0.08).rgb * bw.z;
        float d2 = texture2D(map, vWPos.xz * 0.0075 + 0.37).r;
        diffuseColor.rgb *= d1 * 1.7 * (0.8 + 0.35 * (d2 * 1.7 - 1.0));
      `);
  };
  const group = new THREE.Group();
  const parts = CHUNKS, per = n / parts;
  for (let cz0 = 0; cz0 < parts; cz0++) {
    for (let cx0 = 0; cx0 < parts; cx0++) {
      const ix0 = Math.round(cx0 * per), ix1 = Math.round((cx0 + 1) * per);
      const iz0 = Math.round(cz0 * per), iz1 = Math.round((cz0 + 1) * per);
      const w = ix1 - ix0 + 1, hgt = iz1 - iz0 + 1;
      const P = new Float32Array(w * hgt * 3), C = new Float32Array(w * hgt * 3), Nm = new Float32Array(w * hgt * 3), U = new Float32Array(w * hgt * 2);
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const src = iz * N1 + ix, dst = (iz - iz0) * w + (ix - ix0);
          for (let k = 0; k < 3; k++) { P[dst * 3 + k] = pos[src * 3 + k]; C[dst * 3 + k] = col[src * 3 + k]; Nm[dst * 3 + k] = nrm[src * 3 + k]; }
          U[dst * 2] = uv[src * 2]; U[dst * 2 + 1] = uv[src * 2 + 1];
        }
      }
      const I = new Uint32Array((w - 1) * (hgt - 1) * 6);
      let j = 0;
      for (let z = 0; z < hgt - 1; z++) {
        for (let x = 0; x < w - 1; x++) {
          const a = z * w + x, b = a + 1, c = a + w, d = c + 1;
          I[j++] = a; I[j++] = c; I[j++] = b; I[j++] = b; I[j++] = c; I[j++] = d;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(Nm, 3));
      g.setAttribute('color', new THREE.BufferAttribute(C, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      g.setIndex(new THREE.BufferAttribute(I, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}

const CELL_SIZE = 260; // rutestørrelse for trær og steiner
const DETAIL_RANGE = 820; // trær og steiner lenger unna kameraet enn dette tegnes ikke (de er bare noen få piksler)

let detailCells = []; // rutene som skjules når de er langt unna kameraet

function instancedCells(items, geo, mat, place, color, out, { shadow = true } = {}) {
  const cells = new Map();
  for (const t of items) {
    const key = `${Math.floor(t.x / CELL_SIZE)},${Math.floor(t.z / CELL_SIZE)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(t);
  }
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  for (const list of cells.values()) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => {
      place(t, m4);
      im.setMatrixAt(i, m4);
      if (color) im.setColorAt(i, color(t, col));
    });
    im.computeBoundingSphere();
    detailCells.push(im);
    im.castShadow = shadow;
    im.receiveShadow = true;
    out.add(im);
  }
}

// Granskog og bjørk i liene. Trær nær veien kaster skygge; de langt unna gjør det ikke (sparer tegning av skyggekartet).
function forest(track, cx, cz, inner, rand, levels, out) {
  const road = Math.max(levels.base, levels.top);
  const tierCones = [[3.2, 4.2, 2.6], [2.5, 3.6, 4.6], [1.7, 3.2, 6.5], [0.9, 2.4, 8.2]].map(([r, h, y]) => {
    const c = new THREE.ConeGeometry(r, h, 7);
    c.translate(0, y, 0);
    return c;
  });
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 3, 6);
  trunkGeo.translate(0, 1.5, 0);
  // Stamme og bar i én geometri (én tegning per rute): stammen får mørk vertex-farge.
  const paint = (g, r, gg, b) => {
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) { c[i] = r; c[i + 1] = gg; c[i + 2] = b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  const spruceGeo = mergeGeometries([...tierCones.map((c) => paint(c, 1, 1, 1)), paint(trunkGeo, 1.6, 0.7, 0.55)]);
  const birchCrown = new THREE.IcosahedronGeometry(2.6, 1);
  birchCrown.scale(1, 1.35, 1);
  birchCrown.translate(0, 6.2, 0);
  const birchTrunk = new THREE.CylinderGeometry(0.22, 0.32, 5.2, 6);
  birchTrunk.translate(0, 2.6, 0);
  const needles = canvasTex(128, (g, s) => {
    g.fillStyle = '#d8e8d0';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = rand() < 0.55 ? 'rgba(20,40,20,.35)' : 'rgba(255,255,255,.3)';
      g.fillRect(rand() * s, rand() * s, 2, 4 + rand() * 4);
    }
  });
  needles.wrapS = needles.wrapT = THREE.RepeatWrapping;

  const trees = [];
  const mask = Array.from({ length: 3 }, () => ({ fx: 0.004 + rand() * 0.01, fz: 0.004 + rand() * 0.01, p: rand() * 6.3 }));
  const span = inner * 0.95;
  for (let tries = 0; tries < 26000 && trees.length < 3200; tries++) {
    const x = cx + (rand() * 2 - 1) * span, z = cz + (rand() * 2 - 1) * span;
    const d = roadDistance(x, z);
    if (d < track.wallLat + 5) continue;
    // Skogholt: tett noen steder, glissent andre.
    let m = 0;
    for (const w of mask) m += Math.sin(x * w.fx + w.p) * Math.cos(z * w.fz - w.p);
    if (m / 3 + 0.4 < rand() * 0.9) continue;
    const h = groundHeight(x, z);
    if (h < levels.water + 1.2 || h > road + 48 + (rand() - 0.5) * 16) continue;
    const g = Math.hypot(groundHeight(x + 2, z) - groundHeight(x - 2, z), groundHeight(x, z + 2) - groundHeight(x, z - 2)) / 4;
    if (g > 1.05) continue;
    const t = { x, y: h - 0.4, z, s: 0.75 + rand() * 0.8, rot: rand() * 6.3, birch: h < road + 6 && rand() < 0.22, shade: rand() };
    trees.push(t);
  }
  const spruceMat = new THREE.MeshStandardMaterial({ map: needles, roughness: 0.9, vertexColors: true });
  const birchBark = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.8 });
  const birchLeaf = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const place = (t, m4) => {
    q.setFromAxisAngle(up, t.rot);
    m4.compose(v.set(t.x, t.y, t.z), q, sc.set(t.s, t.s * (0.9 + t.shade * 0.3), t.s));
  };
  const spruce = trees.filter((t) => !t.birch), birch = trees.filter((t) => t.birch);
  instancedCells(spruce, spruceGeo, spruceMat, place, (t, c) => c.setRGB(0.07 + t.shade * 0.05, 0.2 + t.shade * 0.1, 0.09 + t.shade * 0.04), out);
  instancedCells(birch, birchCrown, birchLeaf, place, (t, c) => c.setRGB(0.25 + t.shade * 0.25, 0.45 + t.shade * 0.15, 0.08), out);
  instancedCells(birch, birchTrunk, birchBark, place, null, out);
}

// Steinblokker og ur i gresset langs veien.
function rocks(track, cx, cz, inner, rand, levels, out) {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  const items = [];
  for (let tries = 0; tries < 8000 && items.length < 420; tries++) {
    const x = cx + (rand() * 2 - 1) * inner * 0.9, z = cz + (rand() * 2 - 1) * inner * 0.9;
    const d = roadDistance(x, z);
    if (d < track.wallLat + 2.5 || (d > track.wallLat + 70 && rand() < 0.8)) continue;
    const h = groundHeight(x, z);
    if (h < levels.water - 0.5) continue;
    if (Math.hypot(groundHeight(x + 2, z) - groundHeight(x - 2, z), groundHeight(x, z + 2) - groundHeight(x, z - 2)) / 4 > 0.7) continue;
    items.push({ x, y: h, z, s: (0.5 + rand() ** 3 * 3.5) * (d < track.wallLat + 18 ? 0.45 : 1), r: [rand(), rand(), rand()], c: rand() });
  }
  const e = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  instancedCells(items, geo, mat, (t, m4) => {
    e.set(t.r[0] * 6, t.r[1] * 6, t.r[2] * 6);
    q.setFromEuler(e);
    m4.compose(v.set(t.x, t.y + t.s * 0.25, t.z), q, sc.set(t.s * (1 + t.r[0] * 0.6), t.s * (0.6 + t.r[1] * 0.5), t.s * (1 + t.r[2] * 0.5)));
  }, (t, c) => c.setRGB(0.17 + t.c * 0.1, 0.165 + t.c * 0.09, 0.16 + t.c * 0.08), out);
}

// Små grender med røde, hvite og okergule trehus (noen med torvtak) nede ved fjorden, og en og annen båt.
function villages(track, cx, cz, inner, rand, levels, out) {
  const W = levels.water;
  const slope = (x, z) => Math.hypot(groundHeight(x + 3, z) - groundHeight(x - 3, z), groundHeight(x, z + 3) - groundHeight(x, z - 3)) / 6;
  const shoreDir = (x, z) => {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      for (const r of [14, 26, 40]) if (groundHeight(x + Math.cos(a) * r, z + Math.sin(a) * r) < W) return a;
    }
    return null;
  };
  const houses = [], boats = [];
  const centers = [];
  for (let tries = 0; tries < 6000 && centers.length < 9; tries++) {
    const x = cx + (rand() * 2 - 1) * inner * 0.9, z = cz + (rand() * 2 - 1) * inner * 0.9;
    const h = groundHeight(x, z);
    if (h < W + 1.5 || h > W + 9 || slope(x, z) > 0.3 || roadDistance(x, z) < track.wallLat + 10) continue;
    const dir = shoreDir(x, z);
    if (dir === null || centers.some((c) => Math.hypot(c.x - x, c.z - z) < 160)) continue;
    centers.push({ x, z, dir });
  }
  for (const c of centers) {
    const want = 3 + Math.floor(rand() * 5);
    for (let tries = 0; tries < 60 && want > 0; tries++) {
      const x = c.x + (rand() - 0.5) * 70, z = c.z + (rand() - 0.5) * 70;
      const h = groundHeight(x, z);
      if (h < W + 1.2 || slope(x, z) > 0.38 || roadDistance(x, z) < track.wallLat + 6) continue;
      if (houses.some((o) => Math.hypot(o.x - x, o.z - z) < 11)) continue;
      const dir = shoreDir(x, z) ?? c.dir;
      const kind = rand();
      houses.push({ x, z, y: h, rot: -dir + (rand() - 0.5) * 0.3, s: 0.8 + rand() * 0.5,
        wall: kind < 0.62 ? [0.42, 0.04, 0.03] : kind < 0.85 ? [0.85, 0.85, 0.82] : [0.75, 0.48, 0.12], turf: rand() < 0.35 });
      if (houses.filter((o) => Math.hypot(o.x - c.x, o.z - c.z) < 80).length >= want) break;
    }
    // Båter like utenfor land.
    for (let b = 0; b < 1 + Math.floor(rand() * 3); b++) {
      const a = c.dir + (rand() - 0.5) * 0.8, r = 40 + rand() * 50;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      if (groundHeight(x, z) < W - 1.5) boats.push({ x, z, rot: rand() * 6.3, red: rand() < 0.4 });
    }
  }
  if (houses.length) {
    const wallGeo = new THREE.BoxGeometry(8, 7, 5.4);
    wallGeo.translate(0, 1.5, 0); // går 2 m ned i bakken, så husene står støtt i skråninger
    const tri = new THREE.Shape();
    tri.moveTo(-3.3, 0); tri.lineTo(3.3, 0); tri.lineTo(0, 2.6); tri.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(tri, { depth: 8.8, bevelEnabled: false });
    roofGeo.translate(0, 5, -4.4);
    roofGeo.rotateY(Math.PI / 2);
    const windows = canvasTex(128, (g, s) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, s, s);
      g.fillStyle = '#20262c';
      for (const x of [0.15, 0.62]) g.fillRect(s * x, s * 0.5, s * 0.22, s * 0.2);
      g.fillStyle = '#5a3a26';
      g.fillRect(s * 0.42, s * 0.62, s * 0.14, s * 0.38);
    });
    const walls = new THREE.InstancedMesh(wallGeo, new THREE.MeshStandardMaterial({ map: windows, roughness: 0.8 }), houses.length);
    const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), houses.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    houses.forEach((h, i) => {
      q.setFromAxisAngle(up, h.rot);
      m4.compose(new THREE.Vector3(h.x, h.y - 0.2, h.z), q, new THREE.Vector3(h.s, h.s, h.s));
      walls.setMatrixAt(i, m4);
      roofs.setMatrixAt(i, m4);
      walls.setColorAt(i, col.setRGB(...h.wall));
      roofs.setColorAt(i, h.turf ? col.setRGB(0.12, 0.22, 0.05) : col.setRGB(0.06, 0.06, 0.07));
    });
    for (const m of [walls, roofs]) { m.castShadow = true; m.receiveShadow = true; out.add(m); }
  }
  if (boats.length) {
    const hull = new THREE.BoxGeometry(6, 1.2, 2.2);
    hull.translate(0, 0.3, 0);
    const cabin = new THREE.BoxGeometry(1.8, 1.2, 1.6);
    cabin.translate(-0.6, 1.4, 0);
    const geo = mergeGeometries([hull, cabin]);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), boats.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    boats.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rot);
      m4.compose(new THREE.Vector3(b.x, W, b.z), q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, b.red ? col.setRGB(0.5, 0.06, 0.04) : col.setRGB(0.9, 0.9, 0.88));
    });
    out.add(im);
  }
}

// Fossefall: følger bratteste vei ned fra en fjellhylle og ned i fjorden.
function waterfalls(track, cx, cz, inner, rand, levels) {
  const W = levels.water, road = Math.max(levels.base, levels.top);
  const streaks = canvasTex(128, (g, s) => {
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      const x = rand() * s, w = 2 + rand() * 6;
      const grad = g.createLinearGradient(0, 0, 0, s);
      const a = 0.35 + rand() * 0.5;
      grad.addColorStop(0, `rgba(255,255,255,${a})`);
      grad.addColorStop(0.5, `rgba(220,235,245,${a * 0.5})`);
      grad.addColorStop(1, `rgba(255,255,255,${a})`);
      g.fillStyle = grad;
      g.fillRect(x, 0, w, s);
    }
  });
  streaks.wrapS = streaks.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshBasicMaterial({ map: streaks, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0xf4fbff });
  const group = new THREE.Group();
  let found = 0;
  for (let tries = 0; tries < 900 && found < 6; tries++) {
    let x = cx + (rand() * 2 - 1) * inner * 0.85, z = cz + (rand() * 2 - 1) * inner * 0.85;
    const h0 = groundHeight(x, z);
    if (h0 < road + 35) continue;
    const path = [[x, z]];
    let ok = false;
    for (let step = 0; step < 70; step++) {
      const gx = groundHeight(x + 1.5, z) - groundHeight(x - 1.5, z), gz = groundHeight(x, z + 1.5) - groundHeight(x, z - 1.5);
      const l = Math.hypot(gx, gz);
      if (l < 1e-3) break;
      x -= (gx / l) * 3; z -= (gz / l) * 3;
      if (roadDistance(x, z) < track.wallLat + 6) break;
      path.push([x, z]);
      if (groundHeight(x, z) < W) { ok = true; break; }
    }
    if (!ok || h0 - W < 45 || path.length > 60) continue;
    const pos = [], uv = [], index = [];
    let len = 0;
    path.forEach(([px, pz], i) => {
      const [nx, nz] = path[Math.min(path.length - 1, i + 1)], [bx, bz] = path[Math.max(0, i - 1)];
      const dx = nx - bx, dz = nz - bz, l = Math.hypot(dx, dz) || 1;
      const w = 1.3 + (i / path.length) * 1.8; // smal øverst, bredere der den treffer fjorden
      if (i) len += Math.hypot(px - path[i - 1][0], pz - path[i - 1][1], groundHeight(px, pz) - groundHeight(...path[i - 1]));
      for (const side of [-1, 1]) {
        const vx = px + (-dz / l) * w * side, vz = pz + (dx / l) * w * side;
        pos.push(vx, groundHeight(vx, vz) + 0.6, vz);
        uv.push(side < 0 ? 0 : 1, len / 14);
      }
      if (i) { const a = (i - 1) * 2; index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    group.add(new THREE.Mesh(g, mat));
    // Sprut nederst.
    const [ex, ez] = path[path.length - 1];
    const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: softBlob(), color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    mist.position.set(ex, W + 3, ez);
    mist.scale.set(16, 10, 1);
    group.add(mist);
    found++;
  }
  return { group, texture: streaks };
}

let blob = null;
function softBlob() {
  if (blob) return blob;
  blob = canvasTex(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  return blob;
}

// Skyer: myke dotter høyt over fjellene.
function clouds(cx, cz, inner, rand, levels, out) {
  const tex = canvasTex(256, (g, s) => {
    for (let i = 0; i < 26; i++) {
      const x = s * (0.2 + rand() * 0.6), y = s * (0.4 + rand() * 0.25), r = s * (0.08 + rand() * 0.14);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,.85)');
      grad.addColorStop(0.6, 'rgba(250,252,255,.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    }
  });
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
  for (let i = 0; i < 34; i++) {
    const a = rand() * Math.PI * 2, r = inner * 0.6 + rand() * (HORIZON * 0.9);
    const sp = new THREE.Sprite(mat);
    const w = 380 + rand() * 520;
    sp.scale.set(w, w * 0.45, 1);
    sp.position.set(cx + Math.cos(a) * r, levels.base + 330 + rand() * 300, cz + Math.sin(a) * r);
    out.add(sp);
  }
}

// Bygger alle omgivelsene. Returnerer en gruppe som legges i scenen og en update(dt) for animasjon (vann og fosser).
export function buildScenery(track, renderer) {
  const group = new THREE.Group();
  detailCells = [];
  const levels = terrainLevels();
  const rand = mulberry((Math.floor(track.length * 7919) ^ Math.floor(track.pts[3].x * 1000)) >>> 0);
  const xs = track.pts.map((p) => p.x), zs = track.pts.map((p) => p.z);
  const bb = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  const cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;
  const inner = Math.max(bb.x1 - bb.x0, bb.z1 - bb.z0) / 2 + 380;

  group.add(terrainMesh(track, cx, cz, inner, rand));

  // Fjorden: blank flate som speiler himmelen, med småkrusninger som driver sakte.
  const normals = waterNormals(rand);
  const size = (inner + HORIZON) * 2.2;
  normals.repeat.set(size / 60, size / 60);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({
    color: 0x0a3446, roughness: 0.1, metalness: 0.05, envMap: skyEnvironment(renderer), envMapIntensity: 0.65,
    normalMap: normals, normalScale: new THREE.Vector2(0.2, 0.2),
  }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, levels.water, cz);
  water.receiveShadow = true;
  group.add(water);

  forest(track, cx, cz, inner, rand, levels, group);
  rocks(track, cx, cz, inner, rand, levels, group);
  villages(track, cx, cz, inner, rand, levels, group);
  const falls = waterfalls(track, cx, cz, inner, rand, levels);
  group.add(falls.group);
  clouds(cx, cz, inner, rand, levels, group);

  // Sola som en myk glorie langt ute i solretningen.
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: softBlob(), color: 0xfff1cf, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  sun.position.set(cx + SUN_DIR.x * 5000, levels.base + SUN_DIR.y * 5000, cz + SUN_DIR.z * 5000);
  sun.scale.set(900, 900, 1);
  group.add(sun);

  let t = 0;
  const update = (dt) => {
    t += dt;
    normals.offset.set(t * 0.004, t * 0.0025);
    falls.texture.offset.y = -t * 0.9; // vannet renner nedover
  };
  const cells = detailCells;
  // Kalles før hver spillerskjerm tegnes: skjul ruter med trær og steiner som er langt unna dette kameraet.
  const view = (camPos) => {
    for (const im of cells) {
      const sph = im.boundingSphere;
      im.visible = sph.center.distanceTo(camPos) - sph.radius < DETAIL_RANGE;
    }
  };
  return { group, update, view, far: inner + HORIZON };
}
