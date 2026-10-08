import { test, expect } from '@playwright/test';
import { registerHooks } from 'node:module';

// Enhetstest av GameRoom (server/worker.js) uten Cloudflare: `cloudflare:workers` byttes ut med en minimal
// DurableObject-basisklasse, og WebSocket-ene er falske objekter som samler meldingene de får.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true };
    return next(spec, ctx);
  },
});
const { GameRoom } = await import('../server/worker.js');

function fakeSocket() {
  const ws = { got: [], handlers: {}, send(text) { ws.got.push(JSON.parse(text)); }, addEventListener(type, fn) { ws.handlers[type] = fn; } };
  ws.say = (m) => ws.handlers.message({ data: JSON.stringify(m) });
  ws.last = (t) => ws.got.findLast((m) => m.t === t);
  return ws;
}
const pid = (n) => `spiller-nr-${n}`;
const connect = (room, n) => { const ws = fakeSocket(); room.join(ws, pid(n)); return ws; };
const newRoom = () => new GameRoom({}, {});
const stop = (room) => { room.stopLoop(); clearTimeout(room.emptyTimer); };

test.describe('Cloudflare-lobby (GameRoom)', () => {
  test('lobbyen sender klar-status per spiller', () => {
    const room = newRoom();
    const a = connect(room, 1), b = connect(room, 2);
    expect(b.last('lobby')).toMatchObject({ you: 1, rdy: [0, 0], ai: 1 });
    a.say({ t: 'ready' });
    expect(b.last('lobby').rdy).toEqual([1, 0]);
    expect(room.game.state).toBe('menu');
    a.say({ t: 'ready' }); // veksler tilbake
    expect(a.last('lobby').rdy).toEqual([0, 0]);
    stop(room);
  });

  test('alene: Enter (ready) starter løpet umiddelbart med 1 AI', () => {
    const room = newRoom();
    const a = connect(room, 1);
    a.say({ t: 'ready' });
    expect(room.game.state).toBe('countdown');
    expect(room.game.trucks.length).toBe(2);
    expect(room.slotAi()).toBe(1);
    expect(a.last('assign')).toMatchObject({ slot: 0, ai: 1 });
    stop(room);
  });

  test('to spillere: starter først når begge er klare', () => {
    const room = newRoom();
    const a = connect(room, 1), b = connect(room, 2);
    a.say({ t: 'ready' });
    expect(room.game.state).toBe('menu');
    b.say({ t: 'ready' });
    expect(room.game.state).toBe('countdown');
    expect(room.game.trucks.length).toBe(3); // 2 spillere + 1 AI
    expect(b.last('assign').slot).toBe(1);
    stop(room);
  });

  test('«start nå» tvinger start selv om ikke alle er klare', () => {
    const room = newRoom();
    const a = connect(room, 1), b = connect(room, 2);
    b.say({ t: 'go' });
    expect(room.game.state).toBe('countdown');
    expect(a.last('assign').slot).toBe(0);
    stop(room);
  });

  test('når den som ikke var klar forlater rommet, starter løpet for de klare', () => {
    const room = newRoom();
    const a = connect(room, 1), b = connect(room, 2);
    a.say({ t: 'ready' });
    b.handlers.close();
    expect(room.game.state).toBe('countdown');
    stop(room);
  });

  test('sen innkomling overtar siste AI-truck', () => {
    const room = newRoom();
    const a = connect(room, 1);
    room.ai = 2;
    a.say({ t: 'ready' });
    expect(room.slots).toEqual([pid(1), '@ai', '@ai']);
    const c = connect(room, 3);
    expect(room.slots).toEqual([pid(1), '@ai', pid(3)]);
    expect(room.ais[2]).toBeNull();
    expect(c.last('assign')).toMatchObject({ slot: 2, ai: 1 });
    expect(c.last('lobby').you).toBe(2);
    expect(a.last('assign')).toMatchObject({ slot: 0, ai: 1 });
    stop(room);
  });

  test('uten AI-truck, eller uten pid, blir innkomlingen tilskuer', () => {
    const room = newRoom();
    const a = connect(room, 1);
    room.ai = 0;
    a.say({ t: 'ready' });
    const c = connect(room, 3);
    expect(c.last('lobby').you).toBe(-1);
    expect(c.last('assign')).toBeUndefined();
    const room2 = newRoom();
    connect(room2, 1).say({ t: 'ready' });
    const w = fakeSocket();
    room2.join(w, null);
    expect(w.last('lobby').you).toBe(-1);
    expect(room2.slotAi()).toBe(1);
    stop(room); stop(room2);
  });
});
