#!/bin/bash
# Keeps a `claude --remote-control` host alive in a tmux session for this machine's
# whole lifetime (foreground, so the Fly Machine stays up until the portal stops it).
# tmux lets the Claude app spawn extra sessions inside this same container/env.
set -u
WD="${1:-$HOME/workspace}"
SESSION=claude
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
export HOME=/home/claude

# make the environment's secrets available to claude + every Bash tool it spawns
[ -f "$HOME/.secrets" ] && { set -a; . "$HOME/.secrets"; set +a; }

start() {
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  tmux new-session -d -s "$SESSION" -c "$WD" \
    "claude --remote-control --dangerously-skip-permissions"
  echo "[supervisor] started remote-control host in $WD"
}

start
while true; do
  if ! pgrep -u "$(id -u)" -f 'claude --remote-control' >/dev/null 2>&1; then
    echo "[supervisor] host gone; restarting"
    start
  fi
  sleep 20
done
