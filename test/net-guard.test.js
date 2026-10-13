import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDnsGuard, createForbiddenTargetCheck, createRequestPolicy, isPrivateHost } from '../src/net-guard.js';

test('isPrivateHost flags loopback, LAN, link-local and localhost names', () => {
  for (const h of ['localhost', 'app.localhost', '127.0.0.1', '127.8.9.10', '10.1.2.3', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'LOCALHOST.']) {
    assert.equal(isPrivateHost(h), true, h);
  }
  for (const h of ['example.com', '8.8.8.8', '172.32.0.1', '11.0.0.1', '2606:4700::1111', '::ffff:8.8.8.8', 'localhost.example.com']) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

test('policy allows public sites and the shared origin, blocks other local targets', () => {
  const allow = createRequestPolicy('https://github.com/x');
  assert.equal(allow('https://github.com/login'), true);
  assert.equal(allow('https://cdn.example.com/a.js'), true);
  assert.equal(allow('data:image/png;base64,AA'), true);
  assert.equal(allow('http://127.0.0.1:7070/api/shares'), false);
  assert.equal(allow('http://localhost:9222/json'), false);
  assert.equal(allow('ws://127.0.0.1:9222/devtools/browser/x'), false);
  assert.equal(allow('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(allow('file:///etc/passwd'), false);
  assert.equal(allow('chrome://settings'), false);
  assert.equal(allow('not a url'), false);
});

test('policy permits sharing a local dev server without opening the rest of localhost', () => {
  const allow = createRequestPolicy('http://localhost:3000/');
  assert.equal(allow('http://localhost:3000/api'), true);
  assert.equal(allow('http://localhost:7070/api/shares'), false);
  assert.equal(allow('http://127.0.0.1:3000/'), false);
});

test('dns guard blocks public names that resolve to private addresses, and caches', async () => {
  const table = { 'example.com': ['93.184.215.14'], 'rebind.evil': ['127.0.0.1'], 'mixed.evil': ['8.8.8.8', '10.0.0.1'] };
  let lookups = 0;
  const lookup = async (host) => {
    lookups += 1;
    if (!table[host]) throw new Error('ENOTFOUND');
    return table[host].map((address) => ({ address }));
  };
  let t = 0;
  const guard = createDnsGuard({ lookup, ttlMs: 1000, now: () => t });
  assert.equal(await guard('example.com'), true);
  assert.equal(await guard('rebind.evil'), false);
  assert.equal(await guard('mixed.evil'), false);
  assert.equal(await guard('nxdomain.test'), false);
  assert.equal(await guard('8.8.8.8'), true);
  assert.equal(await guard('[::1]'), false);
  assert.equal(await guard('localhost'), false);
  assert.equal(lookups, 4);
  await guard('example.com');
  assert.equal(lookups, 4, 'cached');
  t = 1000;
  await guard('example.com');
  assert.equal(lookups, 5, 'cache expires');
});

test('forbidden target check covers tabshare and DevTools ports on local hosts only', () => {
  const forbidden = createForbiddenTargetCheck([7070, 7071, '9222']);
  assert.equal(forbidden('http://127.0.0.1:7070/'), true);
  assert.equal(forbidden('http://localhost:9222/json'), true);
  assert.equal(forbidden('http://[::1]:7071/'), true);
  assert.equal(forbidden('http://localhost:3000/'), false);
  assert.equal(forbidden('https://example.com:7070/'), false);
  assert.equal(forbidden('https://github.com/'), false);
  assert.equal(forbidden('::not a url'), true);
});
