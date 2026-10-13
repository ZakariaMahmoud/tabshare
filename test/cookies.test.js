import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterCookiesByDomains, normalizeDomain, suggestDomains, summarizeCookieDomains } from '../src/cookies.js';

const cookies = [
  { name: 'a', value: 'secret', domain: '.github.com' },
  { name: 'b', value: 'secret', domain: 'github.com' },
  { name: 'c', value: 'secret', domain: 'api.github.com' },
  { name: 'd', value: 'secret', domain: '.google.com' },
  { name: 'e', value: 'secret', domain: 'notgithub.com' },
];

test('normalizeDomain strips leading dot and lowercases', () => {
  assert.equal(normalizeDomain('.GitHub.com'), 'github.com');
});

test('summarizeCookieDomains counts per domain without exposing values', () => {
  const summary = summarizeCookieDomains(cookies);
  assert.deepEqual(summary, [
    { domain: 'api.github.com', count: 1 },
    { domain: 'github.com', count: 2 },
    { domain: 'google.com', count: 1 },
    { domain: 'notgithub.com', count: 1 },
  ]);
  assert.ok(!JSON.stringify(summary).includes('secret'));
});

test('filterCookiesByDomains includes subdomains but not lookalikes', () => {
  const names = filterCookiesByDomains(cookies, ['github.com']).map((c) => c.name);
  assert.deepEqual(names, ['a', 'b', 'c']);
});

test('filterCookiesByDomains returns nothing for no selection and does not mutate input', () => {
  const copy = structuredClone(cookies);
  assert.deepEqual(filterCookiesByDomains(cookies, []), []);
  assert.deepEqual(cookies, copy);
});

test('suggestDomains picks domains the page URL would send cookies to', () => {
  const summary = summarizeCookieDomains(cookies);
  assert.deepEqual(suggestDomains('https://api.github.com/x', summary), ['api.github.com', 'github.com']);
  assert.deepEqual(suggestDomains('not a url', summary), []);
});
