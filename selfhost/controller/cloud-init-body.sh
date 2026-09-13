# cloud-init-body.sh — controller bootstrap (create.sh prepends shebang + var block).
# Turns a blank Ubuntu box into the stateless controller: portal dashboard + Fly
# orchestration + cf-tunnel exposure. No session containers run here.
#
# Injected vars: REPO_URL DEPLOY_USER ENABLE_SUDO
#   PRESIGNED_GET_URL PRESIGNED_DELETE_URL PRESIGNED_PUT_STATUS_URL BUNDLE_PASSPHRASE
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
exec > >(tee -a /var/log/claude-bootstrap.log) 2>&1
echo "=== controller bootstrap $(date -u +%FT%TZ) ==="
STATUS_LOG=/var/log/claude-bootstrap-status.log
phone_home(){ echo "[$(date -u +%FT%TZ)] $*" | tee -a "$STATUS_LOG"; [ -n "${PRESIGNED_PUT_STATUS_URL:-}" ] && curl -sS -X PUT --upload-file "$STATUS_LOG" "$PRESIGNED_PUT_STATUS_URL" >/dev/null 2>&1 || true; }
phone_home "bootstrap started"

# --- packages --------------------------------------------------------------
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl git openssl unzip jq ripgrep python3
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - || true
apt-get install -y nodejs || true
phone_home "packages installed (node=$(command -v node || echo none))"

# --- user ------------------------------------------------------------------
id "$DEPLOY_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$DEPLOY_USER"
if [ "${ENABLE_SUDO:-1}" = "1" ]; then
  usermod -aG sudo "$DEPLOY_USER"
  echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-$DEPLOY_USER; chmod 0440 /etc/sudoers.d/90-$DEPLOY_USER
fi
HOME_DIR="/home/$DEPLOY_USER"
if [ -f /root/.ssh/authorized_keys ]; then
  install -d -m700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"
  install -m600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "$HOME_DIR/.ssh/authorized_keys"
fi

# --- secrets bundle (~/.secrets + ~/.claude creds) -------------------------
B=/root/bundle.tgz.enc
curl -fsSL "$PRESIGNED_GET_URL" -o "$B" || { phone_home "FATAL: bundle download failed"; exit 1; }
openssl enc -d -aes-256-cbc -pbkdf2 -salt -pass "pass:$BUNDLE_PASSPHRASE" -in "$B" | tar -C "$HOME_DIR" -xzf - \
  || { phone_home "FATAL: bundle decrypt failed"; exit 1; }
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$HOME_DIR"
chmod 600 "$HOME_DIR/.secrets" 2>/dev/null || true
shred -u "$B" 2>/dev/null || rm -f "$B"
[ -n "${PRESIGNED_DELETE_URL:-}" ] && curl -sS -X DELETE "$PRESIGNED_DELETE_URL" >/dev/null 2>&1 || true
phone_home "secrets installed (.secrets=$( [ -f "$HOME_DIR/.secrets" ] && echo yes||echo NO ), creds=$( [ -f "$HOME_DIR/.claude/.credentials.json" ] && echo yes||echo NO ))"

# --- repo + deps -----------------------------------------------------------
sudo -u "$DEPLOY_USER" -H git clone "$REPO_URL" "$HOME_DIR/claude-env" 2>/dev/null || \
  sudo -u "$DEPLOY_USER" -H git -C "$HOME_DIR/claude-env" pull --ff-only || true
sudo -u "$DEPLOY_USER" -H bash -lc "cd '$HOME_DIR/claude-env/selfhost/portal' && npm install --no-audit --no-fund" || phone_home "WARN: portal npm install failed"
sudo -u "$DEPLOY_USER" -H bash -lc "cd '$HOME_DIR/claude-env/cf-tunnel' && npm install --no-audit --no-fund" || phone_home "WARN: cf-tunnel npm install failed"
# flyctl for the operator + deploy script
sudo -u "$DEPLOY_USER" -H bash -lc 'curl -fsSL https://fly.io/install.sh | sh' || phone_home "WARN: flyctl install failed"
sudo -u "$DEPLOY_USER" -H bash -lc 'grep -q ".fly/bin" ~/.bashrc || echo "export PATH=\$HOME/.fly/bin:\$PATH" >> ~/.bashrc'
phone_home "repo + deps ready ($(cd "$HOME_DIR/claude-env" && sudo -u "$DEPLOY_USER" git rev-parse --short HEAD 2>/dev/null))"

# --- build the session image if not already recorded -----------------------
sudo -u "$DEPLOY_USER" -H bash -lc "cd '$HOME_DIR/claude-env/selfhost' && set -a; . ~/.secrets; set +a; \
  if [ -n \"\$FLY_API_TOKEN\" ]; then \
    HAS=\$(cd portal && node -e 'require(\"./lib/store\").get().then(c=>{console.log(c.sessionImage?\"yes\":\"no\")}).catch(()=>console.log(\"err\"))' 2>/dev/null); \
    if [ \"\$HAS\" != yes ]; then echo building image; bash deploy-session-image.sh || true; fi; \
  else echo 'no FLY token; skipping image build'; fi" || phone_home "WARN: image build step failed"
phone_home "session image step done"

# --- systemd services ------------------------------------------------------
install -m0644 "$HOME_DIR/claude-env/selfhost/controller/claude-portal.service" /etc/systemd/system/
install -m0644 "$HOME_DIR/claude-env/selfhost/controller/claude-portal-tunnel.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now claude-portal.service
systemctl enable --now claude-portal-tunnel.service
sleep 6
phone_home "portal=$(systemctl is-active claude-portal.service) tunnel=$(systemctl is-active claude-portal-tunnel.service)"
phone_home "URL: https://tunnel.deyaochen.com/t/portal/"
phone_home "bootstrap COMPLETE $(date -u +%FT%TZ)"
shred -u /var/lib/cloud/instance/user-data.txt* 2>/dev/null || true
rm -f /var/lib/cloud/instance/user-data.txt* 2>/dev/null || true
