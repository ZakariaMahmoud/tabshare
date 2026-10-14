import { normalizeDomain } from './cookies.js';
import { QUALITY_NAMES } from './quality.js';
import { newId, newToken, tokensEqual } from './tokens.js';

const MODES = new Set(['mirror', 'isolated']);
const DOMAIN_RE = /^\.?[a-z0-9-]+(\.[a-z0-9-]+)*$/i;
const TAB_ID_RE = /^[a-f0-9]{12}$/;
const MAX_DOMAINS = 100;

const fail = (error) => ({ ok: false, error });
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isValidDomain = (d) =>
  typeof d === 'string' &&
  d.length <= 253 &&
  DOMAIN_RE.test(d) &&
  (d.replace(/^\./, '').includes('.') || /^\.?localhost$/i.test(d));

function checkTypes(req) {
  if (!TAB_ID_RE.test(String(req.tabId))) return 'tabId is invalid';
  if (!MODES.has(req.mode)) return 'mode must be "mirror" or "isolated"';
  if (!QUALITY_NAMES.includes(req.quality)) return `quality must be one of ${QUALITY_NAMES.join(', ')}`;
  for (const key of ['includeCookies', 'allowControl', 'oneTime']) {
    if (typeof req[key] !== 'boolean') return `${key} must be a boolean`;
  }
  if (!Array.isArray(req.cookieDomains) || req.cookieDomains.length > MAX_DOMAINS) {
    return `cookieDomains must be an array of at most ${MAX_DOMAINS} domains`;
  }
  if (!req.cookieDomains.every(isValidDomain)) return 'cookieDomains contains an invalid domain';
  return null;
}

const MIN_LIFETIME_MS = 60_000;

/** Resolves the absolute expiry from either `ttlMinutes` or an explicit `expiresAt` (epoch ms). */
function resolveExpiry(body, limits, now) {
  const maxMs = limits.maxTtlMinutes * 60_000;
  if (body.expiresAt !== undefined && body.ttlMinutes !== undefined) {
    return { error: 'use either ttlMinutes or expiresAt, not both' };
  }
  if (body.expiresAt === undefined) {
    const ttlMinutes = body.ttlMinutes ?? limits.defaultTtlMinutes;
    if (!isInt(ttlMinutes, 1, limits.maxTtlMinutes)) {
      return { error: `ttlMinutes must be an integer between 1 and ${limits.maxTtlMinutes}` };
    }
    return { expiresAt: now + ttlMinutes * 60_000 };
  }
  const { expiresAt } = body;
  if (!Number.isInteger(expiresAt)) return { error: 'expiresAt must be a timestamp in milliseconds' };
  if (expiresAt < now + MIN_LIFETIME_MS) return { error: 'expiry must be at least 1 minute in the future' };
  if (expiresAt > now + maxMs) return { error: `expiry can be at most ${limits.maxTtlMinutes / 60} hours from now` };
  return { expiresAt };
}

function checkRules(req, limits) {
  if (req.mode === 'mirror' && req.includeCookies) {
    return 'includeCookies only applies to isolated mode (mirror already shows your real tab)';
  }
  if (req.includeCookies && req.cookieDomains.length === 0) return 'select at least one cookie domain';
  if (!isInt(req.maxViewers, 1, limits.maxViewers)) {
    return `maxViewers must be an integer between 1 and ${limits.maxViewers}`;
  }
  return null;
}

/** Validates an untrusted share request from the admin API and applies defaults. */
export function validateShareRequest(body, limits, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('body must be a JSON object');
  const req = {
    tabId: body.tabId,
    mode: body.mode ?? 'isolated',
    quality: body.quality ?? 'standard',
    includeCookies: body.includeCookies ?? false,
    cookieDomains: body.cookieDomains ?? [],
    allowControl: body.allowControl ?? false,
    oneTime: body.oneTime ?? false,
    maxViewers: body.maxViewers ?? 1,
  };
  const error = checkTypes(req) ?? checkRules(req, limits);
  if (error) return fail(error);
  const expiry = resolveExpiry(body, limits, now);
  if (expiry.error) return fail(expiry.error);
  const cookieDomains = req.includeCookies ? [...new Set(req.cookieDomains.map(normalizeDomain))] : [];
  return { ok: true, value: Object.freeze({ ...req, expiresAt: expiry.expiresAt, cookieDomains: Object.freeze(cookieDomains) }) };
}

/** Builds an immutable share record from a validated request. */
export function buildShare(request, tab, now) {
  return Object.freeze({
    ...request,
    id: newId(),
    token: newToken(),
    tabUrl: tab.url,
    tabTitle: tab.title,
    createdAt: now,
  });
}

export function createShareStore() {
  const shares = new Map();
  return Object.freeze({
    add(share) {
      shares.set(share.id, share);
      return share;
    },
    get: (id) => shares.get(id) ?? null,
    list: () => [...shares.values()],
    remove(id) {
      const share = shares.get(id) ?? null;
      shares.delete(id);
      return share;
    },
    findByToken(token) {
      return [...shares.values()].find((s) => tokensEqual(s.token, token)) ?? null;
    },
    expiredIds: (now) => [...shares.values()].filter((s) => s.expiresAt <= now).map((s) => s.id),
  });
}
