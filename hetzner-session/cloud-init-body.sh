# cloud-init-body.sh  (NOT executed directly — create.sh prepends a shebang + the
# variable block below, producing the server's user-data script. cloud-init runs it as
# root on first boot.)
#
# Expected variables (injected at the top by create.sh):
#   REPO_URL                 public git repo to clone
#   DEPLOY_USER              unprivileged user that runs claude (deyao)
#   ENABLE_SUDO              "1" to grant DEPLOY_USER passwordless sudo
#   PRESIGNED_GET_URL        short-lived GET for the encrypted secrets bundle
#   PRESIGNED_DELETE_URL     short-lived DELETE to remove the bundle after use
#   PRESIGNED_PUT_STATUS_URL short-lived PUT to phone-home bootstrap status
#   BUNDLE_PASSPHRASE        openssl passphrase for the bundle

set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
exec > >(tee -a /var/log/claude-bootstrap.log) 2>&1
echo "=== claude box bootstrap $(date -u +%FT%TZ) ==="

STATUS_LOG=/var/log/claude-bootstrap-status.log
phone_home() {
  echo "[$(date -u +%FT%TZ)] $*" | tee -a "$STATUS_LOG"
  if [ -n "${PRESIGNED_PUT_STATUS_URL:-}" ]; then
    curl -sS -X PUT --upload-file "$STATUS_LOG" "$PRESIGNED_PUT_STATUS_URL" >/dev/null 2>&1 || true
  fi
}

phone_home "bootstrap started"

# --- 1. base packages -------------------------------------------------------
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl git tmux openssl unzip jq ripgrep ffmpeg \
  python3 python3-pip python3-venv build-essential
# Node.js (for the repo's JS tooling: cf-tunnel, archive-dump, browserbase CLI, etc.)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - || true
apt-get install -y nodejs || true
python3 -m pip install --break-system-packages --quiet boto3 requests || \
  python3 -m pip install --quiet boto3 requests || true
phone_home "base packages installed (node=$(command -v node || echo none))"

# --- 2. unprivileged user ---------------------------------------------------
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$DEPLOY_USER"
fi
if [ "${ENABLE_SUDO:-1}" = "1" ]; then
  usermod -aG sudo "$DEPLOY_USER"
  echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-$DEPLOY_USER
  chmod 0440 /etc/sudoers.d/90-$DEPLOY_USER
fi
HOME_DIR="/home/$DEPLOY_USER"
# break-glass SSH: let DEPLOY_USER accept the same key Hetzner injected for root
if [ -f /root/.ssh/authorized_keys ]; then
  install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"
  install -m 0600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
    /root/.ssh/authorized_keys "$HOME_DIR/.ssh/authorized_keys"
fi
phone_home "user $DEPLOY_USER ready (sudo=${ENABLE_SUDO:-1})"

# --- 3. fetch + decrypt the secrets bundle ----------------------------------
BUNDLE=/root/bundle.tgz.enc
if ! curl -fsSL "$PRESIGNED_GET_URL" -o "$BUNDLE"; then
  phone_home "FATAL: could not download secrets bundle"; exit 1
fi
if ! openssl enc -d -aes-256-cbc -pbkdf2 -salt \
      -pass "pass:$BUNDLE_PASSPHRASE" -in "$BUNDLE" | tar -C "$HOME_DIR" -xzf -; then
  phone_home "FATAL: could not decrypt/extract secrets bundle"; exit 1
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$HOME_DIR"
chmod 600 "$HOME_DIR/.secrets" 2>/dev/null || true
chmod 700 "$HOME_DIR/.claude" 2>/dev/null || true
chmod 600 "$HOME_DIR/.claude/.credentials.json" 2>/dev/null || true
# scrub the bundle + delete the remote copy immediately
shred -u "$BUNDLE" 2>/dev/null || rm -f "$BUNDLE"
[ -n "${PRESIGNED_DELETE_URL:-}" ] && curl -sS -X DELETE "$PRESIGNED_DELETE_URL" >/dev/null 2>&1 || true
phone_home "secrets bundle installed (has .secrets=$( [ -f "$HOME_DIR/.secrets" ] && echo yes || echo NO ), has creds=$( [ -f "$HOME_DIR/.claude/.credentials.json" ] && echo yes || echo NO ))"

# --- 4. install the claude native binary ------------------------------------
sudo -u "$DEPLOY_USER" -H bash -lc 'curl -fsSL https://claude.ai/install.sh | bash' || \
  phone_home "WARN: claude installer returned non-zero"
CLAUDE_BIN="$HOME_DIR/.local/bin/claude"
if [ -x "$CLAUDE_BIN" ]; then
  ln -sf "$CLAUDE_BIN" /usr/local/bin/claude
fi
phone_home "claude installed: $(sudo -u "$DEPLOY_USER" -H bash -lc 'PATH=$HOME/.local/bin:/usr/local/bin:$PATH claude --version' 2>&1 | head -1)"

# --- 5. clone the repo ------------------------------------------------------
if [ ! -d "$HOME_DIR/claude-env/.git" ]; then
  sudo -u "$DEPLOY_USER" -H git clone "$REPO_URL" "$HOME_DIR/claude-env"
fi
chmod +x "$HOME_DIR/claude-env/hetzner-session/claude-remote-supervisor.sh" 2>/dev/null || true
phone_home "repo cloned at $HOME_DIR/claude-env ($(cd "$HOME_DIR/claude-env" && git rev-parse --short HEAD 2>/dev/null))"

# --- 6. install + start the always-on remote-control service ----------------
install -m 0644 "$HOME_DIR/claude-env/hetzner-session/claude-remote.service" \
  /etc/systemd/system/claude-remote.service
systemctl daemon-reload
systemctl enable claude-remote.service
systemctl restart claude-remote.service
sleep 8
if systemctl is-active --quiet claude-remote.service; then
  phone_home "claude-remote.service ACTIVE; remote-control host: $(pgrep -af 'claude --remote-control' | head -1)"
else
  phone_home "WARN: claude-remote.service not active: $(systemctl is-active claude-remote.service)"
fi

# --- 7. scrub bootstrap material at rest ------------------------------------
# The presigned URLs are already expired/deleted; still, remove the passphrase from disk.
phone_home "bootstrap COMPLETE $(date -u +%FT%TZ)"
shred -u /var/lib/cloud/instance/user-data.txt* 2>/dev/null || true
rm -f /var/lib/cloud/instance/user-data.txt* 2>/dev/null || true
