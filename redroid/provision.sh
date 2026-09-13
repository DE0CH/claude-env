#!/bin/bash
# Provision the cloud-Android box on Hetzner Cloud from a session pod.
# Needs env: HETZNER_API. Creates the server with cloud-init.sh (no DNS / web UI: the box is
# driven over SSH + adb and managed from the portal's Android tab).
# Usage: redroid/provision.sh [server_type] [location]
set -euo pipefail
cd "$(dirname "$0")"
TYPE="${1:-cx33}"; LOC="${2:-hel1}"

# SSH key
KEYFILE="./id_redroid"
[ -f "$KEYFILE" ] || ssh-keygen -t ed25519 -N "" -f "$KEYFILE" -C "claude-redroid" >/dev/null
PUB=$(cat "$KEYFILE.pub")
KEYID=$(curl -s -X POST -H "Authorization: Bearer $HETZNER_API" -H "Content-Type: application/json" \
  -d "{\"name\":\"claude-redroid-$(date +%s)\",\"public_key\":\"$PUB\"}" \
  https://api.hetzner.cloud/v1/ssh_keys | python3 -c 'import sys,json;print(json.load(sys.stdin)["ssh_key"]["id"])')

# x86 Ubuntu 24.04 image id (name resolves ambiguously between x86/arm)
IMG=$(curl -s -H "Authorization: Bearer $HETZNER_API" 'https://api.hetzner.cloud/v1/images?name=ubuntu-24.04&per_page=10' \
  | python3 -c 'import sys,json;print([i["id"] for i in json.load(sys.stdin)["images"] if i["architecture"]=="x86"][0])')

# create server
python3 - "$KEYID" "$IMG" "$TYPE" "$LOC" <<'PY'
import sys,json,urllib.request,os
keyid,img,typ,loc=int(sys.argv[1]),int(sys.argv[2]),sys.argv[3],sys.argv[4]
ud=open("cloud-init.sh").read()
body={"name":"claude-redroid","server_type":typ,"image":img,"location":loc,
      "ssh_keys":[keyid],"user_data":ud,"labels":{"purpose":"redroid-android"}}
req=urllib.request.Request("https://api.hetzner.cloud/v1/servers",data=json.dumps(body).encode(),
     headers={"Authorization":f"Bearer {os.environ['HETZNER_API']}","Content-Type":"application/json"})
r=json.load(urllib.request.urlopen(req)); s=r["server"]; ip=s["public_net"]["ipv4"]["ip"]
open("server.json","w").write(json.dumps({"id":s["id"],"ip":ip,"type":typ,"loc":loc}))
print("SERVER",s["id"],ip)
PY
IP=$(python3 -c 'import json;print(json.load(open("server.json"))["ip"])')
echo "Done. cloud-init runs ~3-5 min (docker + redroid image pull). SSH: ssh -i $KEYFILE root@$IP"
echo "Then put the private key in the default environment as REDROID_SSH_KEY (and REDROID_IP=$IP)"
echo "so the portal's Android tab and future sessions can reach it."
