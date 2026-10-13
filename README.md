# tabshare

Share a Chrome tab with someone, anywhere, through a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). No port forwarding and no account needed.

You choose **how much** to share for each link:

| Option | What it does |
| --- | --- |
| **Isolated copy** *(default)* | Opens the tab's URL in a separate headless browser on your machine and streams that. The viewer can't see your other tabs. |
| ↳ **Include my cookies** | Copies cookies for the domains **you tick** into that isolated browser, so the page loads logged in. |
| **Mirror my real tab** | Streams your actual tab, exactly as you see it. |
| **Allow control** | The viewer can click, scroll and type. Off by default, so links are view-only. |
| **One-time link** | Only the first person to open the link gets in. |
| **Expiry / max viewers** | Links stop working after N minutes. You can also revoke a link at any time. |

<p align="center">
  <img src="docs/images/admin.png" alt="tabshare admin page: pick a tab, choose cookies and control, create a share link" width="49%">
  <img src="docs/images/viewer.png" alt="What the viewer sees: the shared tab streamed live in their browser" width="49%">
</p>

> **Cookies never leave your machine.** In every mode the viewer receives only JPEG frames of the
> rendered page, never cookie values, HTML or network traffic. Including cookies means "render the
> page as me", not "hand over my session".

```
 your machine                                                   anywhere
┌──────────────────────────────────────────────┐
│ Chrome (tabshare profile, DevTools on :9222)  │
│        ▲ CDP                                  │
│ tabshare ── admin UI  127.0.0.1:7070  (local) │
│          └─ viewer    127.0.0.1:7071 ◄── cloudflared ◄──── https://xyz.trycloudflare.com/#t=…
└──────────────────────────────────────────────┘
```

## Requirements

- Node.js 20+ (22.5+ for `npm run coverage`)
- Google Chrome (or Chromium)
- [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)

## Quick start

```bash
git clone https://github.com/ZakariaMahmoud/tabshare && cd tabshare
npm install
```

1. **Start Chrome with tabshare's profile.** It opens a separate Chrome window. Log in to whatever you want to share in that window.

   ```bash
   npm run chrome
   ```

2. **Start tabshare** in a second terminal:

   ```bash
   npm start
   ```

   ```
   Admin (this machine only): http://127.0.0.1:7070/#k=<per-run admin key>
   Public viewer URL:         https://random-words.trycloudflare.com
   ```

3. Open the **admin link printed in the terminal**. It includes a per-run key, so the plain URL won't work. Pick a tab, choose your options and click **Create share link**.
   Send the link to whoever you want. Click **Stop sharing** to revoke it.

> **Why a separate Chrome profile?** Chrome (136+) does not allow remote debugging on your default
> profile, and keeping it separate means tabshare can only ever see the tabs you open there.

## Configuration

All settings are environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `TABSHARE_ADMIN_PORT` | `7070` | Local admin UI port |
| `TABSHARE_VIEWER_PORT` | `7071` | Viewer server port (the only one exposed by the tunnel) |
| `TABSHARE_CDP_URL` | `http://127.0.0.1:9222` | Chrome DevTools endpoint |
| `TABSHARE_PUBLIC_URL` | — | Use your own [named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/) / domain instead of a quick tunnel. Point it at the viewer port. |
| `TABSHARE_TUNNEL` | `1` | `0` disables the built-in quick tunnel |
| `TABSHARE_TUNNEL_PROTOCOL` | `http2` | `cloudflared` transport. `http2` works on networks that block QUIC/UDP. |
| `CLOUDFLARED_BIN` | `cloudflared` | Path to `cloudflared` |
| `TABSHARE_CHROME_CHANNEL` | `chrome` | Browser used for isolated shares (`chrome`, `chromium`, `msedge`) |
| `TABSHARE_JPEG_QUALITY` | `70` | Stream quality (1–100) |
| `TABSHARE_NO_SANDBOX` | — | `1` disables Chrome's sandbox for isolated shares. Use this only if Chrome's sandbox can't start on your system (some containers). |
| `TABSHARE_PROFILE_DIR` | `~/.tabshare/chrome-profile` | Profile used by `npm run chrome` |
| `TABSHARE_CDP_PORT` | `9222` | DevTools port used by `npm run chrome` |

### Using a named tunnel (stable URL)

```bash
cloudflared tunnel create tabshare
cloudflared tunnel route dns tabshare share.example.com
cloudflared tunnel run --url http://127.0.0.1:7071 tabshare
# in another terminal
TABSHARE_PUBLIC_URL=https://share.example.com npm start
```

You can also put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) in front of the hostname to require viewers to sign in with email.

## Limitations

- **One tab per link.** To share several tabs, create a link for each.
- **Isolated shares are a single page.** Popups and links that open a new tab are closed, and
  downloads are disabled. The viewer can't type an address; they can only follow links on the page.
- **Mirror mode needs the tab in the foreground.** Chrome slows or pauses rendering for
  background tabs, so the stream can freeze until you switch back to it.
- **Keyboard control is limited to safe keys.** Viewers can type, use arrows/Tab/Enter, and use
  Ctrl/Cmd + A, C, X, Y, Z. Ctrl/Cmd + V is blocked, because it would paste *your* clipboard. Viewers
  can paste their own text with their usual paste shortcut.
- **Video is JPEG frames.** It's tuned for reading and clicking, not for watching videos. Raise
  `TABSHARE_JPEG_QUALITY` for sharper text at the cost of bandwidth.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `port 7070 is already in use by another program` | Pick free ports, e.g. `TABSHARE_ADMIN_PORT=7080 TABSHARE_VIEWER_PORT=7081 npm start`. |
| The public URL shows **error 530** | The tunnel isn't connected to Cloudflare yet. tabshare waits for the connection before printing the URL. If it times out, your network may block outbound port 7844. |
| `Chrome NOT connected` on the admin page | Start Chrome with `npm run chrome` first, then restart tabshare. Make sure nothing else is using port 9222. |
| `401 missing or invalid admin key` | Open the full admin link printed in the terminal, including the `#k=…` part. The key changes every time tabshare restarts. |
| A tab isn't in the list | Only `http(s)` tabs in the tabshare Chrome window are listed, not your normal Chrome. Click **Refresh**. |
| Isolated shares fail to start in a container | Chrome's sandbox may be unavailable there. Set `TABSHARE_NO_SANDBOX=1`, and read [SECURITY.md](SECURITY.md) first. |

## How it works

- tabshare attaches to your Chrome over the DevTools protocol (Playwright `connectOverCDP`).
- Each share streams a page using `Page.startScreencast`. Frames are fanned out over a WebSocket and the stream runs only while someone is watching.
- **Isolated** shares run in a fresh headless browser context on your machine. Cookies are seeded from your profile, filtered to the domains you selected.
- The share token lives in the URL **fragment** (`#t=…`). Browsers never send fragments in HTTP requests, so the token doesn't show up in Cloudflare or proxy logs. The viewer page sends it as the first WebSocket message and then removes it from the address bar.
- Viewer input is validated against a strict schema (`src/input.js`) and replayed in order with Playwright's mouse and keyboard APIs.

## Security

Read [SECURITY.md](SECURITY.md) for the threat model. In short:

- Only share links with people you trust. With **mirror** mode, or with **cookies plus control**, the viewer can act as you on those sites.
- Keep expiries short, and revoke links when you're done. Stopping tabshare revokes everything.
- The admin UI is bound to `127.0.0.1`, requires a per-run key, and is never exposed through the tunnel.
- Isolated shares run in a sandboxed browser that is blocked from reaching your machine or local network.

## Development

```bash
npm test          # unit + integration tests, no browser needed
npm run coverage  # needs Node 22.5+
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Ideas and feature requests are welcome as
[issues](https://github.com/ZakariaMahmoud/tabshare/issues).

## License

[MIT](LICENSE)
