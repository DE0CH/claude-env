#!/bin/bash
# create.sh — provision the stateless CONTROLLER box (portal + Fly orchestration + tunnel).
# Run where the bootstrap secrets live: ~/.secrets (HETZNER_API, HETZNER_S3_*, FLY_API_TOKEN,
# PORTAL_ENC_KEY, CF_ACCESS_*, ...) and ~/.claude/.credentials.json.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_NAME="${1:-claude-controller}"
SERVER_TYPE="${SERVER_TYPE:-cx23}"
IMAGE="${IMAGE:-ubuntu-24.04}"
LOCATION="${LOCATION:-hel1}"
SSH_KEY_ID="${SSH_KEY_ID:-23450965}"
EXTRA_SSH_KEY_ID="${EXTRA_SSH_KEY_ID:-}"   # optional 2nd key id (e.g. a dev key)
DEPLOY_USER="${DEPLOY_USER:-deyao}"
ENABLE_SUDO="${ENABLE_SUDO:-1}"
BUNDLE_TTL="${BUNDLE_TTL:-1200}"; STATUS_TTL="${STATUS_TTL:-5400}"
SECRETS_FILE="${SECRETS_FILE:-$HOME/.secrets}"
REPO_URL="${REPO_URL:-https://github.com/de0ch/claude-env.git}"

[ -f "$SECRETS_FILE" ] || { echo "FATAL: $SECRETS_FILE not found"; exit 1; }
set -a; . "$SECRETS_FILE"; set +a
: "${HETZNER_API:?}"; : "${HETZNER_S3_ENDPOINT:?}"; : "${HETZNER_S3_BUCKET:?}"
: "${HETZNER_S3_ACCESS_KEY:?}"; : "${HETZNER_S3_SECRET_KEY:?}"
CRED_FILE="$HOME/.claude/.credentials.json"
[ -f "$CRED_FILE" ] || { echo "FATAL: $CRED_FILE not found"; exit 1; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
python3 - "$HOME/.claude.json" "$WORK/dot-claude.json" <<'PY'
import json,os,sys
d=json.load(open(sys.argv[1])) if os.path.exists(sys.argv[1]) else {}
keep={k:d[k] for k in ("oauthAccount","userID") if k in d}
keep.update({"hasCompletedOnboarding":True,"hasUsedRemoteControl":True,"autoUpdates":False,"bypassPermissionsModeAccepted":True})
json.dump(keep,open(sys.argv[2],"w"),indent=2)
PY
STAGE="$WORK/home"; mkdir -p "$STAGE/.claude"
cp "$SECRETS_FILE" "$STAGE/.secrets"
cp "$CRED_FILE" "$STAGE/.claude/.credentials.json"
cp "$WORK/dot-claude.json" "$STAGE/.claude.json"
[ -f "$HOME/.claude/settings.json" ] && cp "$HOME/.claude/settings.json" "$STAGE/.claude/settings.json" || true
tar -C "$STAGE" -czf "$WORK/bundle.tgz" .
PASSPHRASE="$(openssl rand -hex 32)"
openssl enc -aes-256-cbc -pbkdf2 -salt -pass "pass:$PASSPHRASE" -in "$WORK/bundle.tgz" -out "$WORK/bundle.tgz.enc"

S3_KEY="claude-session-bootstrap/$(openssl rand -hex 8)/bundle.tgz.enc"
STATUS_KEY="claude-session-bootstrap/$(openssl rand -hex 8)/status.log"
read -r GET_URL DEL_URL PUT_URL <<<"$(python3 - "$WORK/bundle.tgz.enc" "$S3_KEY" "$STATUS_KEY" "$BUNDLE_TTL" "$STATUS_TTL" <<'PY'
import boto3,os,sys
from botocore.config import Config
enc,key,skey,ttl,sttl=sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4]),int(sys.argv[5])
ep=os.environ["HETZNER_S3_ENDPOINT"]; ep=ep if ep.startswith("http") else "https://"+ep
s3=boto3.client("s3",endpoint_url=ep,aws_access_key_id=os.environ["HETZNER_S3_ACCESS_KEY"],aws_secret_access_key=os.environ["HETZNER_S3_SECRET_KEY"],region_name=os.environ.get("HETZNER_S3_REGION","fsn1"),config=Config(signature_version="s3v4"))
b=os.environ["HETZNER_S3_BUCKET"]; s3.upload_file(enc,b,key)
print(s3.generate_presigned_url("get_object",Params={"Bucket":b,"Key":key},ExpiresIn=ttl),
      s3.generate_presigned_url("delete_object",Params={"Bucket":b,"Key":key},ExpiresIn=ttl),
      s3.generate_presigned_url("put_object",Params={"Bucket":b,"Key":skey},ExpiresIn=sttl))
PY
)"
STATUS_GET_URL="$(python3 - "$STATUS_KEY" "$STATUS_TTL" <<'PY'
import boto3,os,sys
from botocore.config import Config
ep=os.environ["HETZNER_S3_ENDPOINT"]; ep=ep if ep.startswith("http") else "https://"+ep
s3=boto3.client("s3",endpoint_url=ep,aws_access_key_id=os.environ["HETZNER_S3_ACCESS_KEY"],aws_secret_access_key=os.environ["HETZNER_S3_SECRET_KEY"],region_name=os.environ.get("HETZNER_S3_REGION","fsn1"),config=Config(signature_version="s3v4"))
print(s3.generate_presigned_url("get_object",Params={"Bucket":os.environ["HETZNER_S3_BUCKET"],"Key":sys.argv[1]},ExpiresIn=int(sys.argv[2])))
PY
)"

USERDATA="$WORK/user-data.sh"
{ echo '#!/bin/bash'
  echo "REPO_URL='$REPO_URL'"; echo "DEPLOY_USER='$DEPLOY_USER'"; echo "ENABLE_SUDO='$ENABLE_SUDO'"
  echo "PRESIGNED_GET_URL='$GET_URL'"; echo "PRESIGNED_DELETE_URL='$DEL_URL'"
  echo "PRESIGNED_PUT_STATUS_URL='$PUT_URL'"; echo "BUNDLE_PASSPHRASE='$PASSPHRASE'"
  cat "$HERE/cloud-init-body.sh"
} > "$USERDATA"

echo ">> creating $SERVER_NAME ($SERVER_TYPE $IMAGE $LOCATION)"
KEYS="[$SSH_KEY_ID"; [ -n "$EXTRA_SSH_KEY_ID" ] && KEYS="$KEYS,$EXTRA_SSH_KEY_ID"; KEYS="$KEYS]"
RESP="$(python3 - "$SERVER_NAME" "$SERVER_TYPE" "$IMAGE" "$LOCATION" "$KEYS" "$USERDATA" <<'PY'
import json,os,sys,urllib.request,urllib.error
name,stype,image,loc,keys,udpath=sys.argv[1:7]
body=json.dumps({"name":name,"server_type":stype,"image":image,"location":loc,
  "ssh_keys":json.loads(keys),"start_after_create":True,"labels":{"role":"claude-controller"},
  "user_data":open(udpath).read()}).encode()
req=urllib.request.Request("https://api.hetzner.cloud/v1/servers",data=body,
  headers={"Authorization":"Bearer "+os.environ["HETZNER_API"],"Content-Type":"application/json"})
try: print(urllib.request.urlopen(req).read().decode())
except urllib.error.HTTPError as e: print(json.dumps({"_http_error":e.code,"body":e.read().decode()}))
PY
)"
SID="$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('server',{}).get('id',''))" 2>/dev/null||true)"
SIP="$(echo "$RESP" | python3 -c "import sys,json;s=json.load(sys.stdin).get('server',{});print((s.get('public_net',{}).get('ipv4') or {}).get('ip',''))" 2>/dev/null||true)"
[ -n "$SID" ] || { echo "FATAL: create failed:"; echo "$RESP" | head -c 800; exit 1; }
echo ">> id=$SID ip=$SIP — waiting for bootstrap"

DEADLINE=$(( $(date +%s)+720 )); LAST=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  sleep 15
  CUR="$(curl -fsS "$STATUS_GET_URL" 2>/dev/null||true)"
  [ -n "$CUR" ] && [ "$CUR" != "$LAST" ] && { diff <(printf '%s' "$LAST") <(printf '%s' "$CUR") | grep '^>' | sed 's/^> /   /'; LAST="$CUR"; }
  echo "$CUR" | grep -q "bootstrap COMPLETE" && break
done
python3 - "$S3_KEY" <<'PY' 2>/dev/null||true
import boto3,os,sys
from botocore.config import Config
ep=os.environ["HETZNER_S3_ENDPOINT"]; ep=ep if ep.startswith("http") else "https://"+ep
boto3.client("s3",endpoint_url=ep,aws_access_key_id=os.environ["HETZNER_S3_ACCESS_KEY"],aws_secret_access_key=os.environ["HETZNER_S3_SECRET_KEY"],region_name=os.environ.get("HETZNER_S3_REGION","fsn1"),config=Config(signature_version="s3v4")).delete_object(Bucket=os.environ["HETZNER_S3_BUCKET"],Key=sys.argv[1])
PY
echo "=================================================================="
echo " controller: $SERVER_NAME (id $SID)  ip $SIP"
echo " dashboard : https://tunnel.deyaochen.com/t/portal/"
echo " status    : $(echo "$LAST" | grep -q 'bootstrap COMPLETE' && echo COMPLETE || echo INCOMPLETE)"
echo "=================================================================="
