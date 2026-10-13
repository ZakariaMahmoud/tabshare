#!/usr/bin/env node
import { createAdminServer } from './admin-server.js';
import { connectUserChrome, createIsolatedBrowserProvider, createTabRegistry, safeTitle } from './browser.js';
import { loadConfig } from './config.js';
import { createHub } from './hub.js';
import { createShareManager } from './manager.js';
import { streamSettings } from './quality.js';
import { openSession } from './session.js';
import { createShareStore } from './shares.js';
import { applyInput, startStreamer } from './streamer.js';
import { createForbiddenTargetCheck } from './net-guard.js';
import { newToken } from './tokens.js';
import { startTunnel } from './tunnel.js';
import { createViewerServer } from './viewer-server.js';

const log = console;
const SWEEP_INTERVAL_MS = 15_000;

async function connectChrome(cdpUrl) {
  try {
    const browser = await connectUserChrome(cdpUrl);
    log.info(`[chrome] connected to ${cdpUrl}`);
    return browser;
  } catch (err) {
    log.error(`[chrome] could not connect to ${cdpUrl}: ${err.message}`);
    log.error('[chrome] start Chrome with `npm run chrome`, then restart tabshare.');
    return null;
  }
}

async function listenOrExplain(server, port, envVar) {
  try {
    await server.listen();
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    log.error(`[tabshare] port ${port} is already in use by another program.`);
    log.error(`[tabshare] pick a free one, e.g. ${envVar}=${port + 10} npm start`);
    process.exit(1);
  }
}

async function openPublicUrl(config) {
  if (config.publicUrl) return { url: config.publicUrl, stop: () => {} };
  if (!config.tunnelEnabled) return { url: null, stop: () => {} };
  log.info('[tunnel] starting Cloudflare quick tunnel…');
  return startTunnel({ bin: config.cloudflaredBin, port: config.viewerPort, protocol: config.tunnelProtocol, log });
}

async function main() {
  const config = loadConfig();
  const userBrowser = await connectChrome(config.cdpUrl);
  const isolatedBrowsers = createIsolatedBrowserProvider({ channel: config.chromeChannel, sandbox: config.chromeSandbox });
  const adminKey = newToken();
  const cdpPort = Number(new URL(config.cdpUrl).port || 80);
  const isForbiddenUrl = createForbiddenTargetCheck([config.adminPort, config.viewerPort, cdpPort]);
  const tabs = createTabRegistry();
  let publicUrl = null;

  const manager = createShareManager({
    store: createShareStore(),
    tabs,
    limits: config.limits,
    getPublicUrl: () => publicUrl,
    getTitle: safeTitle,
    isForbiddenUrl,
    openSession: ({ share, tabPage }) =>
      openSession({
        share,
        tabPage,
        isolatedBrowsers,
        viewport: config.viewport,
        deviceScaleFactor: streamSettings(share.quality, share.mode, config.jpegQuality).deviceScaleFactor,
      }),
    makeHub: ({ share, session }) =>
      createHub({
        share,
        session,
        startStreamer,
        applyInput,
        stream: streamSettings(share.quality, share.mode, config.jpegQuality),
        log,
      }),
    log,
  });

  const viewer = createViewerServer({ port: config.viewerPort, manager, log });
  const admin = createAdminServer({
    port: config.adminPort,
    adminKey,
    isForbiddenUrl,
    manager,
    tabs,
    getUserBrowser: () => userBrowser,
    getPublicUrl: () => publicUrl,
    log,
  });
  await listenOrExplain(viewer, config.viewerPort, 'TABSHARE_VIEWER_PORT');
  await listenOrExplain(admin, config.adminPort, 'TABSHARE_ADMIN_PORT');

  const tunnel = await openPublicUrl(config).catch((err) => {
    log.error(`[tunnel] ${err.message}`);
    return { url: null, stop: () => {} };
  });
  publicUrl = tunnel.url;

  const sweeper = setInterval(() => manager.sweep(), SWEEP_INTERVAL_MS);

  log.info('');
  log.info(`  Admin (this machine only): http://127.0.0.1:${config.adminPort}/#k=${adminKey}`);
  log.info(`  Public viewer URL:         ${publicUrl ?? '(no tunnel — set TABSHARE_PUBLIC_URL or enable the tunnel)'}`);
  log.info('');

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`\n[tabshare] ${signal} — revoking shares and shutting down`);
    clearInterval(sweeper);
    await manager.closeAll();
    tunnel.stop();
    await Promise.allSettled([viewer.close(), admin.close(), isolatedBrowsers.close()]);
    // Disconnect from (never close) the user's own Chrome.
    await userBrowser?.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error(err.stack ?? err.message);
  process.exit(1);
});
