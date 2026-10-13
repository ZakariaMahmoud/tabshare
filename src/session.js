import { lookup } from 'node:dns/promises';
import { filterCookiesByDomains } from './cookies.js';
import { createDnsGuard, createRequestPolicy } from './net-guard.js';

const NAV_TIMEOUT_MS = 30_000;
const dnsGuard = createDnsGuard({ lookup });

/** Stops a viewer with control from using the isolated browser to reach your machine or LAN. */
async function guardPrivateNetwork(context, sharedUrl) {
  const isAllowed = createRequestPolicy(sharedUrl);
  const sharedOrigin = new URL(sharedUrl).origin;
  const isSafe = async (href) => {
    if (!isAllowed(href)) return false;
    const url = new URL(href);
    if (url.origin === sharedOrigin || !/^(https?|wss?):$/.test(url.protocol)) return true;
    return dnsGuard(url.hostname);
  };
  await context.route('**/*', async (route) =>
    (await isSafe(route.request().url())) ? route.continue() : route.abort('blockedbyclient'),
  );
  await context.routeWebSocket(/.*/, async (ws) => {
    if (await isSafe(ws.url())) ws.connectToServer();
    else ws.close({ code: 1008, reason: 'blocked by tabshare' });
  });
}

/**
 * Opens the page a share streams.
 *  - mirror:   your real tab, as-is.
 *  - isolated: a fresh headless context on your machine, optionally seeded with the
 *              cookies of the selected domains. Cookies never leave your machine —
 *              viewers only ever receive rendered frames.
 */
export async function openSession({ share, tabPage, isolatedBrowsers, viewport, deviceScaleFactor = 1 }) {
  if (share.mode === 'mirror') {
    return Object.freeze({ page: tabPage, close: async () => {} });
  }

  const browser = await isolatedBrowsers.get();
  const context = await browser.newContext({ viewport, deviceScaleFactor, acceptDownloads: false });
  try {
    await guardPrivateNetwork(context, share.tabUrl);
    if (share.includeCookies) {
      const cookies = filterCookiesByDomains(await tabPage.context().cookies(), share.cookieDomains);
      if (cookies.length > 0) await context.addCookies(cookies);
    }
    const page = await context.newPage();
    // One page per share: popups / target=_blank tabs would be invisible to the viewer anyway.
    context.on('page', (popup) => {
      if (popup !== page) popup.close().catch(() => {});
    });
    await page.goto(share.tabUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    return Object.freeze({ page, close: () => context.close() });
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
}
