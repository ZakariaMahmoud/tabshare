import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { HttpError, createRateLimiter, loadStatic, sendError } from './http.js';

const AUTH_TIMEOUT_MS = 5000;
const MAX_MESSAGE_BYTES = 4096;
const CLOSE_POLICY = 1008;
const CLOSE_TRY_AGAIN = 1013;
const MAX_PENDING_AUTH = 50;
const KEEPALIVE_MS = 30_000;

// Behind cloudflared every request comes from 127.0.0.1; Cloudflare supplies the real client IP
// (and overwrites any client-sent value). Sanitized because it ends up in logs.
const clientKey = (req) =>
  String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '')
    .replace(/[^0-9a-fA-F:.]/g, '')
    .slice(0, 45) || 'unknown';

const REJECTIONS = {
  invalid: 'This link is invalid, expired or revoked.',
  full: 'This share already has the maximum number of viewers.',
  link_used: 'This one-time link has already been used.',
};

/**
 * Public-facing server (the only thing exposed through the tunnel). Serves the viewer page
 * and a WebSocket. The share token travels in the URL fragment (never sent in HTTP requests,
 * so it never appears in proxy logs) and is presented as the first WebSocket message.
 */
export function createViewerServer({ port, manager, log }) {
  const serveStatic = loadStatic(['viewer.html', 'viewer.js', 'style.css']);
  const authLimiter = createRateLimiter({ max: 20, windowMs: 60_000 });
  const pruneTimer = setInterval(() => authLimiter.prune(), 60_000).unref();

  const server = createServer((req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && serveStatic(path === '/' ? '/viewer.html' : path, res)) return;
      throw new HttpError(404, 'not found');
    } catch (err) {
      sendError(res, err, log);
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });
  let pendingAuth = 0;

  // Drop dead connections (closed laptops, flaky mobile) so they don't hold viewer slots.
  const keepalive = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) client.terminate();
      else {
        client.isAlive = false;
        client.ping();
      }
    }
  }, KEEPALIVE_MS).unref();

  wss.on('connection', (ws, req) => {
    if (pendingAuth >= MAX_PENDING_AUTH) {
      ws.close(CLOSE_TRY_AGAIN, 'busy');
      return;
    }
    pendingAuth += 1;
    let released = false;
    const release = () => {
      if (!released) pendingAuth -= 1;
      released = true;
    };
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('close', release);
    const key = clientKey(req);
    const reject = (message) => {
      ws.send(JSON.stringify({ type: 'error', message }));
      ws.close(CLOSE_POLICY, 'rejected');
    };
    const timer = setTimeout(() => reject('Authentication timed out.'), AUTH_TIMEOUT_MS);

    ws.once('message', async (data) => {
      clearTimeout(timer);
      release();
      if (!authLimiter.allow(key)) return reject('Too many attempts — try again in a minute.');
      let token;
      try {
        ({ token } = JSON.parse(data.toString()));
      } catch {
        return reject(REJECTIONS.invalid);
      }
      try {
        const result = typeof token === 'string' ? await manager.attachViewer(token, ws) : 'invalid';
        if (result !== 'ok') reject(REJECTIONS[result] ?? REJECTIONS.invalid);
        else log.info(`[viewer] connected from ${key}`);
      } catch (err) {
        log.error(`[viewer] attach failed: ${err.stack ?? err.message}`);
        reject('The shared tab could not be streamed.');
      }
    });
    ws.on('error', (err) => log.warn(`[viewer] socket error: ${err.message}`));
  });

  return Object.freeze({
    listen: () => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve)),
    close: () =>
      new Promise((resolve) => {
        clearInterval(pruneTimer);
        clearInterval(keepalive);
        for (const client of wss.clients) client.terminate();
        wss.close(() => server.close(resolve));
      }),
  });
}
