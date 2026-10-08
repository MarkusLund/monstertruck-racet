// Input: tastatur (to spillere på ett tastatur) + opptil fire kontrollere (PS5 DualSense og Nintendo Switch 2), én per spiller.
// Each player's input is the combination of their keys and their assigned controller,
// so keyboard and controllers can be mixed freely.

export const KEYS = {
  0: { accel: ['KeyS'], back: ['Digit2'], jump: ['KeyA'], left: ['Digit1'], right: ['Digit3'] },
  1: {
    accel: ['AltRight', 'ArrowUp'],
    back: ['ArrowDown'],
    jump: ['MetaRight', 'ShiftRight'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
  },
};

// Standard Gamepad mapping (Chrome/Safari/Firefox on macOS map DualSense to this).
const BTN_CROSS = 0; // X
const BTN_R2 = 7;
const BTN_L2 = 6;
const BTN_SQUARE = 2;
const BTN_OPTIONS = 9;
const BTN_DPAD_UP = 12;
const BTN_DPAD_DOWN = 13;
const BTN_DPAD_LEFT = 14;
const BTN_DPAD_RIGHT = 15;
const STICK_DEADZONE = 0.12;
export const PAD_SLOTS = 4;
const NO_KEYS = { accel: [], back: [], jump: [], left: [], right: [] }; // spiller 3 og 4 har bare kontroller

// Nintendo Switch 2 (Pro Controller 2, Joy-Con 2, GameCube) via switch2mac eller annen Bluetooth-bro.
// Kjenner nettleseren enheten, får vi standard mapping (samme knappeindekser som over).
// Ellers (mapping !== 'standard') brukes Nintendos HID-rekkefølge: A=1, + =9, d-pad som hat-akse.
const SWITCH_ID = /057e|nintendo|switch|joy-?con|pro controller/i;
const BTN_A_RAW = 1;
const HAT_AXIS = 9;
export const isSwitchPad = (pad) => !!pad && SWITCH_ID.test(pad.id || '');
const isRawPad = (pad) => !!pad && pad.mapping !== 'standard';

// Hat-bryteren (d-pad) på ikke-standard kontrollere: åtte retninger fra -1 (opp) med steg på 2/7 med klokka, 1.29 = nøytral.
function hatDir(pad) {
  const v = pad.axes[HAT_AXIS];
  if (typeof v !== 'number' || v > 1.1 || v < -1.1) return { x: 0, y: 0 };
  const step = Math.round((v + 1) * 3.5); // 0=opp, 1=opp+høyre, 2=høyre, ...
  const dirs = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
  const [x, y] = dirs[step] || [0, 0];
  return { x, y };
}

const CONFIRM_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressedQueue = new Set(); // key codes pressed since last poll
    this.metaKeys = new Set(); // taster trykket mens Cmd var nede (mister keyup på Mac)
    this.padSlots = Array(PAD_SLOTS).fill(null); // gamepad index assigned to player 0..3
    this.prevPadButtons = new Map(); // gamepad index -> boolean[]
    this.padEdges = new Map(); // gamepad index -> Set(button) newly pressed this poll
    this.pads = Array(PAD_SLOTS).fill(null);

    target.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.pressedQueue.add(e.code);
      this.down.add(e.code);
      // macOS sender ikke keyup for taster som trykkes mens Cmd holdes inne.
      if (e.metaKey && !e.code.startsWith('Meta')) this.metaKeys.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      if (e.code.startsWith('Meta')) {
        for (const c of this.metaKeys) this.down.delete(c);
        this.metaKeys.clear();
      }
    });
    target.addEventListener('blur', () => {
      this.down.clear();
      this.metaKeys.clear();
    });
  }

  // Call once per simulation step.
  poll() {
    this.pressed = this.pressedQueue;
    this.pressedQueue = new Set();

    const list = (navigator.getGamepads ? Array.from(navigator.getGamepads()) : []).filter(
      (p) => p && p.connected !== false,
    );
    const present = new Set(list.map((p) => p.index));
    // Drop disconnected controllers from their slot.
    for (let s = 0; s < PAD_SLOTS; s++) {
      if (this.padSlots[s] !== null && !present.has(this.padSlots[s])) this.padSlots[s] = null;
    }
    // Assign new controllers to the first free player slot (stable assignment).
    for (const p of list.sort((a, b) => a.index - b.index)) {
      if (this.padSlots.includes(p.index)) continue;
      const free = this.padSlots.indexOf(null);
      if (free === -1) break;
      this.padSlots[free] = p.index;
    }

    this.padEdges.clear();
    const byIndex = new Map(list.map((p) => [p.index, p]));
    for (const p of list) {
      const now = p.buttons.map((b) => (typeof b === 'object' ? b.pressed : b > 0.5));
      if (isRawPad(p) && isSwitchPad(p)) {
        const h = hatDir(p);
        now[BTN_DPAD_UP] = now[BTN_DPAD_UP] || h.y > 0;
        now[BTN_DPAD_DOWN] = now[BTN_DPAD_DOWN] || h.y < 0;
        now[BTN_DPAD_LEFT] = now[BTN_DPAD_LEFT] || h.x < 0;
        now[BTN_DPAD_RIGHT] = now[BTN_DPAD_RIGHT] || h.x > 0;
        now[BTN_CROSS] = now[BTN_CROSS] || !!now[BTN_A_RAW]; // A bekrefter
      }
      const prev = this.prevPadButtons.get(p.index) || [];
      const edges = new Set();
      now.forEach((v, i) => v && !prev[i] && edges.add(i));
      this.padEdges.set(p.index, edges);
      this.prevPadButtons.set(p.index, now);
    }
    for (const idx of [...this.prevPadButtons.keys()]) {
      if (!present.has(idx)) this.prevPadButtons.delete(idx);
    }
    this.pads = this.padSlots.map((i) => (i === null ? null : byIndex.get(i) || null));
  }

  padButton(pad, i) {
    const b = pad && pad.buttons[i];
    if (!b) return 0;
    return typeof b === 'object' ? Math.max(b.value || 0, b.pressed ? 1 : 0) : b;
  }

  // Returns { throttle: 0..1, steer: -1..1 (positiv = høyre) }
  player(i) {
    const k = KEYS[i] || NO_KEYS;
    const pad = this.pads[i];
    const held = (codes) => codes.some((c) => this.down.has(c));
    let throttle = held(k.accel) ? 1 : 0;
    let steer = (held(k.right) ? 1 : 0) - (held(k.left) ? 1 : 0);
    let brake = held(k.back) ? 1 : 0;
    let jump = held(k.jump);
    if (pad) {
      const l2 = this.padButton(pad, BTN_L2);
      brake = Math.max(brake, l2 > 0.04 ? l2 : 0);
      jump = jump || this.padButton(pad, BTN_SQUARE) > 0.5;
      const r2 = this.padButton(pad, BTN_R2);
      throttle = Math.max(throttle, r2 > 0.04 ? r2 : 0);
      const x = pad.axes[0] || 0;
      const stick = Math.abs(x) > STICK_DEADZONE ? (x - Math.sign(x) * STICK_DEADZONE) / (1 - STICK_DEADZONE) : 0;
      let dpad = this.padButton(pad, BTN_DPAD_RIGHT) - this.padButton(pad, BTN_DPAD_LEFT);
      if (isRawPad(pad) && isSwitchPad(pad)) dpad = hatDir(pad).x;
      steer = Math.max(-1, Math.min(1, steer + stick + dpad));
    }
    return { throttle, steer, brake, jump };
  }

  // "Start / confirm" from keyboard or any controller.
  confirmPressed() {
    for (const c of this.pressed) if (CONFIRM_KEYS.has(c)) return true;
    for (const edges of this.padEdges.values()) {
      if (edges.has(BTN_CROSS) || edges.has(BTN_OPTIONS)) return true;
    }
    return false;
  }

  // Menyvalg for AI: d-pad opp/ned (antall) og venstre/høyre (vanskelighet), på tvers av alle kontrollere.
  menuNav() {
    let dx = 0, dy = 0;
    for (const edges of this.padEdges.values()) {
      dy += (edges.has(BTN_DPAD_UP) ? 1 : 0) - (edges.has(BTN_DPAD_DOWN) ? 1 : 0);
      dx += (edges.has(BTN_DPAD_RIGHT) ? 1 : 0) - (edges.has(BTN_DPAD_LEFT) ? 1 : 0);
    }
    return { dx, dy };
  }

  backPressed() {
    return this.pressed.has('Escape');
  }

  padInfo(i) {
    const pad = this.pads[i];
    if (!pad) return null;
    const id = pad.id || '';
    if (isSwitchPad(pad)) return { name: 'Switch 2', index: pad.index };
    const name = /dualsense|0ce6|0df2/i.test(id) ? 'DualSense' : /054c/i.test(id) ? 'PlayStation' : 'Kontroller';
    return { name, index: pad.index };
  }
}
