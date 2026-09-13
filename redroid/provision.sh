#!/bin/bash
# Provision the cloud-Android box on Hetzner Cloud from a session pod.
# Needs env: HETZNER_API, CLOUDFLARE_API. Creates DNS A record + server with cloud-init.sh.
# Usage: redroid/provision.sh [server_type] [location] [domain]
set -euo pipefail
cd "$(dirname "$0")"
TYPE="${1:-cx33}"; LOC="${2:-hel1}"; DOMAIN="${3:-android.deyaochen.com}"
SUB="${DOMAIN%%.*}"; ZONE_NAME="${DOMAIN#*.}"

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

# create server (cloud-init.sh defaults REDROID_DOMAIN to android.deyaochen.com;
# edit that default in cloud-init.sh if you pass a different domain)
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

# DNS A record (grey cloud so Caddy can do LE HTTP-01)
ZONE=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API" "https://api.cloudflare.com/client/v4/zones?name=$ZONE_NAME" | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"][0]["id"])')
curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API" -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
  -d "{\"type\":\"A\",\"name\":\"$SUB\",\"content\":\"$IP\",\"ttl\":120,\"proxied\":false}" >/dev/null
echo "DNS $DOMAIN -> $IP"
echo "Done. cloud-init runs ~5-8 min (image pull + ws-scrcpy build)."
echo "Basic-auth password will be in /root/ws-auth.txt on the box. URL: https://$DOMAIN"
