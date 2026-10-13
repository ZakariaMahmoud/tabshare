import { spawn } from 'node:child_process';

const QUICK_TUNNEL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const REGISTERED_RE = /Registered tunnel connection/i;
const ERROR_RE = /\b(ERR|ERROR)\b/;

export const parseTunnelUrl = (text) => text.match(QUICK_TUNNEL_RE)?.[0] ?? null;

/**
 * Starts a Cloudflare quick tunnel pointing at the viewer server only.
 * Resolves with { url, stop } once cloudflared has printed the URL *and* registered a
 * connection to Cloudflare's edge — before that, the URL returns HTTP 530.
 *
 * protocol defaults to http2 (TCP) because many networks block QUIC/UDP, which makes
 * cloudflared's default retry forever.
 */
export function startTunnel({ bin, port, protocol = 'http2', timeoutMs = 45_000, spawnFn = spawn, log = console }) {
  return new Promise((resolve, reject) => {
    const args = ['tunnel', '--no-autoupdate', '--protocol', protocol, '--url', `http://127.0.0.1:${port}`];
    const child = spawnFn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;
    let url = null;
    let registered = false;

    const stop = () => {
      if (child.exitCode === null) child.kill('SIGTERM');
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      stop();
      const hint = url ? ' (got a URL but no edge connection — is outbound port 7844 blocked?)' : '';
      settle(reject, new Error(`cloudflared did not become ready within ${timeoutMs}ms${hint}`));
    }, timeoutMs);

    const onData = (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        url ??= parseTunnelUrl(line);
        registered ||= REGISTERED_RE.test(line);
        if (ERROR_RE.test(line)) log.warn(`[tunnel] ${line.trim()}`);
      }
      if (url && registered) settle(resolve, Object.freeze({ url, stop }));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => settle(reject, new Error(`failed to start cloudflared: ${err.message}`)));
    child.on('exit', (code) => {
      if (settled) log.warn(`[tunnel] cloudflared exited (code ${code}) — share links will stop working`);
      settle(reject, new Error(`cloudflared exited early with code ${code}`));
    });
  });
}
