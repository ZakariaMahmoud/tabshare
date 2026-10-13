import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { parseTunnelUrl, startTunnel } from '../src/tunnel.js';

const quietLog = { warn() {} };
const REGISTERED = 'INF Registered tunnel connection connIndex=0 location=ams01 protocol=http2\n';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

test('parseTunnelUrl extracts the quick tunnel URL', () => {
  const line = '2026-10-13 INF |  https://brave-lion-fox.trycloudflare.com  |';
  assert.equal(parseTunnelUrl(line), 'https://brave-lion-fox.trycloudflare.com');
  assert.equal(parseTunnelUrl('no url here'), null);
});

test('startTunnel resolves once cloudflared prints the URL and targets the viewer port', async () => {
  const child = fakeChild();
  let args;
  const promise = startTunnel({ bin: 'cloudflared', port: 7071, log: quietLog, spawnFn: (_bin, a) => ((args = a), child) });
  child.stderr.emit('data', Buffer.from('starting...\n'));
  child.stderr.emit('data', Buffer.from('https://abc-def.trycloudflare.com\n'));
  let resolved = false;
  promise.then(() => (resolved = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(resolved, false, 'must wait for an edge connection before handing out the URL');
  child.stderr.emit('data', Buffer.from(REGISTERED));
  const tunnel = await promise;
  assert.equal(tunnel.url, 'https://abc-def.trycloudflare.com');
  assert.ok(args.includes('http://127.0.0.1:7071'));
  assert.deepEqual(args.slice(2, 4), ['--protocol', 'http2']);
  tunnel.stop();
  assert.equal(child.killed, true);
});

test('startTunnel rejects if cloudflared exits first', async () => {
  const child = fakeChild();
  const promise = startTunnel({ bin: 'x', port: 1, log: quietLog, spawnFn: () => child });
  child.emit('exit', 1);
  await assert.rejects(promise, /exited early/);
});

test('startTunnel rejects if cloudflared cannot be spawned', async () => {
  const child = fakeChild();
  const promise = startTunnel({ bin: 'x', port: 1, log: quietLog, spawnFn: () => child });
  child.emit('error', new Error('ENOENT'));
  await assert.rejects(promise, /ENOENT/);
});

test('startTunnel times out with a hint when the edge is unreachable', async () => {
  const child = fakeChild();
  const warnings = [];
  const promise = startTunnel({ bin: 'x', port: 1, timeoutMs: 20, log: { warn: (m) => warnings.push(m) }, spawnFn: () => child });
  child.stderr.emit('data', Buffer.from('https://a-b.trycloudflare.com\nERR Failed to dial a quic connection\n'));
  await assert.rejects(promise, /port 7844/);
  assert.equal(child.killed, true);
  assert.equal(warnings.length, 1);
});
