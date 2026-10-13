import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createHub } from '../src/hub.js';
import { createShareManager } from '../src/manager.js';
import { createShareStore } from '../src/shares.js';

const log = { info() {}, warn() {}, error() {}, debug() {} };
const limits = { defaultTtlMinutes: 30, maxTtlMinutes: 1440, maxViewers: 10 };
const STREAM = Object.freeze({ jpegQuality: 80, deviceScaleFactor: 1 });

function fakeWs() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.bufferedAmount = 0;
  ws.sent = [];
  ws.send = (d) => ws.sent.push(d);
  ws.close = () => {
    ws.readyState = 3;
    ws.emit('close');
  };
  return ws;
}

function fakeStreaming() {
  const calls = { started: 0, stopped: 0, inputs: [] };
  let onFrame;
  return {
    calls,
    emitFrame: (f) => onFrame(f),
    startStreamer: async (_page, opts) => {
      calls.started += 1;
      onFrame = opts.onFrame;
      return { getSize: () => ({ width: 100, height: 50 }), stop: async () => { calls.stopped += 1; } };
    },
    applyInput: async (_page, size, input) => calls.inputs.push({ size, input }),
  };
}

const share = (over = {}) => ({ id: 'aaaaaaaaaaaa', tabTitle: 'T', allowControl: false, maxViewers: 2, oneTime: false, expiresAt: 1, ...over });

test('hub streams only while viewers are connected and broadcasts frames', async () => {
  const s = fakeStreaming();
  let closed = false;
  const hub = createHub({ share: share(), session: { page: {}, close: async () => { closed = true; } }, ...s, stream: STREAM, log });
  const ws = fakeWs();
  assert.equal(await hub.addViewer(ws), 'ok');
  assert.equal(JSON.parse(ws.sent[0]).type, 'hello');
  assert.equal(s.calls.started, 1);
  s.emitFrame(Buffer.from('frame'));
  assert.equal(ws.sent.at(-1).toString(), 'frame');

  const late = fakeWs();
  await hub.addViewer(late);
  assert.equal(late.sent[1].toString(), 'frame', 'late joiner gets the last frame immediately');
  assert.equal(s.calls.started, 1);

  ws.close();
  late.close();
  await new Promise((r) => setImmediate(r));
  assert.equal(s.calls.stopped, 1);
  await hub.close('revoked');
  assert.ok(closed);
});

test('hub enforces max viewers and one-time links', async () => {
  const s = fakeStreaming();
  const session = { page: {}, close: async () => {} };
  const full = createHub({ share: share({ maxViewers: 1 }), session, ...s, stream: STREAM, log });
  assert.equal(await full.addViewer(fakeWs()), 'ok');
  assert.equal(await full.addViewer(fakeWs()), 'full');

  const once = createHub({ share: share({ oneTime: true }), session, ...s, stream: STREAM, log });
  const first = fakeWs();
  assert.equal(await once.addViewer(first), 'ok');
  first.close();
  assert.equal(await once.addViewer(fakeWs()), 'link_used');
});

test('hub ignores input unless control is allowed, and validates it', async () => {
  const session = { page: {}, close: async () => {} };
  const viewOnly = fakeStreaming();
  const hubA = createHub({ share: share(), session, ...viewOnly, stream: STREAM, log });
  const a = fakeWs();
  await hubA.addViewer(a);
  a.emit('message', Buffer.from(JSON.stringify({ type: 'text', text: 'hi' })), false);
  assert.equal(viewOnly.calls.inputs.length, 0);

  const control = fakeStreaming();
  const hubB = createHub({ share: share({ allowControl: true }), session, ...control, stream: STREAM, log });
  const b = fakeWs();
  await hubB.addViewer(b);
  b.emit('message', Buffer.from(JSON.stringify({ type: 'text', text: 'hi' })), false);
  b.emit('message', Buffer.from('garbage'), false);
  b.emit('message', Buffer.from('x'), true);
  await new Promise((r) => setImmediate(r));
  assert.equal(control.calls.inputs.length, 1);
  assert.deepEqual(control.calls.inputs[0].size, { width: 100, height: 50 });
});

test('hub close notifies viewers', async () => {
  const s = fakeStreaming();
  const hub = createHub({ share: share(), session: { page: {}, close: async () => {} }, ...s, stream: STREAM, log });
  const ws = fakeWs();
  await hub.addViewer(ws);
  await hub.close('revoked');
  assert.deepEqual(JSON.parse(ws.sent.at(-1)), { type: 'ended', reason: 'revoked' });
});

function setupManager({ now = () => 0, url = 'https://example.com/', timers = null } = {}) {
  const page = { url: () => url };
  const hubCalls = { added: [], closed: [] };
  const manager = createShareManager({
    store: createShareStore(),
    tabs: { get: (id) => (id === 'abcdef012345' ? page : null) },
    openSession: async ({ share }) => ({ share }),
    makeHub: ({ share }) => ({
      addViewer: async (ws) => (hubCalls.added.push([share.id, ws]), 'ok'),
      viewerCount: () => 0,
      close: async (reason) => hubCalls.closed.push([share.id, reason]),
    }),
    limits,
    getPublicUrl: () => 'https://x.trycloudflare.com',
    getTitle: async () => 'Example',
    isForbiddenUrl: (u) => u.startsWith('http://127.0.0.1:7070'),
    now,
    ...(timers ? { setTimer: timers.set, clearTimer: timers.clear } : {}),
    log,
  });
  return { manager, hubCalls };
}

test('manager creates shares with a fragment link and attaches viewers by token', async () => {
  const { manager, hubCalls } = setupManager();
  const created = await manager.create({ tabId: 'abcdef012345' });
  assert.match(created.link, /^https:\/\/x\.trycloudflare\.com\/#t=[\w-]{32}$/);
  assert.equal(created.tabTitle, 'Example');
  const token = created.link.split('#t=')[1];
  assert.equal(await manager.attachViewer(token, 'ws'), 'ok');
  assert.equal(await manager.attachViewer('wrong', 'ws'), 'invalid');
  assert.equal(hubCalls.added.length, 1);
  assert.equal(manager.list().length, 1);
});

test('manager rejects invalid requests and unknown tabs', async () => {
  const { manager } = setupManager();
  await assert.rejects(manager.create({ tabId: 'bad' }), (e) => e.status === 400);
  await assert.rejects(manager.create({ tabId: 'ffffffffffff' }), (e) => e.status === 404);
});

test('manager reports session failures as 502 without registering the share', async () => {
  const manager = createShareManager({
    store: createShareStore(),
    tabs: { get: () => ({ url: () => 'https://down.example/' }) },
    openSession: async () => {
      throw new Error('net::ERR_CONNECTION_REFUSED\n=== logs ===');
    },
    makeHub: () => assert.fail('hub must not be created'),
    limits,
    getPublicUrl: () => null,
    getTitle: async () => '',
    log,
  });
  await assert.rejects(manager.create({ tabId: 'abcdef012345' }), (e) => e.status === 502 && /ERR_CONNECTION_REFUSED$/.test(e.message));
  assert.equal(manager.list().length, 0);
});

test('manager revokes, expires and closes all', async () => {
  let t = 0;
  const { manager, hubCalls } = setupManager({ now: () => t });
  const a = await manager.create({ tabId: 'abcdef012345', ttlMinutes: 1 });
  const b = await manager.create({ tabId: 'abcdef012345', ttlMinutes: 10 });
  assert.equal(await manager.revoke('ffffffffffff'), false);

  t = 2 * 60_000;
  assert.equal(await manager.attachViewer(a.link.split('#t=')[1], 'ws'), 'invalid', 'expired link rejected before sweep');
  await manager.sweep();
  assert.deepEqual(hubCalls.closed, [[a.id, 'expired']]);

  await manager.closeAll();
  assert.deepEqual(hubCalls.closed.at(-1), [b.id, 'server shutting down']);
  assert.equal(manager.list().length, 0);
});

test('manager refuses to share tabshare’s own admin UI', async () => {
  const { manager } = setupManager({ url: 'http://127.0.0.1:7070/' });
  await assert.rejects(manager.create({ tabId: 'abcdef012345' }), (e) => e.status === 400 && /admin UI/.test(e.message));
});

test('manager expires shares exactly on time and clears timers on revoke', async () => {
  const scheduled = new Map();
  let nextId = 0;
  const timers = {
    set: (fn, ms) => {
      const id = ++nextId;
      scheduled.set(id, { fn, ms });
      return id;
    },
    clear: (id) => scheduled.delete(id),
  };
  const { manager, hubCalls } = setupManager({ timers });
  const a = await manager.create({ tabId: 'abcdef012345', ttlMinutes: 2 });
  const b = await manager.create({ tabId: 'abcdef012345', ttlMinutes: 5 });
  assert.deepEqual([...scheduled.values()].map((t) => t.ms), [120_000, 300_000]);

  await manager.revoke(b.id);
  assert.equal(scheduled.size, 1, 'revoking clears the timer');

  [...scheduled.values()][0].fn();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(hubCalls.closed.at(-1), [a.id, 'expired']);
  assert.equal(manager.list().length, 0);
});

test('hub replays input in order even when some calls are slow', async () => {
  const order = [];
  const s = fakeStreaming();
  const applyInput = async (_page, _size, input) => {
    if (input.action === 'down') await new Promise((r) => setTimeout(r, 20));
    order.push(input.action);
  };
  const hub = createHub({ share: share({ allowControl: true }), session: { page: {}, close: async () => {} }, ...s, applyInput, stream: STREAM, log });
  const ws = fakeWs();
  await hub.addViewer(ws);
  for (const action of ['down', 'up']) ws.emit('message', Buffer.from(JSON.stringify({ type: 'mouse', action, x: 0, y: 0 })), false);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(order, ['down', 'up']);
});

test('hub forwards stream settings and tells viewers the quality and frame density', async () => {
  let opts;
  const s = fakeStreaming();
  const startStreamer = async (page, o) => ((opts = o), s.startStreamer(page, o));
  const stream = { jpegQuality: 92, deviceScaleFactor: 2 };
  const hub = createHub({ share: share({ quality: 'high' }), session: { page: {}, close: async () => {} }, ...s, startStreamer, stream, log });
  const ws = fakeWs();
  await hub.addViewer(ws);
  assert.equal(opts.jpegQuality, 92);
  const hello = JSON.parse(ws.sent[0]);
  assert.equal(hello.quality, 'high');
  assert.equal(hello.frameScale, 2);
});
