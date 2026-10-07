import { TRUCK_FIELDS } from './game.js';

// Forbindelse mot relayen (se server/relay.js). WebSocket brukes til lobby, oppsett og som reserve.
// I tillegg prøver vi å åpne en direkte WebRTC-datakanal (uordnet, uten gjensending = UDP-lignende) mellom
// verten og hver fjernspiller. Input og øyeblikksbilder går da rett mellom maskinene uten omvei om ngrok/tunnel.
const ICE = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }] };
const FAST = new Set(['snap', 'in']);

export class Net {
  constructor(role, room, handlers, pid = null) {
    this.role = role;
    this.room = room;
    this.pid = pid;
    this.handlers = handlers;
    this.ws = null;
    this.stopped = false;
    this.links = new Map(); // host: peer-id -> forbindelse; klient: 0 -> forbindelse
    this.peers = new Set(); // host: tilkoblede fjernspillere
    this.q = 0; // løpenummer på øyeblikksbilder, så gamle bilder som kommer for sent kastes
    this.lastQ = -1;
    this.open();
  }

  open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const pid = this.pid ? `&pid=${encodeURIComponent(this.pid)}` : '';
    const ws = new WebSocket(`${proto}://${location.host}/ws?role=${this.role}&room=${encodeURIComponent(this.room)}${pid}`);
    this.ws = ws;
    ws.onopen = () => this.handlers.open?.();
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'busy') this.stopped = true;
      if (m.t === 'rtc') return this.signal(m);
      if (m.t === 'peer') {
        if (m.open) { this.peers.add(m.id); this.offer(m.id); } else { this.peers.delete(m.id); this.drop(m.id); }
      }
      if (m.t === 'hello' || m.t === 'host' || m.t === 'hostgone') { this.lastQ = -1; if (m.t === 'hostgone') this.drop(0); }
      this.deliver(m);
    };
    ws.onclose = () => {
      for (const id of [...this.links.keys()]) this.drop(id);
      this.peers.clear();
      this.handlers.close?.();
      if (!this.stopped) setTimeout(() => this.open(), 1500);
    };
  }

  deliver(m) {
    if (m.t === 'snap') {
      if (m.q <= this.lastQ) return;
      this.lastQ = m.q;
    }
    this.handlers.message?.(m);
  }

  get connected() { return !!this.ws && this.ws.readyState === 1; }

  // Antall direkte datakanaler som er åpne (host) eller om den ene kanalen er åpen (klient).
  get direct() {
    let n = 0;
    for (const l of this.links.values()) if (l.ch?.readyState === 'open') n++;
    return n;
  }

  sig(msg) { if (this.connected) this.ws.send(JSON.stringify(msg)); }

  link(id) {
    this.drop(id);
    const pc = new RTCPeerConnection(ICE);
    const l = { pc, ch: null, queue: [] };
    this.links.set(id, l);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sig({ t: 'rtc', ...(this.role === 'host' ? { to: id } : {}), cand: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(id, pc);
    };
    return l;
  }

  wire(ch, id) {
    ch.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (this.role === 'host') m.from = id;
      this.deliver(m);
    };
    ch.onopen = () => this.handlers.rtc?.();
    ch.onclose = () => this.handlers.rtc?.();
  }

  drop(id, only) {
    const l = this.links.get(id);
    if (!l || (only && l.pc !== only)) return;
    this.links.delete(id);
    try { l.pc.close(); } catch { /* ignorer */ }
    this.handlers.rtc?.();
  }

  offer(id) {
    if (this.role !== 'host' || typeof RTCPeerConnection === 'undefined') return;
    const l = this.link(id);
    l.ch = l.pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
    this.wire(l.ch, id);
    l.pc.createOffer()
      .then((o) => l.pc.setLocalDescription(o))
      .then(() => this.sig({ t: 'rtc', to: id, sdp: l.pc.localDescription }))
      .catch(() => {});
  }

  signal(m) {
    if (typeof RTCPeerConnection === 'undefined') return;
    const id = this.role === 'host' ? m.from : 0;
    const flush = (l) => { for (const c of l.queue.splice(0)) l.pc.addIceCandidate(c).catch(() => {}); };
    if (m.sdp) {
      let l = this.links.get(id);
      if (m.sdp.type === 'offer') {
        l = this.link(id);
        l.pc.ondatachannel = (e) => { l.ch = e.channel; this.wire(e.channel, id); };
        l.pc.setRemoteDescription(m.sdp)
          .then(() => { flush(l); return l.pc.createAnswer(); })
          .then((a) => l.pc.setLocalDescription(a))
          .then(() => this.sig({ t: 'rtc', sdp: l.pc.localDescription }))
          .catch(() => {});
      } else if (l) {
        l.pc.setRemoteDescription(m.sdp).then(() => flush(l)).catch(() => {});
      }
    } else if (m.cand) {
      const l = this.links.get(id);
      if (!l) return;
      if (l.pc.remoteDescription) l.pc.addIceCandidate(m.cand).catch(() => {});
      else l.queue.push(m.cand);
    }
  }

  send(msg) {
    if (msg.t === 'snap') msg.q = ++this.q;
    const fast = FAST.has(msg.t);
    const text = JSON.stringify(msg);
    if (this.role !== 'host') {
      const ch = this.links.get(0)?.ch;
      if (fast && ch?.readyState === 'open') ch.send(text);
      else if (this.connected) this.ws.send(text);
      return;
    }
    const targets = msg.to != null ? [msg.to] : [...this.peers];
    const viaWs = [];
    for (const id of targets) {
      const ch = this.links.get(id)?.ch;
      if (fast && ch?.readyState === 'open') ch.send(text);
      else viaWs.push(id);
    }
    if (!this.connected || !viaWs.length) return;
    if (viaWs.length === targets.length) this.ws.send(text);
    else for (const id of viaWs) this.ws.send(JSON.stringify({ ...msg, to: id }));
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
