// Input: tastatur (to spillere på ett tastatur) + opptil to kontrollere (PS5 DualSense).
// Each player's input is the combination of their keys and their assigned controller,
// so keyboard and controllers can be mixed freely.

export const KEYS = {
  0: { accel: 'KeyW', back: 'KeyS', jump: 'Space', left: 'KeyA', right: 'KeyD' },
  1: { accel: 'ArrowUp', back: 'ArrowDown', jump: 'ShiftRight', left: 'ArrowLeft', right: 'ArrowRight' },
};

// Standard Gamepad mapping (Chrome/Safari/Firefox on macOS map DualSense to this).
const BTN_CROSS = 0; // X
const BTN_R2 = 7;
const BTN_L2 = 6;
const BTN_SQUARE = 2;
const BTN_OPTIONS = 9;
const BTN_DPAD_LEFT = 14;
const BTN_DPAD_RIGHT = 15;
const STICK_DEADZONE = 0.12;

const CONFIRM_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressedQueue = new Set(); // key codes pressed since last poll
    this.padSlots = [null, null]; // gamepad index assigned to player 0/1
    this.prevPadButtons = new Map(); // gamepad index -> boolean[]
    this.padEdges = new Map(); // gamepad index -> Set(button) newly pressed this poll
    this.pads = [null, null];

    target.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.pressedQueue.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
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
    for (let s = 0; s < 2; s++) {
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
    const k = KEYS[i];
    const pad = this.pads[i];
    let throttle = this.down.has(k.accel) ? 1 : 0;
    let steer = (this.down.has(k.right) ? 1 : 0) - (this.down.has(k.left) ? 1 : 0);
    let brake = this.down.has(k.back) ? 1 : 0;
    let jump = this.down.has(k.jump);
    if (pad) {
      const l2 = this.padButton(pad, BTN_L2);
      brake = Math.max(brake, l2 > 0.04 ? l2 : 0);
      jump = jump || this.padButton(pad, BTN_SQUARE) > 0.5;
      const r2 = this.padButton(pad, BTN_R2);
      throttle = Math.max(throttle, r2 > 0.04 ? r2 : 0);
      const x = pad.axes[0] || 0;
      const stick = Math.abs(x) > STICK_DEADZONE ? (x - Math.sign(x) * STICK_DEADZONE) / (1 - STICK_DEADZONE) : 0;
      const dpad = this.padButton(pad, BTN_DPAD_RIGHT) - this.padButton(pad, BTN_DPAD_LEFT);
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

  backPressed() {
    return this.pressed.has('Escape');
  }

  padInfo(i) {
    const pad = this.pads[i];
    if (!pad) return null;
    const id = pad.id || '';
    const name = /dualsense|0ce6|0df2/i.test(id) ? 'DualSense' : /054c/i.test(id) ? 'PlayStation' : 'Kontroller';
    return { name, index: pad.index };
  }
}
