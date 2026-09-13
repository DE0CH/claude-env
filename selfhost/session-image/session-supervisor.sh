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

# Pre-accept the workspace trust dialog for the dirs claude may open, so the
# interactive (tmux TTY) remote-control host doesn't block on "trust this folder?".
trust_dirs() {
  python3 - "$WD" <<'PY'
import json,os,sys
wd=sys.argv[1]; p=os.path.expanduser("~/.claude.json")
try: d=json.load(open(p))
except Exception: d={}
proj=d.setdefault("projects",{})
for path in {wd, os.path.expanduser("~/workspace"), os.path.expanduser("~")}:
    e=proj.setdefault(path,{})
    e["hasTrustDialogAccepted"]=True
    e["hasCompletedProjectOnboarding"]=True
    e.setdefault("allowedTools",[])
json.dump(d,open(p,"w"))
PY
}

start() {
  trust_dirs
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
