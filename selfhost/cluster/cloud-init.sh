# cloud-init.sh — controller CLUSTER bootstrap (create.sh prepends a shebang + var block).
# Turns a blank Ubuntu box into a single-node k3s cluster that reconciles itself from git:
#   k3s (server+agent on this one node) -> Flux -> ./selfhost/k8s from the public repo,
#   Secrets decrypted with the age key handed over in user-data. Nothing else is stateful.
#
# Injected vars: REPO_URL REPO_BRANCH K8S_ADMIN_TOKEN AGE_KEY PRESIGNED_PUT_STATUS_URL
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
exec > >(tee -a /var/log/claude-bootstrap.log) 2>&1
echo "=== cluster bootstrap $(date -u +%FT%TZ) ==="
STATUS_LOG=/var/log/claude-bootstrap-status.log
phone_home(){ echo "[$(date -u +%FT%TZ)] $*" | tee -a "$STATUS_LOG"; [ -n "${PRESIGNED_PUT_STATUS_URL:-}" ] && curl -sS -X PUT --upload-file "$STATUS_LOG" "$PRESIGNED_PUT_STATUS_URL" >/dev/null 2>&1 || true; }
phone_home "bootstrap started"

apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl git jq
PUBLIC_IP="$(curl -fsS --max-time 5 http://169.254.169.254/hetzner/v1/metadata/public-ipv4 || curl -fsS4 --max-time 10 https://ipv4.icanhazip.com)"
phone_home "packages ok, public ip $PUBLIC_IP"

# --- k3s: single node, static admin bearer token for the API (sessions + rebuilds use it)
mkdir -p /etc/rancher/k3s
printf '%s,claude-admin,claude-admin,"system:masters"\n' "$K8S_ADMIN_TOKEN" > /etc/rancher/k3s/tokens.csv
chmod 600 /etc/rancher/k3s/tokens.csv
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --disable traefik --tls-san $PUBLIC_IP --kube-apiserver-arg=token-auth-file=/etc/rancher/k3s/tokens.csv" sh - \
  || { phone_home "FATAL: k3s install failed"; exit 1; }
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
for i in $(seq 1 60); do kubectl get nodes 2>/dev/null | grep -q ' Ready' && break; sleep 5; done
phone_home "k3s ready: $(kubectl get nodes --no-headers 2>/dev/null | tr -s ' ')"

# --- Flux (no bootstrap/write-back: the repo is public, Flux only pulls) ---------------
curl -s https://fluxcd.io/install.sh | bash || { phone_home "FATAL: flux cli install failed"; exit 1; }
flux install --timeout 5m || { phone_home "FATAL: flux install failed"; exit 1; }
# the one bootstrap secret: the age private key for sops decryption
umask 077; printf '%s\n' "$AGE_KEY" > /root/age.agekey
kubectl -n flux-system create secret generic sops-age --from-file=age.agekey=/root/age.agekey
shred -u /root/age.agekey
phone_home "flux installed, sops-age secret created"

# sync objects straight from the repo (pinned to the branch Flux will follow)
RAW="${REPO_URL%.git}"; RAW="${RAW/github.com/raw.githubusercontent.com}/${REPO_BRANCH}"
kubectl apply -f "$RAW/selfhost/k8s/flux/sync.yaml" || { phone_home "FATAL: applying flux sync failed"; exit 1; }
for i in $(seq 1 60); do
  R="$(kubectl -n flux-system get kustomization selfhost -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
  [ "$R" = "True" ] && break; sleep 5
done
phone_home "flux kustomization selfhost Ready=$R"
phone_home "pods: $(kubectl get pods -A --no-headers 2>/dev/null | awk '{print $2"="$4}' | tr '\n' ' ')"
phone_home "api: https://$PUBLIC_IP:6443  dashboard: https://tunnel.deyaochen.com/t/portal/  headlamp: https://tunnel.deyaochen.com/t/headlamp/"
phone_home "bootstrap COMPLETE $(date -u +%FT%TZ)"
shred -u /var/lib/cloud/instance/user-data.txt* 2>/dev/null || true
rm -f /var/lib/cloud/instance/user-data.txt* 2>/dev/null || true
