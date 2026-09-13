#!/bin/bash
# create.sh — provision the controller CLUSTER box once (its lifecycle is manual; nothing in
# CI touches Hetzner). Needs: HETZNER_API + HETZNER_S3_* (status phone-home) in the env or
# ~/.secrets, an age private key file, and the k8s admin token to bake in.
#
#   AGE_KEY_FILE=~/age.agekey K8S_ADMIN_TOKEN_FILE=~/k8s_admin_token selfhost/cluster/create.sh [name]
#
# What it does NOT need: Claude creds, environments, repos — those live SOPS-encrypted in
# git and Flux restores them (selfhost/k8s/secrets). Rebuild = destroy.sh + create.sh.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_NAME="${1:-claude-controller}"
SERVER_TYPE="${SERVER_TYPE:-cx23}"
IMAGE="${IMAGE:-ubuntu-24.04}"
LOCATION="${LOCATION:-hel1}"
SSH_KEY_ID="${SSH_KEY_ID:-23450965}"
REPO_URL="${REPO_URL:-https://github.com/DE0CH/claude-env.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
STATUS_TTL="${STATUS_TTL:-5400}"
AGE_KEY_FILE="${AGE_KEY_FILE:?path to the age private key file}"
K8S_ADMIN_TOKEN_FILE="${K8S_ADMIN_TOKEN_FILE:?path to the k8s admin token file}"

# secrets: env wins; otherwise parse ~/.secrets WITHOUT sourcing it (values may contain spaces)
if [ -z "${HETZNER_API:-}" ] && [ -f "${SECRETS_FILE:-$HOME/.secrets}" ]; then
  eval "$(python3 - "${SECRETS_FILE:-$HOME/.secrets}" <<'PY'
import shlex,sys
for line in open(sys.argv[1]):
    line=line.rstrip("\n")
    if "=" in line and line.split("=",1)[0].replace("_","").isalnum():
        k,v=line.split("=",1); print(f"export {k}={shlex.quote(v)}")
PY
)"
fi
: "${HETZNER_API:?}"; : "${HETZNER_S3_ENDPOINT:?}"; : "${HETZNER_S3_BUCKET:?}"
: "${HETZNER_S3_ACCESS_KEY:?}"; : "${HETZNER_S3_SECRET_KEY:?}"
AGE_KEY="$(grep -E '^AGE-SECRET-KEY-' "$AGE_KEY_FILE")"; [ -n "$AGE_KEY" ] || { echo "FATAL: no AGE-SECRET-KEY in $AGE_KEY_FILE"; exit 1; }
K8S_ADMIN_TOKEN="$(tr -d '\n' < "$K8S_ADMIN_TOKEN_FILE")"; [ -n "$K8S_ADMIN_TOKEN" ] || { echo "FATAL: empty admin token"; exit 1; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
STATUS_KEY="claude-cluster-bootstrap/$(openssl rand -hex 8)/status.log"
read -r PUT_URL GET_URL <<<"$(python3 - "$STATUS_KEY" "$STATUS_TTL" <<'PY'
import boto3,os,sys
from botocore.config import Config
key,ttl=sys.argv[1],int(sys.argv[2])
ep=os.environ["HETZNER_S3_ENDPOINT"]; ep=ep if ep.startswith("http") else "https://"+ep
s3=boto3.client("s3",endpoint_url=ep,aws_access_key_id=os.environ["HETZNER_S3_ACCESS_KEY"],aws_secret_access_key=os.environ["HETZNER_S3_SECRET_KEY"],region_name=os.environ.get("HETZNER_S3_REGION","fsn1"),config=Config(signature_version="s3v4"))
b=os.environ["HETZNER_S3_BUCKET"]
print(s3.generate_presigned_url("put_object",Params={"Bucket":b,"Key":key},ExpiresIn=ttl),
      s3.generate_presigned_url("get_object",Params={"Bucket":b,"Key":key},ExpiresIn=ttl))
PY
)"

USERDATA="$WORK/user-data.sh"
{ echo '#!/bin/bash'
  printf "REPO_URL=%q\nREPO_BRANCH=%q\nK8S_ADMIN_TOKEN=%q\nAGE_KEY=%q\nPRESIGNED_PUT_STATUS_URL=%q\n" \
    "$REPO_URL" "$REPO_BRANCH" "$K8S_ADMIN_TOKEN" "$AGE_KEY" "$PUT_URL"
  cat "$HERE/cloud-init.sh"
} > "$USERDATA"

# firewall: ssh + k8s API only (everything else leaves via the outbound tunnel)
FW_ID="$(python3 - <<'PY'
import json,os,urllib.request
H={"Authorization":"Bearer "+os.environ["HETZNER_API"],"Content-Type":"application/json"}
fws=json.load(urllib.request.urlopen(urllib.request.Request("https://api.hetzner.cloud/v1/firewalls",headers=H)))["firewalls"]
for f in fws:
    if f["name"]=="claude-controller": print(f["id"]); raise SystemExit
body={"name":"claude-controller","rules":[
  {"direction":"in","protocol":"tcp","port":"22","source_ips":["0.0.0.0/0","::/0"]},
  {"direction":"in","protocol":"tcp","port":"6443","source_ips":["0.0.0.0/0","::/0"]},
  {"direction":"in","protocol":"icmp","source_ips":["0.0.0.0/0","::/0"]}]}
r=json.load(urllib.request.urlopen(urllib.request.Request("https://api.hetzner.cloud/v1/firewalls",data=json.dumps(body).encode(),headers=H)))
print(r["firewall"]["id"])
PY
)"

echo ">> creating $SERVER_NAME ($SERVER_TYPE $IMAGE $LOCATION, firewall $FW_ID)"
RESP="$(python3 - "$SERVER_NAME" "$SERVER_TYPE" "$IMAGE" "$LOCATION" "$SSH_KEY_ID" "$FW_ID" "$USERDATA" <<'PY'
import json,os,sys,urllib.request,urllib.error
name,stype,image,loc,key,fw,udpath=sys.argv[1:8]
body=json.dumps({"name":name,"server_type":stype,"image":image,"location":loc,
  "ssh_keys":[int(key)],"firewalls":[{"firewall":int(fw)}],"start_after_create":True,
  "labels":{"role":"claude-controller"},"user_data":open(udpath).read()}).encode()
req=urllib.request.Request("https://api.hetzner.cloud/v1/servers",data=body,
  headers={"Authorization":"Bearer "+os.environ["HETZNER_API"],"Content-Type":"application/json"})
try: print(urllib.request.urlopen(req).read().decode())
except urllib.error.HTTPError as e: print(json.dumps({"_http_error":e.code,"body":e.read().decode()}))
PY
)"
SID="$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('server',{}).get('id',''))" 2>/dev/null||true)"
SIP="$(echo "$RESP" | python3 -c "import sys,json;s=json.load(sys.stdin).get('server',{});print((s.get('public_net',{}).get('ipv4') or {}).get('ip',''))" 2>/dev/null||true)"
[ -n "$SID" ] || { echo "FATAL: create failed:"; echo "$RESP" | head -c 800; exit 1; }
echo ">> id=$SID ip=$SIP — waiting for bootstrap (status: $GET_URL)"

DEADLINE=$(( $(date +%s)+900 )); LAST_N=0; CUR=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  sleep 15
  CUR="$(curl -fsS "$GET_URL" 2>/dev/null || true)"
  if [ -n "$CUR" ]; then
    N=$(printf '%s\n' "$CUR" | wc -l)
    if [ "$N" -gt "$LAST_N" ]; then printf '%s\n' "$CUR" | tail -n +$((LAST_N+1)) | sed 's/^/   /'; LAST_N=$N; fi
    printf '%s\n' "$CUR" | grep -qE "bootstrap COMPLETE|FATAL" && break
  fi
done
echo "=================================================================="
echo " cluster   : $SERVER_NAME (id $SID)  ip $SIP"
echo " k8s API   : https://$SIP:6443  (bearer token: $K8S_ADMIN_TOKEN_FILE)"
echo " dashboard : https://tunnel.deyaochen.com/t/portal/"
echo " headlamp  : https://tunnel.deyaochen.com/t/headlamp/"
echo " status    : $(printf '%s' "$CUR" | grep -q 'bootstrap COMPLETE' && echo COMPLETE || echo INCOMPLETE)"
echo "=================================================================="
