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
  # Resume the conversation. Priority: (1) a cross-machine move — entrypoint.sh placed the
  # transcript and set SESSION_RESUME_ID (unset if that failed). (2) Otherwise the newest
  # transcript already on this machine's rootfs: set on a stop/start WAKE (rootfs persists
  # while paused) or a host crash, so the same conversation continues instead of starting
  # blank. (3) Nothing on a brand-new machine -> a fresh session. All ids are uuids, so the
  # unquoted expansion below is safe.
  export SESSION_RESUME_FLAG=""
  local rid="${SESSION_RESUME_ID:-}"
  if [ -z "$rid" ]; then
    local latest; latest="$(ls -t "$HOME"/.claude/projects/*/*.jsonl 2>/dev/null | head -1)"
    [ -n "$latest" ] && rid="$(basename "$latest" .jsonl)"
  fi
  [ -n "$rid" ] && export SESSION_RESUME_FLAG="--resume $rid"
  if [ -n "$SESSION_LABEL" ]; then
    # --remote-control <name> names it in the Claude app; --name sets the local display
    # name (the session registry the dashboard reads), so both start identical.
    CMD='claude --remote-control "$SESSION_LABEL" --name "$SESSION_LABEL" --model "$SESSION_MODEL" $SESSION_PERM_FLAG $SESSION_RESUME_FLAG'
  else
    # No label => let the Claude session auto-generate (and later refine) its own title.
    CMD='claude --remote-control --model "$SESSION_MODEL" $SESSION_PERM_FLAG $SESSION_RESUME_FLAG'
  fi
  # fixed 120x40 window: the dashboard's terminal panel mirrors this pane (tmux capture-pane)
  tmux new-session -d -s "$SESSION" -x 120 -y 40 -c "$WD" "$CMD"
  echo "[supervisor] started remote-control host in $WD (name: ${SESSION_LABEL:-auto}, model: $SESSION_MODEL, perm: ${SESSION_PERMISSION_MODE:-auto}, resume: ${rid:-none})"
}

# First prompt (optional, SESSION_PROMPT from the machine env): once the remote-control host
# is up, paste it into the input and press Enter, so the session starts working immediately.
# Pasted through a tmux buffer in bracketed-paste mode (`paste-buffer -p`) so multi-line
# prompts stay one message instead of submitting at the first newline. Exactly once per
# machine (marker file), so a host restart or a machine reboot never re-sends it.
# NOTE: `claude --remote-control … "<prompt>"` (the positional prompt) is silently ignored
# by the CLI in remote-control mode (verified 2.1.270) — hence the paste.
send_first_prompt() {
  local marker="$HOME/.claude/.first-prompt-sent" f="$HOME/.claude/first-prompt.txt" i
  [ -n "${SESSION_PROMPT:-}" ] || return 0
  [ -e "$marker" ] && return 0
  (umask 077; printf '%s' "$SESSION_PROMPT" > "$f")
  for i in $(seq 1 90); do   # up to ~3 min for the host to come up
    if tmux capture-pane -p -t "$SESSION" 2>/dev/null | grep -Eq 'remote-control is active|/rc active'; then
      sleep 3   # let the input box settle
      tmux load-buffer -b firstprompt "$f" \
        && tmux paste-buffer -p -d -b firstprompt -t "$SESSION" \
        && sleep 1 && tmux send-keys -t "$SESSION" Enter \
        && { touch "$marker"; echo "[supervisor] first prompt sent ($(wc -c < "$f") bytes)"; return 0; }
      echo "[supervisor] first prompt paste failed; retrying"; sleep 2
    else
      sleep 2
    fi
  done
  echo "[supervisor] first prompt NOT sent: host never became ready"
}

start
send_first_prompt &
# Credentials write-back: claude rotates the OAuth refresh token when it refreshes; push the
# new pair to the portal so sessions created later don't inherit a dead one (see the script).
if [ -x /usr/local/bin/push-claude-credentials ]; then
  nohup /usr/local/bin/push-claude-credentials >/dev/null 2>&1 &
  echo "[supervisor] credentials write-back running (-> ${PORTAL_URL:-portal default})"
fi
while true; do
  if ! pgrep -u "$(id -u)" -f 'claude --remote-control' >/dev/null 2>&1; then
    echo "[supervisor] host gone; restarting"
    start
  fi
  sleep 20
done
