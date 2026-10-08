import dgram from 'node:dgram';
import { WebSocketServer } from 'ws';

// Bro fra «Finally the Controller Works» (switch2mac) til spillet. Appen sender tilstanden til hver
// tilkoblede Switch 2-kontroller som UDP på 127.0.0.1:24800–24803 (én port per kontroller), til alle som
// har sendt en datagram dit de siste 30 sekundene. Vi abonnerer derfor på nytt hvert 10. sekund og
// sender pakkene videre til nettleseren over WebSocket på /joycon. Brukes når appen ikke kan lage
// virtuelle gamepader (mangler Apples HID-entitlement), slik at Gamepad API-et i nettleseren er tomt.
//
// Pakkeformat (little-endian, 44 byte): "S2B1" | u32 løpenr | u32 knapper | f32 lx,ly,rx,ry | …
// Navnepakke: "S2N1" + UTF-8-navn (f.eks. «Joy-Con 2 (L)»), sendes én gang etter abonnering.

const BASE_PORT = 24800;
const SLOTS = 4;
const RESUBSCRIBE_MS = 10_000;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function parsePacket(buf) {
  if (buf.length >= 28 && buf.toString('latin1', 0, 4) === 'S2B1') {
    return { t: 'j', b: buf.readUInt32LE(8), lx: buf.readFloatLE(12), ly: buf.readFloatLE(16) };
  }
  if (buf.length > 4 && buf.toString('latin1', 0, 4) === 'S2N1') return { t: 'n', n: buf.toString('utf8', 4) };
  return null;
}

export function attachJoycons(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  const names = Array(SLOTS).fill('');
  httpServer.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/joycon') return;
    // Kontrollerne sitter på denne maskinen; fjernspillere skal ikke få dem.
    if (!LOOPBACK.has(req.socket.remoteAddress)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      names.forEach((n, s) => { if (n) ws.send(JSON.stringify({ t: 'n', s, n })); });
    });
  });
  const broadcast = (msg) => {
    const text = JSON.stringify(msg);
    for (const ws of wss.clients) if (ws.readyState === 1) ws.send(text);
  };

  const sockets = [];
  for (let s = 0; s < SLOTS; s++) {
    const sock = dgram.createSocket('udp4');
    sock.on('error', () => { /* appen kjører ikke (ICMP-avvisning); vi prøver igjen ved neste abonnering */ });
    sock.on('message', (buf) => {
      const m = parsePacket(buf);
      if (!m) return;
      if (m.t === 'n') names[s] = m.n;
      broadcast({ ...m, s });
    });
    const subscribe = () => sock.send('hi', BASE_PORT + s, '127.0.0.1', () => {});
    subscribe();
    const timer = setInterval(subscribe, RESUBSCRIBE_MS);
    timer.unref();
    sockets.push(sock);
  }
  httpServer.once('close', () => { for (const s of sockets) s.close(); wss.close(); });
}
