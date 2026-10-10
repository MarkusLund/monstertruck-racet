// Tegning av veiutstyret: autovern og skigard der fences.js har satt opp gjerder, og kantstolper langs hele veien.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WALL_MARGIN, SPACING } from './track.js';
import { groundHeight } from './terrain.js';
import { FENCE_BAND, GUARDRAIL, SKIGARD } from './fences.js';

const LAT = (p) => p.hw + WALL_MARGIN + FENCE_BAND / 2; // gjerdet står midt i kollisjonsbåndet (følger veibredden)
const BEAM = [[0.8, 0], [0.71, 0.08], [0.63, 0], [0.55, 0.08], [0.46, 0]]; // W-profilen på autovernet: [høyde, utbuling mot veien]
const END = 3; // autovernet bøyes ned i bakken over så mange punkter i hver ende
const RAIL_TILT = 0.68; // skigardsstengene ligger skrått (radianer fra bakken)
const POST_EVERY = 12; // kantstolper hvert 12. banepunkt (24 m)

export function buildFences(track) {
  const group = new THREE.Group();
  const { pts, count } = track;
  const runs = track.fences?.runs ?? [];
  const at = (i, side, lat) => {
    const p = pts[(i + count) % count], sg = side ? 1 : -1;
    if (typeof lat === 'function') lat = lat(p);
    const x = p.x + p.nx * sg * lat, z = p.z + p.nz * sg * lat;
    return { p, sg, x, z, y: groundHeight(x, z) };
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), col = new THREE.Color();
  const yaw = (p) => q.setFromAxisAngle(up, -Math.atan2(p.tz, p.tx));

  // Autovern: ett bånd med W-profil per strekk, nedbøyd i endene, på galvaniserte stolper hver 4. meter.
  const beamPos = [], beamIdx = [], posts = [];
  for (const run of runs.filter((r) => r.kind === GUARDRAIL)) {
    const first = beamPos.length / 3;
    for (let k = 0; k < run.len; k++) {
      const e = Math.min(k, run.len - 1 - k);
      const sink = e < END ? ((END - e) / END) * 0.8 : 0;
      const { p, sg, x, z, y } = at(run.i0 + k, run.side, LAT);
      for (const [h, bulge] of BEAM) beamPos.push(x - p.nx * sg * bulge, y + h - sink, z - p.nz * sg * bulge);
      if (k % 2 === 0 && sink < 0.3) posts.push({ x: x + p.nx * sg * 0.12, y, z: z + p.nz * sg * 0.12, p });
    }
    const R = BEAM.length;
    for (let k = 0; k < run.len - 1; k++) {
      for (let r = 0; r < R - 1; r++) {
        const a = first + k * R + r, b = a + R;
        beamIdx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  if (beamIdx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(beamPos, 3));
    g.setIndex(beamIdx);
    g.computeVertexNormals();
    const beam = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xd3d9dd, metalness: 0.35, roughness: 0.42, side: THREE.DoubleSide }));
    beam.castShadow = true;
    beam.receiveShadow = true;
    group.add(beam);
    const postGeo = new THREE.BoxGeometry(0.1, 0.9, 0.16);
    postGeo.translate(0, 0.45, 0);
    const im = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0xa3abb0, metalness: 0.3, roughness: 0.55 }), posts.length);
    posts.forEach((o, i) => im.setMatrixAt(i, m4.compose(v.set(o.x, o.y, o.z), yaw(o.p), sc.set(1, 1, 1))));
    im.computeBoundingSphere();
    group.add(im);
  }

  // Skigard: par av staur hver 2. meter med skrå, gråværede stenger imellom.
  const stakes = [], rails = [];
  for (const run of runs.filter((r) => r.kind === SKIGARD)) {
    for (let k = 0; k < run.len; k++) {
      const o = at(run.i0 + k, run.side, LAT);
      for (const d of [-0.11, 0.11]) stakes.push({ x: o.x + o.p.nx * d, y: o.y, z: o.z + o.p.nz * d, p: o.p, k: k + d });
      if (k < run.len - 1) for (const f of [0, 0.34, 0.67]) rails.push({ ...o, f, k });
    }
  }
  if (stakes.length) {
    const wood = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const stakeGeo = new THREE.BoxGeometry(0.09, 1.5, 0.09);
    stakeGeo.translate(0, 0.62, 0);
    const si = new THREE.InstancedMesh(stakeGeo, wood, stakes.length);
    stakes.forEach((o, i) => {
      si.setMatrixAt(i, m4.compose(v.set(o.x, o.y, o.z), yaw(o.p), sc.set(1, 0.9 + Math.abs(Math.sin(o.k * 12.9)) * 0.2, 1)));
      si.setColorAt(i, col.setRGB(0.36, 0.32, 0.27).multiplyScalar(0.85 + Math.abs(Math.sin(o.k * 7.3)) * 0.3));
    });
    si.computeBoundingSphere();
    group.add(si);
    const railGeo = new THREE.BoxGeometry(0.1, 2.6, 0.1);
    const ri = new THREE.InstancedMesh(railGeo, wood, rails.length);
    rails.forEach((o, i) => {
      dir.set(o.p.tx * Math.cos(RAIL_TILT), Math.sin(RAIL_TILT), o.p.tz * Math.cos(RAIL_TILT));
      q.setFromUnitVectors(up, dir);
      const s = 0.4 + o.f * 2; // stengene ligger i lag langs strekket
      ri.setMatrixAt(i, m4.compose(v.set(o.x + o.p.tx * s, o.y + 0.62, o.z + o.p.tz * s), q, sc.set(1, 1, 1)));
      ri.setColorAt(i, col.setRGB(0.47, 0.43, 0.37).multiplyScalar(0.8 + Math.abs(Math.sin((o.k + o.f) * 5.1)) * 0.35));
    });
    ri.computeBoundingSphere();
    ri.castShadow = true;
    group.add(ri);
  }

  // Kantstolper: hvite stolper med svart topp og refleks mot veien, på begge sider av hele veien.
  const paint = (g, hex) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(a, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const body = paint(new THREE.BoxGeometry(0.13, 0.78, 0.13).translate(0, 0.39, 0), 0xf2f2ee);
  const top = paint(new THREE.BoxGeometry(0.135, 0.26, 0.135).translate(0, 0.91, 0), 0x16161a);
  const refl = paint(new THREE.BoxGeometry(0.07, 0.11, 0.02).translate(0, 0.92, 0.075), 0xffd23a);
  const postGeo = mergeGeometries([body, top, refl]);
  const spots = [];
  for (let i = 6; i < count - 6; i += POST_EVERY) {
    if (pts[i].deck > 0.3) continue; // på broen står rekkverket
    for (const side of [0, 1]) spots.push({ ...at(i, side, (p) => p.hw + 2.2), side });
  }
  const ki = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), spots.length);
  spots.forEach((o, i) => {
    // Refleksen (lokal +z) skal peke inn mot veien.
    q.setFromAxisAngle(up, Math.atan2(-o.p.nx * o.sg, -o.p.nz * o.sg));
    ki.setMatrixAt(i, m4.compose(v.set(o.x, o.y, o.z), q, sc.set(1, 1, 1)));
  });
  ki.computeBoundingSphere();
  group.add(ki);
  group.add(buildBridge(track));
  return group;
}

// Et lukket tverrsnitt (liste av p => [sideforskyvning, høyde over dekket]) dratt langs banepunktene i0..i1.
function sweep(track, i0, i1, loop, material) {
  const { pts, count } = track;
  const R = loop.length, pos = [], index = [];
  for (let i = i0; i <= i1; i++) {
    const p = pts[i % count];
    for (const f of loop) {
      const [lat, h] = f(p);
      const x = p.x + p.nx * lat, z = p.z + p.nz * lat;
      pos.push(x, groundHeight(x, z) + p.deck + h, z);
    }
  }
  for (let k = 0; k < i1 - i0; k++) {
    for (let r = 0; r < R; r++) {
      const a = k * R + r, b = k * R + ((r + 1) % R);
      index.push(a, a + R, b, b, a + R, b + R);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Broen: brodekke (betongbjelke under veien), rekkverk på begge sider og pilarer i oppkjørslene.
// Ved kryssingen står det ingen pilarer, så veien under er helt åpen.
function buildBridge(track) {
  const group = new THREE.Group();
  if (!track.bridge) return group;
  const { pts, count, bridge } = track;
  const i0 = Math.ceil(bridge.s0 / SPACING), i1 = Math.floor(bridge.s1 / SPACING);
  let a = i0, b = i1;
  while (a < b && pts[a % count].deck < 0.15) a++;
  while (b > a && pts[b % count].deck < 0.15) b--;
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const W = 1.5, T = 1.1; // dekket stikker W utenfor asfalten og er T tykt
  group.add(sweep(track, a, b, [(p) => [-p.hw - W, 0], (p) => [p.hw + W, 0], (p) => [p.hw + W, -T], (p) => [-p.hw - W, -T]], concrete));
  for (const sd of [-1, 1]) {
    group.add(sweep(track, a, b, [(p) => [sd * (p.hw + 1), 0], (p) => [sd * (p.hw + 1), 1], (p) => [sd * (p.hw + W), 1], (p) => [sd * (p.hw + W), 0]], concrete));
  }
  // Pilarer hver 16. meter langs oppkjørslene.
  const spots = [];
  for (let i = a; i <= b; i += 8) {
    const p = pts[i % count];
    if (p.deck < 1.5 || cyc(i, bridge.index, count) < 24) continue;
    for (const sd of [-1, 1]) {
      const lat = sd * (p.hw - 1.2), x = p.x + p.nx * lat, z = p.z + p.nz * lat;
      spots.push({ p, x, z, y: groundHeight(x, z), h: p.deck - T + 0.1 });
    }
  }
  if (spots.length) {
    const geo = new THREE.BoxGeometry(1.4, 1, 1.4);
    geo.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(geo, concrete, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    spots.forEach((o, k) => im.setMatrixAt(k, m4.compose(v.set(o.x, o.y - 0.3, o.z), q.setFromAxisAngle(up, -Math.atan2(o.p.tz, o.p.tx)), sc.set(1, o.h + 0.3, 1))));
    im.castShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
}

const cyc = (a, b, n) => { const d = Math.abs(a - b); return Math.min(d, n - d); };
