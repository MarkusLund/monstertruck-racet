import { TRUCK_FIELDS } from './game.js';

// WebSocket-forbindelse mot relayen (se server/relay.js). Kobler til på nytt av seg selv hvis den faller ut.
export class Net {
  constructor(role, room, handlers) {
    this.role = role;
    this.room = room;
    this.handlers = handlers;
    this.ws = null;
    this.stopped = false;
    this.open();
  }

  open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?role=${this.role}&room=${encodeURIComponent(this.room)}`);
    this.ws = ws;
    ws.onopen = () => this.handlers.open?.();
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'busy') this.stopped = true;
      this.handlers.message?.(m);
    };
    ws.onclose = () => {
      this.handlers.close?.();
      if (!this.stopped) setTimeout(() => this.open(), 1500);
    };
  }

  get connected() { return !!this.ws && this.ws.readyState === 1; }

  send(msg) {
    if (this.connected) this.ws.send(JSON.stringify(msg));
  }
}

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const SMOOTH = new Set(['x', 'y', 'z', 'theta', 'roll', 'wheelSpin']);
const INDEX = Object.fromEntries(TRUCK_FIELDS.map((f, i) => [f, i]));

// Blander to øyeblikksbilder fra verten (k = 0..1) så trucken beveger seg jevnt selv om bildene kommer 30 ganger i sekundet.
export function lerpSnapshot(a, b, k) {
  if (!a || a.seed !== b.seed || a.n !== b.n || k >= 1) return b;
  const out = { ...b };
  out.tr = b.tr.map((tb, i) => {
    const ta = a.tr[i];
    const r = tb.slice();
    for (const f of SMOOTH) {
      const j = INDEX[f];
      r[j] = f === 'theta' ? ta[j] + angleDiff(tb[j], ta[j]) * k : ta[j] + (tb[j] - ta[j]) * k;
    }
    return r;
  });
  if (a.pr.length === b.pr.length) out.pr = b.pr.map((p, i) => [a.pr[i][0] + (p[0] - a.pr[i][0]) * k, a.pr[i][1] + (p[1] - a.pr[i][1]) * k, p[2], p[3]]);
  return out;
}
