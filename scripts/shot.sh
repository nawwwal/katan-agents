#!/usr/bin/env bash
# Deterministic screenshot of the Katan board for visual QA.
#
#   scripts/shot.sh <out.png> [query] [WxH] [settle_seconds]
#
# Examples:
#   scripts/shot.sh /tmp/a.png                      # default board view
#   scripts/shot.sh /tmp/b.png "seed=7&populate=0"  # empty island, different seed
#   scripts/shot.sh /tmp/c.png "" 2560x1440 10      # 1440p, longer settle
#
# Requires `npm run dev` on 127.0.0.1:5173. Fails loudly on WebGL/console errors.
set -euo pipefail

OUT="${1:?usage: shot.sh <out.png> [query] [WxH] [settle]}"
QUERY="${2:-}"
SIZE="${3:-1920x1200}"
SETTLE="${4:-7}"
URL="http://127.0.0.1:5173/?board${QUERY:+&$QUERY}"

if ! curl -sf -o /dev/null "http://127.0.0.1:5173/"; then
  echo "dev server not running: start it with 'npm run dev' first" >&2
  exit 1
fi

agent-browser set viewport ${SIZE%x*} ${SIZE#*x} >/dev/null 2>&1 || true
agent-browser open "$URL" >/dev/null
agent-browser set viewport ${SIZE%x*} ${SIZE#*x} >/dev/null 2>&1 || true
sleep "$SETTLE"

# Fail the shot rather than silently grading a blank canvas.
STATUS=$(agent-browser eval '(()=>{const c=document.querySelector("canvas");if(!c)return "ERROR: no canvas";const g=c.getContext("webgl2")||c.getContext("webgl");if(!g)return "ERROR: no webgl context";return c.width+"x"+c.height})()' 2>&1 | tail -1)
case "$STATUS" in *ERROR*) echo "$STATUS" >&2; exit 1;; esac

agent-browser screenshot "$OUT" >/dev/null
echo "$OUT  canvas=$STATUS  url=$URL"
