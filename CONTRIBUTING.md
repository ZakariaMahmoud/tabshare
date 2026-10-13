# Contributing

Thanks for helping improve tabshare!

## Setup

```bash
npm install
npm test            # unit + integration tests (no browser needed)
npm run coverage    # with coverage report
```

To try it end-to-end you need Google Chrome and [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) — see the README.

## Guidelines

- **Security first.** Anything reachable through the tunnel is internet-facing. Validate every
  viewer message (see `src/input.js`), never send cookie values off the machine, and keep the admin
  server bound to localhost. Read [SECURITY.md](SECURITY.md) before changing `viewer-server.js`,
  `admin-server.js`, `hub.js` or `session.js`.
- **Tests with every change.** Pure logic gets unit tests; servers get integration tests over real
  HTTP/WebSocket (`test/servers.test.js`). Browser-facing code takes injected dependencies so it can
  be tested with fakes.
- **No new runtime dependencies** without a good reason — the current set is `playwright-core` and `ws`.
- Small, focused modules; immutable data (records are `Object.freeze`d).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:` …).

## Reporting security issues

Please **don't** open a public issue — see [SECURITY.md](SECURITY.md).
