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
  # Name the Remote Control session after the portal's label so the Claude app shows the
  # same name as the dashboard (instead of the auto "<hostname>-random-words").
  # SESSION_LABEL is in the machine env; the inner shell expands it (single quotes here).
  export SESSION_LABEL="${SESSION_LABEL:-}"
  # Model: default to Opus 4.8 (overridable via the machine env).
  export SESSION_MODEL="${SESSION_MODEL:-claude-opus-4-8}"
  # Permission mode: "auto" (default classifier auto-approve) or "bypass"
  # (--dangerously-skip-permissions). Defaults to auto.
  case "${SESSION_PERMISSION_MODE:-auto}" in
    bypass) export SESSION_PERM_FLAG="--dangerously-skip-permissions" ;;
    *)      export SESSION_PERM_FLAG="" ;;
  esac
  if [ -n "$SESSION_LABEL" ]; then
    # --remote-control <name> names it in the Claude app; --name sets the local display
    # name (the session registry the dashboard reads), so both start identical.
    CMD='claude --remote-control "$SESSION_LABEL" --name "$SESSION_LABEL" --model "$SESSION_MODEL" $SESSION_PERM_FLAG'
  else
    # No label => let the Claude session auto-generate (and later refine) its own title.
    CMD='claude --remote-control --model "$SESSION_MODEL" $SESSION_PERM_FLAG'
  fi
  # fixed 120x40 window: the dashboard's terminal panel mirrors this pane (tmux capture-pane)
  tmux new-session -d -s "$SESSION" -x 120 -y 40 -c "$WD" "$CMD"
  echo "[supervisor] started remote-control host in $WD (name: ${SESSION_LABEL:-auto}, model: $SESSION_MODEL, perm: ${SESSION_PERMISSION_MODE:-auto})"
}

start
while true; do
  if ! pgrep -u "$(id -u)" -f 'claude --remote-control' >/dev/null 2>&1; then
    echo "[supervisor] host gone; restarting"
    start
  fi
  sleep 20
done
