import { chromium } from 'playwright-core';
import { newId } from './tokens.js';

const TITLE_TIMEOUT_MS = 1000;
const isShareableUrl = (url) => /^https?:\/\//i.test(url);

/** Resolves with fallback if the promise does not settle in time (background tabs can stall). */
export function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

export const safeTitle = (page) => withTimeout(page.title(), TITLE_TIMEOUT_MS, '');

/** Attaches to the user's own Chrome via the DevTools protocol. */
export const connectUserChrome = (cdpUrl) => chromium.connectOverCDP(cdpUrl);

/** Lazily launches one headless Chrome used for isolated shares. */
export function createIsolatedBrowserProvider({ channel, sandbox = true }) {
  let pending = null;
  return Object.freeze({
    get() {
      // Playwright disables Chrome's sandbox by default; this browser renders untrusted pages
      // driven by a remote viewer, so keep it on.
      pending ??= chromium.launch({ channel, headless: true, chromiumSandbox: sandbox }).catch((err) => {
        pending = null;
        throw err;
      });
      return pending;
    },
    async close() {
      const browser = pending ? await pending.catch(() => null) : null;
      pending = null;
      await browser?.close();
    },
  });
}

/** Gives open tabs stable opaque ids so the admin UI can refer to them. */
export function createTabRegistry() {
  const idsByPage = new WeakMap();
  let pagesById = new Map();

  const idFor = (page) => {
    const existing = idsByPage.get(page);
    if (existing) return existing;
    const id = newId();
    idsByPage.set(page, id);
    return id;
  };

  return Object.freeze({
    async list(browser) {
      const pages = browser
        .contexts()
        .flatMap((ctx) => ctx.pages())
        .filter((p) => !p.isClosed() && isShareableUrl(p.url()));
      const tabs = await Promise.all(
        pages.map(async (page) => ({ id: idFor(page), url: page.url(), title: await safeTitle(page), page })),
      );
      pagesById = new Map(tabs.map((t) => [t.id, t.page]));
      return tabs.map(({ id, url, title }) => ({ id, url, title }));
    },
    get(id) {
      const page = pagesById.get(id);
      return page && !page.isClosed() ? page : null;
    },
  });
}
