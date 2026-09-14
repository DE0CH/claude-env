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

# Pre-accept two interactive dialogs that would otherwise block the tmux-TTY remote-control
# host forever (a blocked host never writes its session registry, so the dashboard shows
# "booting…" indefinitely, no bridge session appears in the app, and the first prompt is
# never sent):
#   1. the per-folder "Do you trust the files in this folder?" prompt, and
#   2. the "WARNING: Claude Code running in Bypass Permissions mode … Yes, I accept" dialog
#      that `--dangerously-skip-permissions` shows on a TTY. In cli 2.1.270 that dialog is
#      gated by `skipDangerousModePermissionPrompt` in ~/.claude/settings.json (the key the
#      dialog itself writes on "Yes, I accept"); the legacy ~/.claude.json
#      `bypassPermissionsModeAccepted` flag does NOT suppress it.
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
# Pre-accept the bypass-permissions warning via the settings key the CLI actually checks.
sp=os.path.expanduser("~/.claude/settings.json")
try: s=json.load(open(sp))
except Exception: s={}
s["skipDangerousModePermissionPrompt"]=True
os.makedirs(os.path.dirname(sp),exist_ok=True)
json.dump(s,open(sp,"w"))
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
  # Resume the conversation if there is a transcript on disk: on a pause/Start wake the
  # entrypoint restored the pause snapshot into ~/.claude/projects/ (a Fly stop wipes the rootfs,
  # so that is the only way one gets here), and on a host-crash restart of the claude process the
  # transcript is simply still there. Newest transcript wins. Nothing on disk -> fresh session.
  # All ids are uuids, so the unquoted expansion below is safe.
  export SESSION_RESUME_FLAG=""
  local rid="" latest
  latest="$(ls -t "$HOME"/.claude/projects/*/*.jsonl 2>/dev/null | head -1)"
  [ -n "$latest" ] && rid="$(basename "$latest" .jsonl)"
  [ -n "$rid" ] && export SESSION_RESUME_FLAG="--resume $rid"
  # Remote Control flag placement is the crux of resume:
  #   * FRESH start (no conversation to resume) -> pass --remote-control to ENABLE Remote
  #     Control and register a bridge (claude.ai/code) session the phone app attaches to.
  #   * RESUME (rid set) -> must NOT pass --remote-control. That flag STARTS A NEW bridge
  #     session (a new entry in the Claude app, showing the conversation as if from the first
  #     prompt). `claude --resume <id>` instead REATTACHES to the conversation's existing bridge
  #     session via its stored reconnection record — same entry on the phone — and re-enables
  #     Remote Control automatically. (Verified: re-passing --remote-control on resume changes
  #     the claude.ai/code/session_… id across a pause/wake.) The server keeps a bridge session
  #     ~4h after it stops, so a wake within that window reattaches; a much later wake still
  #     resumes the conversation locally but appears as a fresh app entry.
  # --name is display-only (dashboard registry / prompt box), so it is safe on both paths.
  if [ -n "$rid" ]; then
    if [ -n "$SESSION_LABEL" ]; then
      CMD='claude --name "$SESSION_LABEL" --model "$SESSION_MODEL" $SESSION_PERM_FLAG $SESSION_RESUME_FLAG'
    else
      CMD='claude --model "$SESSION_MODEL" $SESSION_PERM_FLAG $SESSION_RESUME_FLAG'
    fi
  elif [ -n "$SESSION_LABEL" ]; then
    # --remote-control <name> names it in the Claude app; --name sets the local display
    # name (the session registry the dashboard reads), so both start identical.
    CMD='claude --remote-control "$SESSION_LABEL" --name "$SESSION_LABEL" --model "$SESSION_MODEL" $SESSION_PERM_FLAG'
  else
    # No label => let the Claude session auto-generate (and later refine) its own title.
    CMD='claude --remote-control --model "$SESSION_MODEL" $SESSION_PERM_FLAG'
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

# One-shot session (SESSION_ONE_SHOT=1 from the machine env): the first prompt is the whole
# job. Once it has been pasted, watch claude's own session registry (~/.claude/sessions/<pid>.json,
# the same file the dashboard reads) and treat the job as DONE when the host is idle with a
# status change (statusUpdatedAt) LATER than the moment the prompt was sent — i.e. a turn ran
# and ended — and stays idle for a sustained stretch: 60 s with no background jobs, or 15 min
# when background jobs (child shells of the claude pid) are still around, since a finishing
# background job re-wakes claude (a `run_in_background` Bash re-invokes it on exit). The
# timestamp, not "was busy seen", is the evidence: a short job's busy window (a few seconds)
# can fall entirely between two polls (hit on the first e2e test — a 7 s job never looked busy
# to a 10 s poll). "waiting" (a question/permission prompt for Deyao) is NOT done: the session
# stays up so he can answer it from the app; it finishes once the answer's turn ends. Then claude is told to exit (/exit, then
# the tmux session is killed if it lingers) and the marker ~/.claude/.one-shot-done is written.
# The PORTAL does the rest: its one-shot loop sees the marker via the registry exec, archives
# the transcript + ~/artifacts to the Storage Box, and destroys the machine (force: even with
# uncommitted/unpushed work — it DMs Deyao on Discord when that was the case). The supervisor
# therefore keeps the machine alive after claude exits (the watchdog below does not relaunch
# once the marker exists); nothing here talks to the portal.
ONE_SHOT_IDLE_S=60
ONE_SHOT_IDLE_BG_S=900
one_shot_status() {  # prints "<status> <pid> <statusUpdatedAt ms>" for the remote-control host, or nothing
  python3 - <<'PY'
import glob,json,os
es=[]
for f in glob.glob(os.path.expanduser("~/.claude/sessions/*.json")):
    try: es.append(json.load(open(f)))
    except Exception: pass
es.sort(key=lambda e: e.get("startedAt") or 0)
h=next((e for e in es if e.get("bridgeSessionId")), es[0] if es else None)
if h: print(h.get("status",""), h.get("pid",""), int(h.get("statusUpdatedAt") or h.get("updatedAt") or 0))
PY
}
one_shot_watch() {
  local marker="$HOME/.claude/.one-shot-done" sent="$HOME/.claude/.first-prompt-sent"
  local sent_ms idle_since=0 st pid ts bg now need
  [ "${SESSION_ONE_SHOT:-}" = "1" ] || return 0
  [ -e "$marker" ] && return 0
  while [ ! -e "$sent" ]; do sleep 5; done
  # the marker is touched right after Enter; a turn that ends after this moment is the job
  sent_ms=$(( $(stat -c %Y "$sent") * 1000 ))
  echo "[one-shot] prompt sent; watching for completion"
  while true; do
    sleep 3
    st=""; pid=""; ts=0
    read -r st pid ts < <(one_shot_status) || true
    now=$(date +%s)
    case "$st" in
      idle)
        # idle from before the prompt (or re-written without a turn): not done yet
        [ "${ts:-0}" -gt "$sent_ms" ] || { idle_since=0; continue; }
        [ "$idle_since" = 0 ] && idle_since=$now
        bg=$(pgrep -c -P "${pid:-0}" -f shell-snapshots 2>/dev/null || echo 0)
        need=$ONE_SHOT_IDLE_S; [ "${bg:-0}" -gt 0 ] && need=$ONE_SHOT_IDLE_BG_S
        if [ $((now - idle_since)) -ge "$need" ]; then
          echo "[one-shot] done (idle ${need}s, background jobs: ${bg:-0}); exiting claude"
          printf 'done %s idle=%ss bg=%s\n' "$(date -u +%FT%TZ)" "$need" "${bg:-0}" > "$marker"
          tmux send-keys -t "$SESSION" Escape 2>/dev/null; sleep 1
          tmux send-keys -t "$SESSION" -l -- '/exit' 2>/dev/null; sleep 1
          tmux send-keys -t "$SESSION" Enter 2>/dev/null
          for _ in $(seq 1 15); do pgrep -u "$(id -u)" -f 'claude .*--model' >/dev/null 2>&1 || break; sleep 1; done
          tmux kill-session -t "$SESSION" 2>/dev/null || true
          echo "[one-shot] claude exited; waiting for the portal to archive + destroy this machine"
          return 0
        fi ;;
      *) idle_since=0 ;;   # busy / waiting (needs Deyao) / unknown: not done, not counting
    esac
  done
}

start
send_first_prompt &
one_shot_watch &
# Credentials write-back: claude rotates the OAuth refresh token when it refreshes; push the
# new pair to the portal so sessions created later don't inherit a dead one (see the script).
if [ -x /usr/local/bin/push-claude-credentials ]; then
  nohup /usr/local/bin/push-claude-credentials >/dev/null 2>&1 &
  echo "[supervisor] credentials write-back running (-> ${PORTAL_URL:-portal default})"
fi
while true; do
  # Liveness by a token present in EVERY launch form (fresh uses --remote-control, resume does
  # not), so the watchdog never thinks a resumed host is dead and restart-loops it. --model is
  # always passed; the supervisor/push-creds processes don't contain it.
  if [ -e "$HOME/.claude/.one-shot-done" ]; then :   # one-shot finished: claude stays down, the portal destroys the machine
  elif ! pgrep -u "$(id -u)" -f 'claude .*--model' >/dev/null 2>&1; then
    echo "[supervisor] host gone; restarting"
    start
  fi
  sleep 20
done
