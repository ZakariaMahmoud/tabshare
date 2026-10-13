import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' blob:; connect-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cache-Control': 'no-store',
});

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export function sendJson(res, status, payload) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export const sendError = (res, err, log) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) log.error(`[http] ${err.stack ?? err.message}`);
  sendJson(res, status, { ok: false, error: status >= 500 ? 'internal error' : err.message });
};

/** Loads public/<name> files into memory once and returns a request handler map. */
export function loadStatic(names) {
  const files = new Map(
    names.map((name) => [
      `/${name}`,
      { body: readFileSync(new URL(`../public/${name}`, import.meta.url)), type: MIME[extname(name)] },
    ]),
  );
  return (path, res) => {
    const file = files.get(path);
    if (!file) return false;
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': file.type });
    res.end(file.body);
    return true;
  };
}

export function readJsonBody(req, limitBytes = 16_384) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      reject(new HttpError(415, 'content-type must be application/json'));
      return;
    }
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        // Stop buffering but keep draining, so the client still receives the 413 response.
        if (!tooLarge) reject(new HttpError(413, 'request body too large'));
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Starts listening on 127.0.0.1; rejects (e.g. EADDRINUSE) instead of crashing the process. */
export function listenLocal(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/** Fixed-window limiter keyed by client (e.g. IP). */
export function createRateLimiter({ max, windowMs, now = Date.now }) {
  const hits = new Map();
  return Object.freeze({
    allow(key) {
      const t = now();
      const entry = hits.get(key);
      const fresh = !entry || t - entry.start >= windowMs;
      const next = fresh ? { start: t, count: 1 } : { start: entry.start, count: entry.count + 1 };
      hits.set(key, next);
      return next.count <= max;
    },
    prune() {
      const t = now();
      for (const [key, entry] of hits) if (t - entry.start >= windowMs) hits.delete(key);
    },
  });
}
