import * as THREE from 'three';

// Nedtelling med store, utextruderte 3D-tall midt på skjermen (syv-segment-former med fasing).
const W = 1.1;
const H = 2;
const T = 0.3;
const VH = (H - 3 * T) / 2;
const SEGMENTS = {
  a: [0, H - T, W, T],
  d: [0, 0, W, T],
  g: [0, (H - T) / 2, W, T],
  f: [0, (H + T) / 2, T, VH],
  b: [W - T, (H + T) / 2, T, VH],
  e: [0, T, T, VH],
  c: [W - T, T, T, VH],
  h: [W / 2, (H - T) / 2, W / 2, T], // halv midtstrek (G)
};
const GLYPHS = {
  3: 'abcdg',
  2: 'abdeg',
  1: 'bc',
  G: 'acdefh',
  O: 'abcdef',
};
const COLORS = { 3: 0xff3b30, 2: 0xffb400, 1: 0xffe600, G: 0x3ddc4a, O: 0x3ddc4a };

function glyphGeometry(ch) {
  const shapes = [...GLYPHS[ch]].map((k) => {
    const [x, y, w, h] = SEGMENTS[k];
    return new THREE.Shape().moveTo(x, y).lineTo(x + w, y).lineTo(x + w, y + h).lineTo(x, y + h).closePath();
  });
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: 0.5, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.1, bevelSegments: 3 });
  geo.translate(-W / 2, -H / 2, -0.25);
  return geo;
}

export class Countdown3D {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
    this.camera.position.set(0, 0, 11);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(-3, 5, 8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88ccff, 1.5);
    rim.position.set(4, -2, -3);
    this.scene.add(rim);

    this.items = {};
    const make = (name, chars) => {
      const g = new THREE.Group();
      chars.forEach((ch, i) => {
        const m = new THREE.Mesh(
          glyphGeometry(ch),
          new THREE.MeshStandardMaterial({ color: COLORS[ch], metalness: 0.35, roughness: 0.3, emissive: COLORS[ch], emissiveIntensity: 0.25, transparent: true }),
        );
        m.position.x = (i - (chars.length - 1) / 2) * (W + 0.6);
        g.add(m);
      });
      g.visible = false;
      this.scene.add(g);
      this.items[name] = g;
    };
    make('3', ['3']);
    make('2', ['2']);
    make('1', ['1']);
    make('go', ['G', 'O']);
  }

  // Returnerer true hvis noe tegnes. `local` går fra 0 til 1 mens tallet vises.
  update(game) {
    let name = null;
    let local = 0;
    if (game.state === 'countdown') {
      const n = Math.max(1, Math.ceil(game.countdown));
      name = String(n);
      local = Math.min(1, n - game.countdown);
    } else if (game.state === 'racing' && game.time < 1) {
      name = 'go';
      local = game.time;
    }
    for (const [k, g] of Object.entries(this.items)) g.visible = k === name;
    if (!name) return false;
    const g = this.items[name];
    const ease = 1 - (1 - Math.min(1, local * 3)) ** 3; // rask innkjøring
    const out = Math.max(0, (local - 0.75) / 0.25); // utfasing mot slutten
    const s = (0.4 + 0.6 * ease) * (1 + out * 0.5) * (name === 'go' ? 1.1 : 1.35);
    g.scale.setScalar(s);
    g.rotation.y = (1 - ease) * Math.PI * 2 + Math.sin(local * 5) * 0.18;
    g.rotation.x = -0.12 + Math.sin(local * 4) * 0.05;
    g.position.y = 0.3;
    g.children.forEach((m) => { m.material.opacity = 1 - out; });
    return true;
  }

  render(renderer, w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }
}
