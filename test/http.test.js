import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowedHost } from '../src/admin-server.js';
import { loadConfig } from '../src/config.js';
import { createRateLimiter } from '../src/http.js';
import { tokensEqual } from '../src/tokens.js';

test('admin host check blocks DNS rebinding and tunnel hosts', () => {
  assert.ok(isAllowedHost('127.0.0.1:7070', 7070));
  assert.ok(isAllowedHost('localhost:7070', 7070));
  assert.ok(isAllowedHost('[::1]:7070', 7070));
  assert.equal(isAllowedHost('evil.example:7070', 7070), false);
  assert.equal(isAllowedHost('x.trycloudflare.com', 7070), false);
  assert.equal(isAllowedHost('localhost:7071', 7070), false);
  assert.equal(isAllowedHost(undefined, 7070), false);
});

test('rate limiter allows max hits per window then resets', () => {
  let t = 0;
  const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => t });
  assert.ok(limiter.allow('ip'));
  assert.ok(limiter.allow('ip'));
  assert.equal(limiter.allow('ip'), false);
  assert.ok(limiter.allow('other'));
  t = 1000;
  limiter.prune();
  assert.ok(limiter.allow('ip'));
});

test('tokensEqual compares safely', () => {
  assert.ok(tokensEqual('abc', 'abc'));
  assert.equal(tokensEqual('abc', 'abcd'), false);
  assert.equal(tokensEqual('abc', undefined), false);
});

test('loadConfig reads env with safe fallbacks', () => {
  const c = loadConfig({ TABSHARE_ADMIN_PORT: '8000', TABSHARE_VIEWER_PORT: 'abc', TABSHARE_PUBLIC_URL: 'https://x.dev/', TABSHARE_TUNNEL: '0' });
  assert.equal(c.adminPort, 8000);
  assert.equal(c.viewerPort, 7071);
  assert.equal(c.publicUrl, 'https://x.dev');
  assert.equal(c.tunnelEnabled, false);
  assert.equal(c.jpegQuality, 70);
});

test('loadConfig clamps JPEG quality to the range Chrome accepts', () => {
  assert.equal(loadConfig({ TABSHARE_JPEG_QUALITY: '500' }).jpegQuality, 100);
  assert.equal(loadConfig({ TABSHARE_JPEG_QUALITY: '85' }).jpegQuality, 85);
  assert.equal(loadConfig({ TABSHARE_JPEG_QUALITY: '-5' }).jpegQuality, 70);
});
