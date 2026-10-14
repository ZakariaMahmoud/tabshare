import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShare, createShareStore, formatDuration, validateShareRequest } from '../src/shares.js';

const limits = { defaultTtlMinutes: 30, maxTtlMinutes: 1440, maxViewers: 10 };
const tabId = 'abcdef012345';

test('applies safe defaults', () => {
  const r = validateShareRequest({ tabId }, limits, 1000);
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r.value, cookieDomains: [...r.value.cookieDomains] }, {
    tabId, mode: 'isolated', quality: 'standard', includeCookies: false, cookieDomains: [], allowControl: false,
    oneTime: false, maxViewers: 1, expiresAt: 1000 + 30 * 60_000,
  });
  assert.ok(Object.isFrozen(r.value));
});

test('normalizes and dedupes cookie domains', () => {
  const r = validateShareRequest({ tabId, includeCookies: true, cookieDomains: ['.GitHub.com', 'github.com'] }, limits);
  assert.deepEqual([...r.value.cookieDomains], ['github.com']);
});

test('allows localhost as a cookie domain', () => {
  assert.equal(validateShareRequest({ tabId, includeCookies: true, cookieDomains: ['localhost'] }, limits).ok, true);
});

test('drops cookie domains when cookies are not included', () => {
  const r = validateShareRequest({ tabId, cookieDomains: ['github.com'] }, limits);
  assert.deepEqual([...r.value.cookieDomains], []);
});

const invalid = [
  [null, /JSON object/],
  [[], /JSON object/],
  [{ tabId: 'nope' }, /tabId/],
  [{ tabId, mode: 'spy' }, /mode/],
  [{ tabId, quality: 'ultra' }, /quality/],
  [{ tabId, allowControl: 'yes' }, /allowControl/],
  [{ tabId, cookieDomains: 'github.com' }, /cookieDomains/],
  [{ tabId, includeCookies: true, cookieDomains: ['bad domain!'] }, /invalid domain/],
  [{ tabId, includeCookies: true, cookieDomains: ['com'] }, /invalid domain/],
  [{ tabId, includeCookies: true, cookieDomains: ['.com'] }, /invalid domain/],
  [{ tabId, includeCookies: true, cookieDomains: Array(101).fill('a.com') }, /at most/],
  [{ tabId, includeCookies: true }, /at least one/],
  [{ tabId, mode: 'mirror', includeCookies: true, cookieDomains: ['a.com'] }, /isolated mode/],
  [{ tabId, ttlMinutes: 0 }, /at least 1 minute/],
  [{ tabId, ttlMinutes: 1441 }, /at most 1 day/],
  [{ tabId, ttlMinutes: 1.5 }, /whole number/],
  [{ tabId, maxViewers: 11 }, /maxViewers/],
];
for (const [body, pattern] of invalid) {
  test(`rejects ${JSON.stringify(body)?.slice(0, 60)}`, () => {
    const r = validateShareRequest(body, limits);
    assert.equal(r.ok, false);
    assert.match(r.error, pattern);
  });
}

test('buildShare creates an immutable record with secret token and expiry', () => {
  const { value } = validateShareRequest({ tabId, ttlMinutes: 5 }, limits, 1000);
  const share = buildShare(value, { url: 'https://example.com', title: 'Example' }, 1000);
  assert.match(share.id, /^[a-f0-9]{12}$/);
  assert.ok(share.token.length >= 32);
  assert.equal(share.expiresAt, 1000 + 5 * 60_000);
  assert.equal(share.tabUrl, 'https://example.com');
  assert.ok(Object.isFrozen(share));
});

test('store finds by token, lists expired and removes', () => {
  const store = createShareStore();
  const a = store.add(buildShare(validateShareRequest({ tabId, ttlMinutes: 1 }, limits, 0).value, { url: 'https://a', title: '' }, 0));
  const b = store.add(buildShare(validateShareRequest({ tabId, ttlMinutes: 1 }, limits, 100_000).value, { url: 'https://b', title: '' }, 100_000));
  assert.equal(store.findByToken(b.token), b);
  assert.equal(store.findByToken('wrong'), null);
  assert.equal(store.get(a.id), a);
  assert.deepEqual(store.expiredIds(60_000), [a.id]);
  assert.equal(store.remove(a.id), a);
  assert.equal(store.remove(a.id), null);
  assert.deepEqual(store.list(), [b]);
});

test('accepts an explicit expiry date and time', () => {
  const now = 1_000_000;
  const at = now + 3 * 60 * 60_000;
  const r = validateShareRequest({ tabId, expiresAt: at }, limits, now);
  assert.equal(r.ok, true);
  assert.equal(buildShare(r.value, { url: 'https://x', title: '' }, now).expiresAt, at);
});

test('rejects bad expiry times', () => {
  const now = 1_000_000;
  const check = (body, pattern) => {
    const r = validateShareRequest({ tabId, ...body }, limits, now);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.match(r.error, pattern);
  };
  check({ expiresAt: now - 1 }, /at least 1 minute/);
  check({ expiresAt: now + 30_000 }, /at least 1 minute/);
  check({ expiresAt: now + 25 * 60 * 60_000 }, /at most 1 day/);
  check({ expiresAt: '2026-10-14T18:00' }, /timestamp/);
  check({ expiresAt: now + 1.5 }, /timestamp/);
  check({ expiresAt: now + 120_000, ttlMinutes: 5 }, /either/);
});

test('a 7-day limit allows a link to expire up to a week ahead', () => {
  const week = { ...limits, maxTtlMinutes: 7 * 24 * 60 };
  const now = 1_000_000;
  assert.equal(validateShareRequest({ tabId, expiresAt: now + 6 * 24 * 60 * 60_000 }, week, now).ok, true);
  assert.equal(validateShareRequest({ tabId, ttlMinutes: 7 * 24 * 60 }, week, now).ok, true);
  const tooLate = validateShareRequest({ tabId, expiresAt: now + 8 * 24 * 60 * 60_000 }, week, now);
  assert.match(tooLate.error, /at most 7 days/);
  assert.match(validateShareRequest({ tabId, ttlMinutes: 7 * 24 * 60 + 1 }, week, now).error, /at most 7 days/);
});

test('formatDuration', () => {
  assert.equal(formatDuration(10080), '7 days');
  assert.equal(formatDuration(1440), '1 day');
  assert.equal(formatDuration(120), '2 hours');
  assert.equal(formatDuration(90), '90 minutes');
  assert.equal(formatDuration(1), '1 minute');
});
