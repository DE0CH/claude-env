#!/bin/bash
# Session container entrypoint (runs as user `claude` on a Fly Machine).
# Injected by the portal via Fly Machine env:
#   CLAUDE_CREDENTIALS   contents of ~/.claude/.credentials.json (OAuth; enables remote-control)
#   CLAUDE_ACCOUNT       minimal ~/.claude.json (oauthAccount + userID)  [optional]
#   SESSION_SECRETS_ENV  the chosen environment's KEY=VALUE lines (become ~/.secrets + env)
#   SESSION_REPOS        comma-separated git URLs to clone into ~/workspace
#   SESSION_LABEL        human label shown as the machine hostname / session name [optional]
set -uo pipefail
HOME=/home/claude; cd "$HOME"
mkdir -p "$HOME/.claude" "$HOME/workspace"

# --- Claude auth -----------------------------------------------------------
if [ -n "${CLAUDE_CREDENTIALS:-}" ]; then
  printf '%s' "$CLAUDE_CREDENTIALS" > "$HOME/.claude/.credentials.json"
  chmod 600 "$HOME/.claude/.credentials.json"
fi
# unique machineID per session so each shows as a distinct target in the app
MID="$(tr -d - < /proc/sys/kernel/random/uuid)"
python3 - "$MID" <<'PY'
import json,os,sys
mid=sys.argv[1]
try: d=json.loads(os.environ.get("CLAUDE_ACCOUNT","") or "{}")
except Exception: d={}
d.update({"machineID":mid,"hasCompletedOnboarding":True,"hasUsedRemoteControl":True,
          "bypassPermissionsModeAccepted":True,"autoUpdates":False})
json.dump(d,open(os.path.expanduser("~/.claude.json"),"w"))
PY

# --- environment secrets ---------------------------------------------------
if [ -n "${SESSION_SECRETS_ENV:-}" ]; then
  printf '%s\n' "$SESSION_SECRETS_ENV" > "$HOME/.secrets"
  chmod 600 "$HOME/.secrets"
  set -a; . "$HOME/.secrets"; set +a
fi

# --- repos -----------------------------------------------------------------
if [ -n "${SESSION_REPOS:-}" ]; then
  IFS=',' read -ra REPOS <<< "$SESSION_REPOS"
  for url in "${REPOS[@]}"; do
    url="$(echo "$url" | xargs)"; [ -z "$url" ] && continue
    name="$(basename "$url" .git)"
    clone_url="$url"
    if [ -n "${GITHUB_TOKEN:-}" ] && [[ "$url" == https://github.com/* ]]; then
      clone_url="${url/https:\/\//https://x-access-token:${GITHUB_TOKEN}@}"
    fi
    echo "[entrypoint] cloning $name"
    if git clone "$clone_url" "$HOME/workspace/$name" 2>/dev/null; then
      git -C "$HOME/workspace/$name" remote set-url origin "$url" 2>/dev/null || true
    else
      echo "[entrypoint] WARN clone failed: $url"
    fi
  done
fi

# working dir = the single repo if there's exactly one, else the workspace root
WD="$HOME/workspace"
mapfile -t DIRS < <(find "$HOME/workspace" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
[ "${#DIRS[@]}" = "1" ] && WD="${DIRS[0]}"

exec /usr/local/bin/session-supervisor.sh "$WD"
