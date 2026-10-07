// Shared camera: keeps both trucks in view, zooming out as they separate.
export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 30; // device pixels per meter
    this.w = 1;
    this.h = 1;
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
  }

  // Zoom level used when both trucks are close together.
  get baseZoom() {
    return Math.min(this.w / 34, this.h / 17);
  }

  target(trucks) {
    const xs = trucks.map((t) => t.x), ys = trucks.map((t) => t.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const marginX = 16, marginY = 9; // meters around the trucks
    const zoom = Math.min(this.baseZoom, this.w / (maxX - minX + marginX * 2), this.h / (maxY - minY + marginY * 2));
    // Look slightly ahead (right) and above the trucks.
    return { x: (minX + maxX) / 2 + 4, y: (minY + maxY) / 2 + 2.5, zoom };
  }

  update(trucks, dt, snap = false) {
    const t = this.target(trucks);
    const k = snap ? 1 : 1 - Math.exp(-dt * 5);
    this.x += (t.x - this.x) * k;
    this.y += (t.y - this.y) * k;
    // Zooming out reacts fast (trucks must never leave the screen); zooming in eases slowly.
    const kz = snap ? 1 : t.zoom < this.zoom ? 1 - Math.exp(-dt * 8) : 1 - Math.exp(-dt * 1.5);
    this.zoom += (t.zoom - this.zoom) * kz;
    // Hard guarantee: never be more zoomed in than needed to fit both trucks.
    const fit = this.fitZoom(trucks);
    if (this.zoom > fit) this.zoom = fit;
  }

  // Largest zoom at which every truck (with a small margin) is on screen around the current center.
  fitZoom(trucks) {
    let z = Infinity;
    for (const t of trucks) {
      const dx = Math.abs(t.x - this.x) + 3.5, dy = Math.abs(t.y - this.y) + 3;
      z = Math.min(z, this.w / 2 / dx, this.h / 2 / dy);
    }
    return z;
  }

  toScreen(x, y) {
    return { x: (x - this.x) * this.zoom + this.w / 2, y: this.h / 2 - (y - this.y) * this.zoom };
  }

  toWorldX(sx) {
    return (sx - this.w / 2) / this.zoom + this.x;
  }
}
