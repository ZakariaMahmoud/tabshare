const positiveInt = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function loadConfig(env = process.env) {
  return Object.freeze({
    adminPort: positiveInt(env.TABSHARE_ADMIN_PORT, 7070),
    viewerPort: positiveInt(env.TABSHARE_VIEWER_PORT, 7071),
    cdpUrl: env.TABSHARE_CDP_URL ?? 'http://127.0.0.1:9222',
    // Set to use your own named tunnel / domain instead of a quick trycloudflare.com tunnel.
    publicUrl: env.TABSHARE_PUBLIC_URL?.replace(/\/+$/, '') || null,
    tunnelEnabled: env.TABSHARE_TUNNEL !== '0',
    cloudflaredBin: env.CLOUDFLARED_BIN ?? 'cloudflared',
    // http2 works on networks that block QUIC/UDP; set to 'quic' or 'auto' if you prefer.
    tunnelProtocol: env.TABSHARE_TUNNEL_PROTOCOL ?? 'http2',
    chromeChannel: env.TABSHARE_CHROME_CHANNEL ?? 'chrome',
    // Only disable if Chrome's sandbox cannot start on your system (e.g. some containers).
    chromeSandbox: env.TABSHARE_NO_SANDBOX !== '1',
    // Chrome's screencast accepts 0–100.
    jpegQuality: clamp(positiveInt(env.TABSHARE_JPEG_QUALITY, 70), 1, 100),
    viewport: Object.freeze({ width: 1280, height: 800 }),
    limits: Object.freeze({
      defaultTtlMinutes: 30,
      maxTtlMinutes: 24 * 60,
      maxViewers: 10,
    }),
  });
}
