import { isIP } from 'node:net';

// Blocks pages in isolated shares from reaching your machine or LAN (e.g. the admin UI on
// 127.0.0.1:7070, Chrome's DevTools port, your router). Hostnames are checked as written;
// a public DNS name that resolves to a private IP (DNS rebinding) is not caught here.

const PRIVATE_V4 = [
  [0x7f000000, 8], // 127.0.0.0/8 loopback
  [0x0a000000, 8], // 10.0.0.0/8
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local / cloud metadata
  [0x64400000, 10], // 100.64.0.0/10 CGNAT
  [0x00000000, 8], // 0.0.0.0/8
];

const v4ToInt = (ip) => ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
const inCidr = (ip, [base, bits]) => (v4ToInt(ip) & (bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0)) >>> 0 === base;

function isPrivateV6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return PRIVATE_V4.some((c) => inCidr(mapped[1], c));
  return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower); // fc00::/7 unique-local, fe80::/10 link-local
}

/** True if the hostname points at this machine or a private network. */
export function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const family = isIP(host);
  if (family === 4) return PRIVATE_V4.some((c) => inCidr(host, c));
  if (family === 6) return isPrivateV6(host);
  return false;
}

/**
 * Decides whether an isolated share may load a URL. The shared page's own origin is always
 * allowed, so sharing e.g. http://localhost:3000 still works — but nothing else local is.
 */
export function createRequestPolicy(sharedUrl) {
  const allowedOrigin = new URL(sharedUrl).origin;
  return (url) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.origin === allowedOrigin) return true;
    if (['data:', 'blob:', 'about:'].includes(parsed.protocol)) return true;
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return false;
    return !isPrivateHost(parsed.hostname);
  };
}

const DNS_CACHE_MAX = 1000;

/**
 * Async check that a hostname does not *resolve* to a private address, closing the gap where
 * a public DNS name points at 127.0.0.1. Results are cached briefly. Chrome resolves again
 * afterwards, so a deliberate short-TTL rebinding attack is still theoretically possible.
 */
export function createDnsGuard({ lookup, ttlMs = 60_000, now = Date.now }) {
  const cache = new Map();
  return async (hostname) => {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (isIP(host) || isPrivateHost(host)) return !isPrivateHost(host);
    const hit = cache.get(host);
    if (hit && now() - hit.at < ttlMs) return hit.safe;
    let safe;
    try {
      const addresses = await lookup(host, { all: true });
      safe = addresses.length > 0 && addresses.every((a) => !isPrivateHost(a.address));
    } catch {
      safe = false;
    }
    if (cache.size >= DNS_CACHE_MAX) cache.clear();
    cache.set(host, { safe, at: now() });
    return safe;
  };
}

/** True for URLs pointing at tabshare itself or Chrome's DevTools port — never shareable. */
export function createForbiddenTargetCheck(ports) {
  const blocked = new Set(ports.map(Number));
  return (url) => {
    try {
      const u = new URL(url);
      const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
      return isPrivateHost(u.hostname) && blocked.has(port);
    } catch {
      return true;
    }
  };
}
