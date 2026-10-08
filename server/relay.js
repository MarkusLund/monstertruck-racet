import os from 'node:os';
import { WebSocketServer } from 'ws';
import { attachJoycons } from './joycon.js';

// Enkel relay for flerspiller: verten (en nettleserfane på denne maskinen) kjører hele spillet.
// Fjernspillere sender input hit, og relayen videresender det til verten. Verten sender øyeblikksbilder
// tilbake (til alle eller til én spiller). Alt av spilllogikk bor i verten, så relayen er helt «dum».
// Hvert rom (?room=...) er uavhengig, slik at flere verter (f.eks. i tester) ikke forstyrrer hverandre.

const rooms = new Map();
const room = (name) => {
  if (!rooms.has(name)) rooms.set(name, { host: null, clients: new Map(), nextId: 1 });
  return rooms.get(name);
};
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

async function publicUrl() {
  const get = (url) => fetch(url, { signal: AbortSignal.timeout(500) }).then((r) => r.json());
  try {
    const j = await get('http://127.0.0.1:4040/api/tunnels');
    const u = j.tunnels?.find((t) => t.public_url?.startsWith('https'))?.public_url;
    if (u) return u;
  } catch { /* ngrok kjører ikke */ }
  try {
    // cloudflared tunnel --metrics 127.0.0.1:20241 --url http://localhost:5173
    const j = await get('http://127.0.0.1:20241/quicktunnel');
    if (j.hostname) return `https://${j.hostname}`;
  } catch { /* cloudflared kjører ikke */ }
  return null;
}

function attach(httpServer, middlewares) {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws') return;
    wss.handleUpgrade(req, socket, head, (ws) => connect(ws, url));
  });
  middlewares.use('/api/info', async (req, res) => {
    const port = httpServer.address()?.port;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ lan: lanAddresses().map((a) => `http://${a}:${port}`), public: await publicUrl() }));
  });
}

function connect(ws, url) {
  const r = room(url.searchParams.get('room') || 'main');
  const role = url.searchParams.get('role');
  if (role === 'host') {
    if (r.host) { send(ws, { t: 'busy' }); ws.close(); return; }
    r.host = ws;
    send(ws, { t: 'hosting' });
    for (const [id, c] of r.clients) { send(c, { t: 'host' }); send(ws, { t: 'peer', id, open: true }); }
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (m.to != null) send(r.clients.get(m.to), data.toString());
      else for (const c of r.clients.values()) send(c, data.toString());
    });
    ws.on('close', () => {
      if (r.host === ws) r.host = null;
      for (const c of r.clients.values()) send(c, { t: 'hostgone' });
    });
    return;
  }
  const id = r.nextId++;
  r.clients.set(id, ws);
  send(ws, { t: 'hello', id, host: !!r.host });
  send(r.host, { t: 'peer', id, open: true });
  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    send(r.host, { ...m, from: id });
  });
  ws.on('close', () => {
    r.clients.delete(id);
    send(r.host, { t: 'peer', id, open: false });
  });
}

export function relayPlugin() {
  return {
    name: 'monstertruck-relay',
    configureServer(server) {
      attach(server.httpServer, server.middlewares);
      attachJoycons(server.httpServer);
      // Skrives etter at Vite har printet sine adresser.
      server.httpServer?.once('listening', () => setTimeout(() => {
        const port = server.httpServer.address()?.port;
        const lan = lanAddresses().map((a) => `http://${a}:${port}`);
        console.log(`
  \x1b[1mFlerspiller\x1b[0m: du er vert når du åpner http://localhost:${port}
  Andre på samme nett åpner:  ${lan.join('  ') || '(ingen nettverksadresse funnet)'}
  Fungerer ikke det (gjestenett med klientisolering)? Åpne en ny terminal og kjør:
      \x1b[1mnpm run tunnel\x1b[0m   (Cloudflare, krever «brew install cloudflared»)
  Adressen (https://….trycloudflare.com) dukker opp på startskjermen etter noen sekunder,
  og kan sendes til de andre. Stopp tunnelen med Ctrl+C når dere er ferdige.
`);
      }, 300));
    },
    configurePreviewServer(server) { attach(server.httpServer, server.middlewares); },
  };
}
