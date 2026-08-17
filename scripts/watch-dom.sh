#!/usr/bin/env bash
# watch-dom.sh — background watcher for a `browse` session: polls a JS probe via
# `browse eval` and EXITS as soon as its value changes, so the agent gets a turn
# to react immediately (never poll in a foreground loop — see lessons.md).
#
# Usage:
#   scripts/watch-dom.sh [-i interval_s] [-n max_iters] [-c context_expr] 'probe_expr'
#
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
# ALWAYS pair a background run of this with a timed deadman alarm (send_later,
# ~10 min) in case this process itself hangs or the daemon wedges.
set -u
INTERVAL=5; MAX=90; CTX=""
while getopts "i:n:c:" o; do case $o in
  i) INTERVAL=$OPTARG;; n) MAX=$OPTARG;; c) CTX=$OPTARG;;
esac; done
shift $((OPTIND-1))
PROBE=${1:?usage: watch-dom.sh [-i s] [-n iters] [-c ctx_expr] probe_expr}

probe() { browse eval "$PROBE" 2>/dev/null | sed -n 's/.*"result": *"\{0,1\}\([^"]*\)"\{0,1\},\{0,1\}$/\1/p' | head -1; }

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
    [ -n "$CTX" ] && browse eval "$CTX" 2>/dev/null
    exit 0
  fi
done
echo "no change after $((MAX*INTERVAL))s (still alive)"
exit 4
