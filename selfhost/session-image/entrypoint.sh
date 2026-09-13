#!/bin/bash
# Session container entrypoint (runs as user `claude` on a Fly Machine).
# Injected by the portal via Fly Machine env:
#   CLAUDE_CREDENTIALS      contents of ~/.claude/.credentials.json (OAuth; enables remote-control)
#   CLAUDE_ACCOUNT          minimal ~/.claude.json (oauthAccount + userID)  [optional]
#   SESSION_SECRETS_JSON    the chosen environment's secrets as a JSON object (-> ~/.secrets + env)
#   SESSION_REPOS           comma-separated git URLs to clone into ~/workspace
#   SESSION_LABEL           session title; blank => the Claude session names itself
#   SESSION_PERMISSION_MODE auto | bypass
#   SESSION_MODEL           model id (default claude-opus-4-8, see session-supervisor.sh)
# If the environment carries KUBE_SERVER + KUBE_TOKEN (+ KUBE_CA), a kubeconfig is written so
# the session can drive the controller cluster with kubectl.
set -uo pipefail
HOME=/home/claude; cd "$HOME"
# ~/artifacts: anything the session puts (or symlinks) here is archived to the Storage Box by
# the portal when the session is destroyed (alongside the transcripts) — see CLAUDE.md.
mkdir -p "$HOME/.claude" "$HOME/workspace" "$HOME/artifacts"

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
# Written shell-quoted so values with spaces/quotes/newlines (Fly tokens, PEM certs) survive
# `. ~/.secrets`. The old KEY=VALUE format silently dropped any value containing a space.
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

exec /usr/local/bin/session-supervisor.sh "$WD"
