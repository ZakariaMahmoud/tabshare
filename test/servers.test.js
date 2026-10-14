import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { createAdminServer } from '../src/admin-server.js';
import { createViewerServer } from '../src/viewer-server.js';

const log = { info() {}, warn() {}, error() {}, debug() {} };
const ADMIN = 17370;
const KEY = 'test-admin-key-0123456789abcdef';
const VIEWER = 17371;
const page = {
  url: () => 'https://github.com/',
  context: () => ({ cookies: async () => [{ name: 'n', value: 'SECRET', domain: '.github.com' }] }),
};

const created = [];
const manager = {
  list: () => [],
  create: async (body) => (created.push(body), { id: 'x', link: 'l' }),
  revoke: async (id) => id === 'abcdef012345',
  attachViewer: async (token, ws) => {
    if (token === 'throw') throw new Error('boom');
    if (token !== 'good') return 'invalid';
    ws.send(JSON.stringify({ type: 'hello' }));
    return 'ok';
  },
};
const tabs = { list: async () => [{ id: 'abcdef012345', url: 'https://github.com/', title: 'GH' }, { id: 'ffffffffffff', url: 'http://127.0.0.1:7070/', title: 'admin' }], get: (id) => (id === 'abcdef012345' ? page : null) };

let admin;
let viewer;
before(async () => {
  admin = createAdminServer({ port: ADMIN, adminKey: KEY, maxExpiryMinutes: 10080, isForbiddenUrl: (u) => u.includes(':7070'), manager, tabs, getUserBrowser: () => ({ isConnected: () => true }), getPublicUrl: () => 'https://p', log });
  viewer = createViewerServer({ port: VIEWER, manager, log });
  await Promise.all([admin.listen(), viewer.listen()]);
});
after(async () => {
  await Promise.all([admin.close(), viewer.close()]);
});

const adminFetch = (path, opts = {}) => fetch(`http://127.0.0.1:${ADMIN}${path}`, { ...opts, headers: { 'x-tabshare-admin': KEY, ...opts.headers } });
const post = (body, headers = { 'content-type': 'application/json' }) =>
  adminFetch('/api/shares', { method: 'POST', headers, body });

test('admin serves UI with security headers', async () => {
  const res = await adminFetch('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await res.text(), /tabshare/);
});

test('admin rejects foreign Host headers (DNS rebinding / tunnel)', async () => {
  const { request } = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port: ADMIN, path: '/api/tabs', headers: { host: 'evil.example' } }, (res) => resolve(res.statusCode))
      .on('error', reject)
      .end();
  });
  assert.equal(status, 421);
});

test('every admin API route (GET included) requires the admin key and same-origin', async () => {
  for (const path of ['/api/status', '/api/tabs', '/api/shares', '/api/tabs/abcdef012345/cookie-domains']) {
    assert.equal((await adminFetch(path, { headers: { 'x-tabshare-admin': '' } })).status, 401, path);
  }
  assert.equal((await adminFetch('/api/shares', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await adminFetch('/api/shares', { headers: { 'sec-fetch-site': 'same-origin' } })).status, 200);
});

test('admin hides tabshare’s own tabs from the tab list', async () => {
  const { data } = await (await adminFetch('/api/tabs')).json();
  assert.deepEqual(data.map((t) => t.id), ['abcdef012345']);
});

test('admin lists status, tabs and cookie domains without cookie values', async () => {
  const status = await (await adminFetch('/api/status')).json();
  assert.deepEqual(status.data, { publicUrl: 'https://p', chromeConnected: true, maxExpiryMinutes: 10080 });
  const tabsRes = await (await adminFetch('/api/tabs')).json();
  assert.equal(tabsRes.data[0].id, 'abcdef012345');
  const res = await adminFetch('/api/tabs/abcdef012345/cookie-domains');
  const text = await res.text();
  assert.ok(!text.includes('SECRET'));
  assert.deepEqual(JSON.parse(text).data, { domains: [{ domain: 'github.com', count: 1 }], suggested: ['github.com'] });
  assert.equal((await adminFetch('/api/tabs/ffffffffffff/cookie-domains')).status, 404);
  assert.equal((await adminFetch('/api/shares')).status, 200);
  assert.equal((await adminFetch('/nope')).status, 404);
});

test('admin POST requires the admin header, JSON content type and valid JSON', async () => {
  assert.equal((await post('{}', { 'x-tabshare-admin': '', 'content-type': 'application/json' })).status, 401);
  assert.equal((await post('{}', { 'x-tabshare-admin': 'wrong', 'content-type': 'application/json' })).status, 401);
  assert.equal((await post('{}', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('{bad')).status, 400);
  assert.equal((await post('x'.repeat(20_000))).status, 413);
  const ok = await post(JSON.stringify({ tabId: 'abcdef012345' }));
  assert.equal(ok.status, 201);
  assert.deepEqual(created.at(-1), { tabId: 'abcdef012345' });
});

test('admin DELETE revokes known shares only', async () => {
  const del = (id, headers = {}) => adminFetch(`/api/shares/${id}`, { method: 'DELETE', headers });
  assert.equal((await del('abcdef012345', { 'x-tabshare-admin': 'nope' })).status, 401);
  assert.equal((await del('abcdef012345')).status, 200);
  assert.equal((await del('ffffffffffff')).status, 404);
});

test('viewer server serves the page and does not expose the admin API', async () => {
  const res = await fetch(`http://127.0.0.1:${VIEWER}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Shared tab/);
  assert.equal((await fetch(`http://127.0.0.1:${VIEWER}/api/shares`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${VIEWER}/admin.html`)).status, 404);
});

function wsExchange(firstMessage) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${VIEWER}/ws`);
    ws.on('open', () => ws.send(firstMessage));
    ws.on('message', (d) => {
      resolve(JSON.parse(d.toString()));
      ws.close();
    });
    ws.on('error', reject);
  });
}

test('viewer websocket authenticates with the token as first message', async () => {
  assert.deepEqual(await wsExchange(JSON.stringify({ token: 'good' })), { type: 'hello' });
  assert.match((await wsExchange(JSON.stringify({ token: 'bad' }))).message, /invalid, expired or revoked/);
  assert.match((await wsExchange('not json')).message, /invalid/);
  assert.match((await wsExchange(JSON.stringify({ token: 'throw' }))).message, /could not be streamed/);
});

test('listen rejects with EADDRINUSE when the port is taken instead of crashing', async () => {
  const clash = createViewerServer({ port: VIEWER, manager, log });
  await assert.rejects(clash.listen(), (err) => err.code === 'EADDRINUSE');
});
