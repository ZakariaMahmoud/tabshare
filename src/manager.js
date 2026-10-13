import { HttpError } from './http.js';
import { buildShare, validateShareRequest } from './shares.js';

/**
 * Owns the lifecycle of shares: create → viewers attach → revoke/expire.
 * Browser-facing pieces (tabs, openSession, makeHub) are injected for testability.
 */
export function createShareManager({
  store,
  tabs,
  openSession,
  makeHub,
  limits,
  getPublicUrl,
  getTitle,
  isForbiddenUrl = () => false,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log,
}) {
  const hubs = new Map();
  const timers = new Map();

  const describe = (share) =>
    Object.freeze({
      id: share.id,
      link: `${getPublicUrl() ?? 'http://127.0.0.1'}/#t=${share.token}`,
      tabUrl: share.tabUrl,
      tabTitle: share.tabTitle,
      mode: share.mode,
      quality: share.quality,
      includeCookies: share.includeCookies,
      cookieDomains: share.cookieDomains,
      allowControl: share.allowControl,
      maxViewers: share.maxViewers,
      oneTime: share.oneTime,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      viewers: hubs.get(share.id)?.viewerCount() ?? 0,
    });

  async function create(body) {
    const result = validateShareRequest(body, limits);
    if (!result.ok) throw new HttpError(400, result.error);
    const tabPage = tabs.get(result.value.tabId);
    if (!tabPage) throw new HttpError(404, 'tab not found — refresh the tab list');
    if (isForbiddenUrl(tabPage.url())) throw new HttpError(400, 'refusing to share tabshare’s own admin UI or Chrome’s DevTools');

    const share = buildShare(result.value, { url: tabPage.url(), title: await getTitle(tabPage) }, now());
    const session = await openSession({ share, tabPage }).catch((err) => {
      log.warn(`[share ${share.id}] could not open session: ${err.message}`);
      throw new HttpError(502, `could not open ${share.tabUrl} for sharing: ${err.message.split('\n')[0]}`);
    });
    hubs.set(share.id, makeHub({ share, session }));
    store.add(share);
    const timer = setTimer(() => {
      revoke(share.id, 'expired').catch((err) => log.warn(`[share ${share.id}] expire failed: ${err.message}`));
    }, share.expiresAt - now());
    timer?.unref?.();
    timers.set(share.id, timer);
    log.info(`[share ${share.id}] created (${share.mode}, cookies: ${share.includeCookies ? share.cookieDomains.join(',') : 'none'})`);
    return describe(share);
  }

  async function revoke(id, reason = 'revoked') {
    const share = store.remove(id);
    clearTimer(timers.get(id));
    timers.delete(id);
    const hub = hubs.get(id);
    hubs.delete(id);
    if (hub) await hub.close(reason);
    if (share) log.info(`[share ${id}] ${reason}`);
    return Boolean(share);
  }

  /** Returns 'ok', 'invalid', 'full' or 'link_used'. */
  async function attachViewer(token, ws) {
    const share = store.findByToken(token);
    const hub = share && share.expiresAt > now() ? hubs.get(share.id) : null;
    return hub ? hub.addViewer(ws) : 'invalid';
  }

  async function sweep() {
    for (const id of store.expiredIds(now())) {
      await revoke(id, 'expired').catch((err) => log.warn(`[share ${id}] expire failed: ${err.message}`));
    }
  }

  async function closeAll() {
    await Promise.allSettled(store.list().map((s) => revoke(s.id, 'server shutting down')));
  }

  return Object.freeze({ create, revoke, attachViewer, sweep, closeAll, list: () => store.list().map(describe) });
}
