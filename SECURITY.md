# Security

tabshare exposes part of your browser to the internet. This document lists what it protects,
what it can't protect, and how to report problems.

## Reporting a vulnerability

Please report privately through **GitHub → Security → Report a vulnerability** on this repository,
not as a public issue. Include steps to reproduce. We aim to respond within 7 days.

## Threat model

**Assets:** your logged-in sessions (cookies), your other tabs, your machine and local network,
and the share links themselves.

**Who could attack:**
- Anyone who obtains a share link.
- A viewer who abuses control.
- Websites you visit, which might attack the local admin API.
- Other processes on your machine.

### What tabshare guarantees

| Property | How |
| --- | --- |
| **Cookie values never leave your machine** | Viewers receive only JPEG frames. The admin API returns cookie *domains and counts*, never names or values. Cookies are copied only into an isolated browser that runs locally. |
| **Only the viewer endpoint is public** | The tunnel points at the viewer server (`:7071`), which serves 3 static files and one WebSocket. The admin server (`:7070`) binds to `127.0.0.1` and rejects any non-localhost `Host` header. That blocks requests through the tunnel and DNS rebinding. |
| **Unguessable, revocable links** | 192-bit random tokens, compared in constant time, plus expiry (enforced by timer), revoke, one-time and max-viewer limits. The token lives in the URL fragment, which browsers never send in HTTP requests or `Referer` headers, and the viewer page removes it from the address bar after reading it. |
| **Admin API is authenticated** | Every `/api` request needs a per-run secret (`#k=` in the printed admin link) in a custom header, and cross-site requests are rejected via `Sec-Fetch-Site`. Websites you visit can't call it (no CORS), and neither can other local users. |
| **Isolated browser can't reach your machine or LAN** | Requests and WebSockets from isolated shares to loopback, private, link-local and CGNAT addresses are blocked, both by literal IP and by DNS resolution. The shared page's own origin is the only exception, so you can still share `http://localhost:3000`. |
| **Isolated browser is sandboxed** | Headless Chrome runs with its sandbox enabled. Playwright disables it by default; tabshare turns it back on. Downloads are disabled, and popups are closed. |
| **Viewer input is constrained** | Every message is schema-validated, rate-limited (120/s) and replayed in order. Only mouse, wheel, plain keys and editing combos (Ctrl/Cmd + A/C/X/Y/Z and arrow, Backspace, Delete, Home, End) are accepted. **Ctrl+V is refused**, because in mirror mode it would paste *your* clipboard where the viewer can see it. Function keys and Alt combos are refused too. |
| **Can't share tabshare itself** | Tabs on the admin, viewer or DevTools ports can't be shared and are hidden from the tab list. |
| **DoS limits** | 4 KB WebSocket messages, a 5 s auth timeout, at most 50 unauthenticated sockets, 20 auth attempts per IP per minute, keepalive pings, and frames dropped for slow viewers instead of queued. |

### What tabshare can't protect you from

- **The people you share with.** In **mirror** mode, or **isolated + cookies + control**, the
  viewer can do anything on those sites that you could do with a mouse and keyboard: send messages,
  change settings, buy things. Share only with people you trust, keep expiries short, and prefer
  view-only.
- **Mirror mode is your real tab.** The network guard applies only to isolated shares. In mirror
  mode a viewer with control can follow links in your real, logged-in tab.
- **Anything visible on screen.** Viewers see everything rendered on the page, including personal
  details, notifications shown in the page, and autofilled values.
- **DNS rebinding with very short TTLs.** tabshare resolves hostnames before allowing a request, but
  Chrome resolves them again itself, so a deliberately crafted rebinding attack is theoretically
  possible. Run isolated shares on a machine whose local services require authentication.
- **The local DevTools port.** `npm run chrome` opens Chrome's DevTools protocol on `127.0.0.1:9222`.
  Any process running as you can control that Chrome profile while it's open. This is inherent to
  how tabshare attaches to Chrome. Close that Chrome window when you're not sharing. The profile
  directory is created with mode `700`.
- **Cloudflare.** Quick tunnels terminate TLS at Cloudflare, so Cloudflare can technically see the
  frames. Use a named tunnel with Cloudflare Access if you need viewer authentication.

## Hardening tips

- Prefer **isolated** mode without cookies, and **view-only** links.
- Use **one-time** links and short expiries.
- For recurring use, set up a named tunnel and put **Cloudflare Access** in front of it, so viewers
  must also sign in.
- Stop tabshare (Ctrl+C) when you're done. That revokes every link immediately.
