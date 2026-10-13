#!/usr/bin/env bash
# Launch Chrome with a dedicated profile and the DevTools port bound to localhost.
# Chrome 136+ refuses remote debugging on the default profile, so tabshare uses its own.
set -euo pipefail

PROFILE_DIR="${TABSHARE_PROFILE_DIR:-$HOME/.tabshare/chrome-profile}"
PORT="${TABSHARE_CDP_PORT:-9222}"

find_chrome() {
  if [[ -n "${CHROME_BIN:-}" ]]; then echo "$CHROME_BIN"; return; fi
  for c in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return; fi
  done
  local mac="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if [[ -x "$mac" ]]; then echo "$mac"; return; fi
  echo "Chrome not found. Set CHROME_BIN=/path/to/chrome" >&2
  exit 1
}

CHROME="$(find_chrome)"
mkdir -p "$PROFILE_DIR"
chmod 700 "$PROFILE_DIR"  # holds your cookies
echo "Starting Chrome (profile: $PROFILE_DIR, DevTools: 127.0.0.1:$PORT)"
exec "$CHROME" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  "$@"
