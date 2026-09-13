#!/usr/bin/env bash
# watch-dom.sh — background watcher for a browser page reachable over CDP: polls a
# JS probe (Playwright `connectOverCDP` → `page.evaluate`) and EXITS as soon as its
# value changes, so the agent gets a turn to react immediately (never poll in a
# foreground loop — see lessons.md). Works against any CDP endpoint, e.g. a
# mobilerun cloud phone's Chrome or claude-in-chrome on the Mac.
#
# Usage:
#   CONNECT_URL=ws://... scripts/watch-dom.sh [-i interval_s] [-n max_iters] [-c context_expr] 'probe_expr'
#
#   CONNECT_URL   CDP websocket URL of the browser (required). The probe runs in
#                 the first page of the first context (set PAGE_INDEX to pick
#                 another page).
#   probe_expr    JS expression returning a number or short string (e.g. a chat
#                 transcript's innerText length). Wrap risky DOM access in
#                 try/catch inside the expression; it should return -1 on
#                 "target not found" rather than throwing.
#   -i seconds    Poll interval (default 5).
#   -n iters      Max iterations before giving up (default 90).
#   -c expr       Optional JS evaluated once on change, to print context
#                 (e.g. the last 700 chars of the transcript).
#
# Exit codes: 0 = change detected (details on stdout)
#             2 = probe unusable (browser/page likely gone)
#             4 = no change after max_iters (still alive, just quiet)
#
# Needs global Playwright (NODE_PATH=$(npm root -g) is set below).
#
# ALWAYS pair a background run of this with a timed deadman alarm (send_later,
# ~10 min) in case this process itself hangs or the browser wedges.
set -u
INTERVAL=5; MAX=90; CTX=""
while getopts "i:n:c:" o; do case $o in
  i) INTERVAL=$OPTARG;; n) MAX=$OPTARG;; c) CTX=$OPTARG;;
esac; done
shift $((OPTIND-1))
PROBE=${1:?usage: CONNECT_URL=ws://... watch-dom.sh [-i s] [-n iters] [-c ctx_expr] probe_expr}
: "${CONNECT_URL:?CONNECT_URL (CDP websocket URL) must be set}"
export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null)}"

# Evaluate a JS expression in the page over a short-lived CDP connection; prints
# the result (or nothing on failure).
cdp_eval() {
  EXPR="$1" node -e '
    const { chromium } = require("playwright");
    (async () => {
      const b = await chromium.connectOverCDP(process.env.CONNECT_URL, { timeout: 15000 });
      try {
        const pages = b.contexts()[0].pages();
        const p = pages[parseInt(process.env.PAGE_INDEX || "0", 10)];
        if (!p) throw new Error("no page");
        const v = await p.evaluate(process.env.EXPR);
        process.stdout.write(String(v));
      } finally { await b.close().catch(() => {}); }
    })().catch(() => process.exit(1));
  ' 2>/dev/null
}
probe() { cdp_eval "$PROBE" | head -c 400; }

BASE=$(probe); FAILS=0
[ -z "$BASE" ] && { echo "PROBE UNUSABLE at start ($(date -u +%H:%M:%S))"; exit 2; }
echo "baseline: $BASE"
i=0
while [ $i -lt "$MAX" ]; do
  i=$((i+1)); sleep "$INTERVAL"
  V=$(probe)
  if [ -z "$V" ]; then
    FAILS=$((FAILS+1))
    [ $FAILS -ge 3 ] && { echo "PROBE FAILED x3 at $(date -u +%H:%M:%S) — browser/page likely gone"; exit 2; }
    continue
  fi
  FAILS=0
  if [ "$V" != "$BASE" ]; then
    echo "CHANGED '$BASE' -> '$V' at $(date -u +%H:%M:%S)"
    [ -n "$CTX" ] && { cdp_eval "$CTX"; echo; }
    exit 0
  fi
done
echo "no change after $((MAX*INTERVAL))s (still alive)"
exit 4
