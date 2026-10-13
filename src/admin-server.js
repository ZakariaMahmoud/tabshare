import { createServer } from 'node:http';
import { summarizeCookieDomains, suggestDomains } from './cookies.js';
import { HttpError, loadStatic, readJsonBody, sendError, sendJson } from './http.js';
import { tokensEqual } from './tokens.js';

const ADMIN_HEADER = 'x-tabshare-admin';

/** Rejects DNS-rebinding: only accept requests addressed to localhost on our port. */
export function isAllowedHost(hostHeader, port) {
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(String(hostHeader ?? '').toLowerCase());
}

/**
 * Every API call must carry the per-run admin key (printed in the terminal) in a custom header.
 * That stops other local processes/users, and browsers can't add a custom header cross-site
 * without a CORS preflight, which we never grant — so pages you visit can't CSRF it either.
 */
function requireAdmin(req, adminKey) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'cross-site request blocked');
  if (!tokensEqual(req.headers[ADMIN_HEADER], adminKey)) {
    throw new HttpError(401, 'missing or invalid admin key — open the admin link printed in the terminal');
  }
}

export function createAdminServer({ port, adminKey, manager, tabs, getUserBrowser, getPublicUrl, isForbiddenUrl = () => false, log }) {
  const serveStatic = loadStatic(['admin.html', 'admin.js', 'style.css']);

  const userBrowser = () => {
    const browser = getUserBrowser();
    if (!browser?.isConnected()) throw new HttpError(503, 'not connected to Chrome — run `npm run chrome` then restart tabshare');
    return browser;
  };

  async function cookieDomains(tabId) {
    const page = tabs.get(tabId);
    if (!page) throw new HttpError(404, 'tab not found — refresh the tab list');
    const summary = summarizeCookieDomains(await page.context().cookies());
    return { domains: summary, suggested: suggestDomains(page.url(), summary) };
  }

  async function route(req, res, path) {
    const { method } = req;
    requireAdmin(req, adminKey);
    if (method === 'GET' && path === '/api/status') {
      return sendJson(res, 200, { ok: true, data: { publicUrl: getPublicUrl(), chromeConnected: Boolean(getUserBrowser()?.isConnected()) } });
    }
    if (method === 'GET' && path === '/api/tabs') {
      const list = await tabs.list(userBrowser());
      return sendJson(res, 200, { ok: true, data: list.filter((t) => !isForbiddenUrl(t.url)) });
    }
    const cookieMatch = path.match(/^\/api\/tabs\/([a-f0-9]{12})\/cookie-domains$/);
    if (method === 'GET' && cookieMatch) {
      return sendJson(res, 200, { ok: true, data: await cookieDomains(cookieMatch[1]) });
    }
    if (method === 'GET' && path === '/api/shares') {
      return sendJson(res, 200, { ok: true, data: manager.list() });
    }
    if (method === 'POST' && path === '/api/shares') {
      userBrowser();
      return sendJson(res, 201, { ok: true, data: await manager.create(await readJsonBody(req)) });
    }
    const shareMatch = path.match(/^\/api\/shares\/([a-f0-9]{12})$/);
    if (method === 'DELETE' && shareMatch) {
      if (!(await manager.revoke(shareMatch[1]))) throw new HttpError(404, 'share not found');
      return sendJson(res, 200, { ok: true, data: null });
    }
    throw new HttpError(404, 'not found');
  }

  const server = createServer(async (req, res) => {
    try {
      if (!isAllowedHost(req.headers.host, port)) throw new HttpError(421, 'admin UI is only available on localhost');
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && serveStatic(path === '/' ? '/admin.html' : path, res)) return;
      await route(req, res, path);
    } catch (err) {
      sendError(res, err, log);
    }
  });

  return Object.freeze({
    listen: () => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve)),
    close: () => new Promise((resolve) => server.close(resolve)),
  });
}
