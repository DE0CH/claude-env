#!/bin/bash
# Session container entrypoint (runs as user `claude` on a Fly Machine).
# Injected by the portal via Fly Machine env:
#   CLAUDE_CREDENTIALS      contents of ~/.claude/.credentials.json (OAuth; enables remote-control)
#   CLAUDE_ACCOUNT          minimal ~/.claude.json (oauthAccount + userID)  [optional]
#   SESSION_SECRETS_JSON    the chosen environment's secrets as a JSON object (-> ~/.secrets + env)
#   SESSION_REPOS           comma-separated git URLs to clone into ~/workspace
#   SESSION_LABEL           session title; blank => the Claude session names itself
#   SESSION_PERMISSION_MODE auto | bypass
#   SESSION_PROMPT          [optional] first prompt, pasted into the host once it is up (supervisor)
#   SESSION_MODEL           model id (default claude-opus-4-8, see session-supervisor.sh)
# Fly itself sets FLY_MACHINE_ID. If the environment carries KUBE_SERVER + KUBE_TOKEN (+ KUBE_CA),
# a kubeconfig is written so the session can drive the controller cluster with kubectl.
#
# Boots are NOT all fresh: a paused session is a Fly-stopped machine, and Fly resets the ephemeral
# rootfs on the next start. Before stopping, the portal snapshots the transcript(s) + ~/.claude.json
# to claude-records/.paused/<FLY_MACHINE_ID>/ on the Storage Box (portal/lib/archive.js); this
# script restores that snapshot so session-supervisor.sh can `claude --resume` the same
# conversation. ~/workspace is NOT snapshotted — commit/push before pausing.
set -uo pipefail
HOME=/home/claude; cd "$HOME"
# ~/artifacts: anything the session puts (or symlinks) here is archived to the Storage Box by
# the portal when the session is destroyed (alongside the transcripts) — see CLAUDE.md.
mkdir -p "$HOME/.claude" "$HOME/workspace" "$HOME/artifacts"

# --- environment secrets ---------------------------------------------------
# Written shell-quoted so values with spaces/quotes/newlines (Fly tokens, PEM certs) survive
# `. ~/.secrets`. The old KEY=VALUE format silently dropped any value containing a space.
# First, because the pause-snapshot restore below needs the STORAGEBOX_* creds.
if [ -n "${SESSION_SECRETS_JSON:-}" ]; then
  python3 - <<'PY'
import json,os,shlex
d=json.loads(os.environ["SESSION_SECRETS_JSON"])
p=os.path.expanduser("~/.secrets")
with open(p,"w") as f:
    for k,v in d.items():
        if k.replace("_","").isalnum(): f.write(f"{k}={shlex.quote(str(v))}\n")
os.chmod(p,0o600)
PY
  set -a; . "$HOME/.secrets"; set +a
fi

# --- restore the pause snapshot (if this machine was paused) -----------------
# Fetches manifest.txt from claude-records/.paused/<FLY_MACHINE_ID>/; if it exists, downloads
# ~/.claude.json (before the machineID merge below, so the same Remote Control target identity
# is kept) and every listed transcript into a staging dir — they are placed under the project
# slug once the working dir is known (further down). Any failure => fresh session.
RESTORE_DIR="$HOME/.paused-restore"; rm -rf "$RESTORE_DIR"
if [ -n "${FLY_MACHINE_ID:-}" ] && [ -n "${STORAGEBOX_HOST:-}" ] && [ -n "${STORAGEBOX_USER:-}" ] && [ -n "${STORAGEBOX_PASSWORD:-}" ]; then
  SNAP="https://${STORAGEBOX_HOST}/claude-records/.paused/${FLY_MACHINE_ID}"
  sbget() { curl -fsS -m 300 -u "${STORAGEBOX_USER}:${STORAGEBOX_PASSWORD}" "$SNAP/$1" -o "$2"; }
  mkdir -p "$RESTORE_DIR"
  if sbget manifest.txt "$RESTORE_DIR/manifest.txt" 2>/dev/null; then
    sbget claude.json "$HOME/.claude.json" 2>/dev/null || true
    while IFS= read -r name; do
      case "$name" in *.jsonl) sbget "$name" "$RESTORE_DIR/$name" && echo "[entrypoint] restored transcript $name ($(wc -c < "$RESTORE_DIR/$name") bytes)" || echo "[entrypoint] WARN restore of $name failed";; esac
    done < "$RESTORE_DIR/manifest.txt"
  else
    echo "[entrypoint] no pause snapshot for $FLY_MACHINE_ID; fresh session"
  fi
fi

# --- Claude auth -----------------------------------------------------------
if [ -n "${CLAUDE_CREDENTIALS:-}" ]; then
  printf '%s' "$CLAUDE_CREDENTIALS" > "$HOME/.claude/.credentials.json"
  chmod 600 "$HOME/.claude/.credentials.json"
fi
# machineID: reuse the one in ~/.claude.json when it was restored from a pause snapshot (same
# Remote Control identity in the Claude app instead of a new target); mint a fresh one on a
# brand-new machine. Existing ~/.claude.json fields (projects trust, etc.) are preserved, then
# the account + fixed flags are merged on top.
MID="$(tr -d - < /proc/sys/kernel/random/uuid)"
python3 - "$MID" <<'PY'
import json,os,sys
mid=sys.argv[1]; p=os.path.expanduser("~/.claude.json")
try: existing=json.load(open(p))
except Exception: existing={}
try: d=json.loads(os.environ.get("CLAUDE_ACCOUNT","") or "{}")
except Exception: d={}
if existing.get("machineID"): mid=existing["machineID"]
existing.update(d)
existing.update({"machineID":mid,"hasCompletedOnboarding":True,"hasUsedRemoteControl":True,
          "bypassPermissionsModeAccepted":True,"autoUpdates":False})
json.dump(existing,open(p,"w"))
PY

# --- kubeconfig for the controller cluster ----------------------------------
if [ -n "${KUBE_SERVER:-}" ] && [ -n "${KUBE_TOKEN:-}" ]; then
  mkdir -p "$HOME/.kube"; umask 077
  if [ -n "${KUBE_CA:-}" ]; then printf '%s\n' "$KUBE_CA" > "$HOME/.kube/ca.crt"; CA_LINE="    certificate-authority: $HOME/.kube/ca.crt"
  else CA_LINE="    insecure-skip-tls-verify: true"; fi
  cat > "$HOME/.kube/config" <<EOF
apiVersion: v1
kind: Config
clusters:
- name: controller
  cluster:
    server: $KUBE_SERVER
$CA_LINE
users:
- name: claude-admin
  user:
    token: $KUBE_TOKEN
contexts:
- name: controller
  context: {cluster: controller, user: claude-admin}
current-context: controller
EOF
  umask 022
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

# --- place restored transcripts where claude looks for them ------------------
# ~/.claude/projects/<cwd slug>/<id>.jsonl — session-supervisor.sh then starts
# `claude --resume <newest id>`. The first-prompt marker is set so the supervisor does not paste
# SESSION_PROMPT into the resumed conversation again.
if compgen -G "$RESTORE_DIR/*.jsonl" >/dev/null 2>&1; then
  PDIR="$HOME/.claude/projects/$(printf '%s' "$WD" | sed 's#[^A-Za-z0-9]#-#g')"
  mkdir -p "$PDIR"
  mv "$RESTORE_DIR"/*.jsonl "$PDIR"/
  touch "$HOME/.claude/.first-prompt-sent"
  echo "[entrypoint] resume ready: $(ls "$PDIR"/*.jsonl | wc -l) transcript(s) in $PDIR"
fi
rm -rf "$RESTORE_DIR"

exec /usr/local/bin/session-supervisor.sh "$WD"
