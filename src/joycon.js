// Joy-Con 2 / Switch 2-kontrollere via UDP-broen i dev-serveren (server/joycon.js), som erstatning
// for Gamepad API-et når switch2mac ikke kan lage virtuelle gamepader. Hver kontroller blir gjort om
// til et Gamepad-lignende objekt med standard knappeindekser, så Input bruker dem som alle andre.

// Knappebiter i UDP-pakken fra switch2mac (Switch2Protocol.swift).
const B = {
  y: 0x1, x: 0x2, b: 0x4, a: 0x8, srR: 0x10, slR: 0x20, r: 0x40, zr: 0x80, minus: 0x100, plus: 0x200,
  dpadDown: 0x10000, dpadUp: 0x20000, dpadRight: 0x40000, dpadLeft: 0x80000,
  srL: 0x100000, slL: 0x200000, l: 0x400000, zl: 0x800000,
};
const SHOULDER = B.l | B.zl | B.r | B.zr;

// Standard Gamepad-indekser som input.js leser.
const BTN_SQUARE = 2, BTN_L2 = 6, BTN_R2 = 7, BTN_OPTIONS = 9, BTN_COUNT = 17;

// Enkelt Joy-Con holdt sidelengs: stikken styrer. SR eller knappen til høyre gir gass, SL eller
// knappen nedenfor gir brems/rygg, knappene oppe og til venstre (eller L/ZL/R/ZR) hopper. Venstre
// Joy-Con er rotert 90° mot klokka (stikkens «opp» peker mot venstre) og høyre med klokka, så de
// fysiske knappene svarer til ulike biter. ?jcflip=1 snur alt 180° (andre veien rundt).
const FACE_DIRS = {
  L: { right: B.dpadDown, down: B.dpadLeft, up: B.dpadRight, left: B.dpadUp },
  R: { right: B.x, down: B.a, up: B.y, left: B.b },
};
const SINGLE = /\(([LR])\)\s*$/;
const flipped = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('jcflip');

const press = (v) => ({ pressed: v, touched: v, value: v ? 1 : 0 });

export function toPad(slot, st, name = '') {
  const side = (SINGLE.exec(name) || [])[1];
  const buttons = Array.from({ length: BTN_COUNT }, () => press(false));
  const axes = [0, 0, 0, 0];
  const has = (mask) => (st.b & mask) !== 0;
  const id = `${name || 'Switch 2'} (UDP-bro, Vendor: 057e)`;
  if (side) {
    const flip = flipped();
    const gas = side === 'L' ? B.srL : B.srR;
    const brake = side === 'L' ? B.slL : B.slR;
    const f = FACE_DIRS[side];
    const [fRight, fDown, fUp, fLeft] = flip ? [f.left, f.up, f.down, f.right] : [f.right, f.down, f.up, f.left];
    buttons[BTN_R2] = press(has((flip ? brake : gas) | fRight));
    buttons[BTN_L2] = press(has((flip ? gas : brake) | fDown));
    buttons[BTN_SQUARE] = press(has(fUp | fLeft | SHOULDER));
    buttons[BTN_OPTIONS] = press(has(B.plus | B.minus));
    axes[0] = (side === 'L' ? -1 : 1) * (flip ? -1 : 1) * st.ly;
  } else {
    // Pro Controller, Joy-Con-par og lignende: vanlig kontrolleroppsett (ZR gass, ZL brems, stikke styrer).
    buttons[BTN_R2] = press(has(B.zr));
    buttons[BTN_L2] = press(has(B.zl));
    buttons[BTN_SQUARE] = press(has(B.y | B.b));
    buttons[BTN_OPTIONS] = press(has(B.plus));
    axes[0] = st.lx;
  }
  return { id, index: 100 + slot, connected: true, mapping: 'standard', buttons, axes };
}

const IDLE = { b: 0, lx: 0, ly: 0 };
const RECONNECT_MS = [1000, 5000, 30000];

export class JoyconBridge {
  constructor() {
    this.slots = []; // { name, st } per spilleplass i appen
    this.tries = 0;
    this.open();
  }

  open() {
    let ws;
    try {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/joycon`);
    } catch { return; }
    this.ws = ws;
    ws.onopen = () => { this.tries = 0; };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      const slot = (this.slots[m.s] ||= { name: '', st: IDLE });
      if (m.t === 'n') slot.name = m.n;
      else if (m.t === 'j') slot.st = m;
    };
    ws.onclose = () => {
      this.slots = [];
      setTimeout(() => this.open(), RECONNECT_MS[Math.min(this.tries++, RECONNECT_MS.length - 1)]);
    };
  }

  // Vibrasjon til Joy-Con på plass slot (0–3). Verdiene er 0–1; appen stopper selv etter 0,5 s.
  rumble(slot, strong, weak) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'r', s: slot, a: Math.round(strong * 255), w: Math.round(weak * 255) }));
  }

  // Appen sender bare tilstand når noe endres og gir ikke beskjed når en kontroller forsvinner,
  // så en kontroller regnes som tilkoblet fra den første pakken til siden lastes på nytt.
  pads() {
    return this.slots.flatMap((s, i) => (s ? [toPad(i, s.st, s.name)] : []));
  }
}
