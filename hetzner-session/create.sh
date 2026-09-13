#!/bin/bash
# create.sh — provision the always-on Claude remote-control box on Hetzner Cloud.
#
# Run it from a machine that has the secrets to bootstrap FROM:
#   ~/.secrets                       (API keys; must include HETZNER_API + HETZNER_S3_*)
#   ~/.claude/.credentials.json      (Claude OAuth refresh token — enables remote-control)
#   ~/.claude.json                   (account identity; a minimal copy is shipped)
#
# It encrypts those into a bundle, parks the ciphertext in your Hetzner S3 bucket behind
# a short-lived presigned URL, creates the server with a cloud-init that pulls+decrypts+
# installs them, then waits for the box to phone home "bootstrap COMPLETE".
#
# Usage:  ./create.sh [server-name]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- config ---------------------------------------------------------------
SERVER_NAME="${1:-claude-remote}"
SERVER_TYPE="${SERVER_TYPE:-cx23}"        # cheapest x86 (2 vCPU / 4 GB)
IMAGE="${IMAGE:-ubuntu-24.04}"
LOCATION="${LOCATION:-hel1}"
SSH_KEY_ID="${SSH_KEY_ID:-23450965}"      # existing key in the token's project
DEPLOY_USER="${DEPLOY_USER:-deyao}"
ENABLE_SUDO="${ENABLE_SUDO:-1}"
BUNDLE_TTL="${BUNDLE_TTL:-1200}"          # 20 min presigned GET/DELETE
STATUS_TTL="${STATUS_TTL:-5400}"          # 90 min presigned PUT for phone-home
SECRETS_FILE="${SECRETS_FILE:-$HOME/.secrets}"
REPO_URL="${REPO_URL:-https://github.com/de0ch/claude-env.git}"

# ---- load creds (never printed) -------------------------------------------
[ -f "$SECRETS_FILE" ] || { echo "FATAL: $SECRETS_FILE not found"; exit 1; }
set -a; . "$SECRETS_FILE"; set +a
: "${HETZNER_API:?missing HETZNER_API}"
: "${HETZNER_S3_ENDPOINT:?missing HETZNER_S3_ENDPOINT}"
: "${HETZNER_S3_BUCKET:?missing HETZNER_S3_BUCKET}"
: "${HETZNER_S3_ACCESS_KEY:?}"; : "${HETZNER_S3_SECRET_KEY:?}"
CRED_FILE="$HOME/.claude/.credentials.json"
[ -f "$CRED_FILE" ] || { echo "FATAL: $CRED_FILE not found (log into claude first)"; exit 1; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
echo ">> staging bundle in $WORK"

# minimal .claude.json — account identity + onboarding/remote-control flags only
python3 - "$HOME/.claude.json" "$WORK/dot-claude.json" <<'PY'
import json,sys
src,dst=sys.argv[1],sys.argv[2]
d=json.load(open(src)) if __import__('os').path.exists(src) else {}
keep={k:d[k] for k in ("oauthAccount","userID") if k in d}
keep.update({"hasCompletedOnboarding":True,"hasUsedRemoteControl":True,
             "autoUpdates":False,"bypassPermissionsModeAccepted":True})
json.dump(keep,open(dst,"w"),indent=2)
PY

# assemble the tar with paths relative to $HOME
STAGE="$WORK/home"; mkdir -p "$STAGE/.claude"
cp "$SECRETS_FILE"                       "$STAGE/.secrets"
cp "$CRED_FILE"                          "$STAGE/.claude/.credentials.json"
cp "$WORK/dot-claude.json"               "$STAGE/.claude.json"
[ -f "$HOME/.claude/settings.json" ] && cp "$HOME/.claude/settings.json" "$STAGE/.claude/settings.json" || true
tar -C "$STAGE" -czf "$WORK/bundle.tgz" .

# encrypt with a random passphrase
PASSPHRASE="$(openssl rand -hex 32)"
openssl enc -aes-256-cbc -pbkdf2 -salt -pass "pass:$PASSPHRASE" \
  -in "$WORK/bundle.tgz" -out "$WORK/bundle.tgz.enc"
echo ">> bundle encrypted ($(wc -c < "$WORK/bundle.tgz.enc") bytes)"

# upload + presign (GET/DELETE/PUT-status) via boto3
S3_KEY="claude-session-bootstrap/$(openssl rand -hex 8)/bundle.tgz.enc"
STATUS_KEY="claude-session-bootstrap/$(openssl rand -hex 8)/status.log"
read -r GET_URL DEL_URL PUT_URL <<<"$(python3 - "$WORK/bundle.tgz.enc" "$S3_KEY" "$STATUS_KEY" "$BUNDLE_TTL" "$STATUS_TTL" <<'PY'
import boto3,os,sys
from botocore.config import Config
enc,key,skey,ttl,sttl=sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4]),int(sys.argv[5])
ep=os.environ["HETZNER_S3_ENDPOINT"]; ep=ep if ep.startswith("http") else "https://"+ep
s3=boto3.client("s3",endpoint_url=ep,
    aws_access_key_id=os.environ["HETZNER_S3_ACCESS_KEY"],
    aws_secret_access_key=os.environ["HETZNER_S3_SECRET_KEY"],
    region_name=os.environ.get("HETZNER_S3_REGION","fsn1"),
    config=Config(signature_version="s3v4"))
b=os.environ["HETZNER_S3_BUCKET"]
s3.upload_file(enc,b,key)
g=s3.generate_presigned_url("get_object",Params={"Bucket":b,"Key":key},ExpiresIn=ttl)
d=s3.generate_presigned_url("delete_object",Params={"Bucket":b,"Key":key},ExpiresIn=ttl)
p=s3.generate_presigned_url("put_object",Params={"Bucket":b,"Key":skey},ExpiresIn=sttl)
print(g,d,p)
PY
)"
STATUS_GET_URL="$(python3 - "$STATUS_KEY" "$STATUS_TTL" <<'PY'
import boto3,os,sys
from botocore.config import Config
skey,sttl=sys.argv[1],int(sys.argv[2])
ep=os.environ["HETZNER_S3_ENDPOINT"]; ep=ep if ep.startswith("http") else "https://"+ep
s3=boto3.client("s3",endpoint_url=ep,
    aws_access_key_id=os.environ["HETZNER_S3_ACCESS_KEY"],
    aws_secret_access_key=os.environ["HETZNER_S3_SECRET_KEY"],
    region_name=os.environ.get("HETZNER_S3_REGION","fsn1"),
    config=Config(signature_version="s3v4"))
print(s3.generate_presigned_url("get_object",
    Params={"Bucket":os.environ["HETZNER_S3_BUCKET"],"Key":skey},ExpiresIn=sttl))
PY
)"
echo ">> ciphertext uploaded to s3://$HETZNER_S3_BUCKET/$S3_KEY (presigned, ${BUNDLE_TTL}s)"

# render user-data: shebang + injected vars + static body
USERDATA="$WORK/user-data.sh"
{
  echo '#!/bin/bash'
  echo "REPO_URL='$REPO_URL'"
  echo "DEPLOY_USER='$DEPLOY_USER'"
  echo "ENABLE_SUDO='$ENABLE_SUDO'"
  echo "PRESIGNED_GET_URL='$GET_URL'"
  echo "PRESIGNED_DELETE_URL='$DEL_URL'"
  echo "PRESIGNED_PUT_STATUS_URL='$PUT_URL'"
  echo "BUNDLE_PASSPHRASE='$PASSPHRASE'"
  cat "$HERE/cloud-init-body.sh"
} > "$USERDATA"
echo ">> user-data rendered ($(wc -c < "$USERDATA") bytes)"

# create the server
echo ">> creating $SERVER_NAME ($SERVER_TYPE, $IMAGE, $LOCATION) ..."
RESP="$(python3 - "$SERVER_NAME" "$SERVER_TYPE" "$IMAGE" "$LOCATION" "$SSH_KEY_ID" "$USERDATA" <<'PY'
import json,os,sys,urllib.request
name,stype,image,loc,keyid,udpath=sys.argv[1:7]
body=json.dumps({"name":name,"server_type":stype,"image":image,"location":loc,
    "ssh_keys":[int(keyid)],"start_after_create":True,"labels":{"role":"claude-remote"},
    "user_data":open(udpath).read()}).encode()
req=urllib.request.Request("https://api.hetzner.cloud/v1/servers",data=body,
    headers={"Authorization":"Bearer "+os.environ["HETZNER_API"],"Content-Type":"application/json"})
try:
    print(urllib.request.urlopen(req).read().decode())
except urllib.error.HTTPError as e:
    print(json.dumps({"_http_error":e.code,"body":e.read().decode()})); sys.exit(0)
PY
)"
SERVER_ID="$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('server',{}).get('id',''))" 2>/dev/null || true)"
SERVER_IP="$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);s=d.get('server',{});print((s.get('public_net',{}).get('ipv4') or {}).get('ip',''))" 2>/dev/null || true)"
if [ -z "$SERVER_ID" ]; then
  echo "FATAL: server creation failed:"; echo "$RESP" | head -c 800; echo; exit 1
fi
echo ">> server id=$SERVER_ID ip=$SERVER_IP  (waiting for bootstrap phone-home)"

# wait for phone-home
DEADLINE=$(( $(date +%s) + 600 ))
LAST=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  sleep 15
  CUR="$(curl -fsS "$STATUS_GET_URL" 2>/dev/null || true)"
  if [ -n "$CUR" ] && [ "$CUR" != "$LAST" ]; then
    echo "$CUR" | tail -n +$(( $(echo "$LAST" | wc -l) )) | sed 's/^/   /'
    LAST="$CUR"
  fi
  echo "$CUR" | grep -q "bootstrap COMPLETE" && break
done

# backstop cleanup of the ciphertext (cloud-init already deletes it)
python3 - "$S3_KEY" <<'PY' 2>/dev/null || true
import boto3,os,sys
from botocore.config import Config
ep=os.environ["HETZNER_S3_ENDPOINT"]; ep=ep if ep.startswith("http") else "https://"+ep
boto3.client("s3",endpoint_url=ep,aws_access_key_id=os.environ["HETZNER_S3_ACCESS_KEY"],
  aws_secret_access_key=os.environ["HETZNER_S3_SECRET_KEY"],
  region_name=os.environ.get("HETZNER_S3_REGION","fsn1"),
  config=Config(signature_version="s3v4")).delete_object(
  Bucket=os.environ["HETZNER_S3_BUCKET"],Key=sys.argv[1])
PY

echo
echo "=================================================================="
echo " server : $SERVER_NAME  (id $SERVER_ID)"
echo " ip     : $SERVER_IP     ssh: ssh $DEPLOY_USER@$SERVER_IP"
echo " status : $(echo "$LAST" | grep -q 'bootstrap COMPLETE' && echo COMPLETE || echo 'INCOMPLETE — check /var/log/claude-bootstrap.log on the box')"
echo " next   : open the Claude app on your phone; the box registers as a"
echo "          remote-control target and you can start sessions against it."
echo "=================================================================="
