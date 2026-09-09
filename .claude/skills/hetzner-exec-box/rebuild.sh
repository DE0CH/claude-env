#!/usr/bin/env bash
# Rebuild the hexec exec box from the existing Flatcar snapshot.
# Run from any machine with: butane, jq, openssl, curl. Needs HETZNER_API,
# CLOUDFLARE_API, HEXEC_KEY in the env (source ~/.secrets first).
#
#   set -a; . ~/.secrets; set +a
#   HEXEC_KEY=<key> .claude/skills/hetzner-exec-box/rebuild.sh
#
# HEXEC_KEY is the source of truth for the API key so consumers keep working
# across rebuilds. If unset, a new one is generated and printed once.
set -euo pipefail

SNAPSHOT_ID="${SNAPSHOT_ID:-429946739}"   # Flatcar stable (hetzner OEM) x86 snapshot
SERVER_NAME="${SERVER_NAME:-hexec}"
SERVER_TYPE="${SERVER_TYPE:-cx23}"        # cheapest creatable x86 (cx22 is deprecated)
LOCATION="${LOCATION:-fsn1}"
FQDN="${FQDN:-hexec.deyaochen.com}"
CF_ZONE="${CF_ZONE:-f51ca95ee5e6c664372000f887c96a92}"   # deyaochen.com
SUBDOMAIN="${FQDN%%.*}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${HETZNER_API:?set HETZNER_API}"; : "${CLOUDFLARE_API:?set CLOUDFLARE_API}"
if [ -z "${HEXEC_KEY:-}" ]; then
  HEXEC_KEY="$(openssl rand -hex 32)"
  echo ">> generated a NEW HEXEC_KEY (add it to ~/.secrets and the pod env):"
  echo "$HEXEC_KEY"
fi

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/files"
cp "$here/files/server.py" "$here/files/workspace-init.sh" "$here/files/butane.yaml" "$work/files/" 2>/dev/null || true
cp "$here/files/butane.yaml" "$work/butane.yaml"
sed "s|__APIKEY__|$HEXEC_KEY|" "$here/files/Caddyfile.tmpl" > "$work/files/Caddyfile"
butane --strict --files-dir "$work/files" "$work/butane.yaml" > "$work/ignition.json"
echo ">> ignition.json rendered ($(wc -c < "$work/ignition.json" | tr -d ' ') bytes)"

api() { curl -s -m 40 --retry 2 --retry-all-errors -H "Authorization: Bearer $HETZNER_API" "$@"; }

old=$(api "https://api.hetzner.cloud/v1/servers?name=$SERVER_NAME" | jq -r '.servers[0].id // empty')
if [ -n "$old" ]; then
  echo ">> deleting existing server $old"
  api -X DELETE "https://api.hetzner.cloud/v1/servers/$old" >/dev/null
  sleep 5
fi

echo ">> creating $SERVER_TYPE from snapshot $SNAPSHOT_ID"
resp=$(jq -n --rawfile ud "$work/ignition.json" \
  --arg name "$SERVER_NAME" --arg type "$SERVER_TYPE" --arg loc "$LOCATION" \
  --argjson img "$SNAPSHOT_ID" '{name:$name,server_type:$type,image:$img,location:$loc,
    public_net:{enable_ipv4:true,enable_ipv6:true},
    labels:{purpose:"exec-box",managed_by:"claude"},user_data:$ud}' \
  | api -X POST -H "Content-Type: application/json" -d @- https://api.hetzner.cloud/v1/servers)
err=$(echo "$resp" | jq -r '.error // empty')
[ -z "$err" ] || { echo "!! create error: $err"; exit 1; }
ip=$(echo "$resp" | jq -r '.server.public_net.ipv4.ip')
id=$(echo "$resp" | jq -r '.server.id')
echo ">> server $id  ip=$ip"

echo ">> upserting DNS $FQDN -> $ip (DNS-only)"
cf() { curl -s -m 20 -H "Authorization: Bearer $CLOUDFLARE_API" -H "Content-Type: application/json" "$@"; }
rec=$(cf "https://api.cloudflare.com/client/v4/zones/$CF_ZONE/dns_records?type=A&name=$FQDN" | jq -r '.result[0].id // empty')
body=$(jq -n --arg s "$SUBDOMAIN" --arg ip "$ip" '{type:"A",name:$s,content:$ip,ttl:120,proxied:false}')
if [ -n "$rec" ]; then
  cf -X PUT -d "$body" "https://api.cloudflare.com/client/v4/zones/$CF_ZONE/dns_records/$rec" | jq -r '.success'
else
  cf -X POST -d "$body" "https://api.cloudflare.com/client/v4/zones/$CF_ZONE/dns_records" | jq -r '.success'
fi

echo ">> waiting for https://$FQDN/health ..."
for i in $(seq 1 30); do
  code=$(curl -s -m 8 -o /dev/null -w "%{http_code}" -H "X-API-Key: $HEXEC_KEY" "https://$FQDN/health" || true)
  [ "$code" = "200" ] && { echo ">> READY"; exit 0; }
  sleep 10
done
echo "!! not healthy yet; debug with: ssh core@$ip  (then: journalctl -u workspace -u caddy)"; exit 1
