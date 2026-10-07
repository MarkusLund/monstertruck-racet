// Berøringskontroller for mobil: gass (høyre), sving venstre/høyre (venstre side). Flere fingre samtidig fungerer.
export class TouchControls {
  constructor(root) {
    this.root = root;
    this.held = { left: new Set(), right: new Set(), gas: new Set() };
    for (const [name, set] of Object.entries(this.held)) {
      const el = root.querySelector(`[data-btn="${name}"]`);
      const release = (e) => { set.delete(e.pointerId); el.classList.toggle('on', set.size > 0); };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        set.add(e.pointerId);
        el.classList.add('on');
      });
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
    }
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  player() {
    return {
      throttle: this.held.gas.size ? 1 : 0,
      steer: (this.held.right.size ? 1 : 0) - (this.held.left.size ? 1 : 0),
    };
  }
}
