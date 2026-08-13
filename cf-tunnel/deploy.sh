#!/usr/bin/env bash
# Deploy the Cloudflare tunnel edge + set up Access (see tunnel.md).
#
# One-time setup. The container is ephemeral, so this reads the Cloudflare API
# token from the environment variable CLOUDFLARE_API (set in the CCR
# environment config, like the other secrets), NOT a file. Falls back to
# ~/drop/cftoken if the env var is not present in this session yet.
#
# Token permissions:
#   Account: Workers Scripts:Edit, Access: Apps and Policies:Edit,
#            Access: Service Tokens:Edit, Account Settings:Read
#   Zone (deyaochen.com): DNS:Edit, Workers Routes:Edit, Zone:Read
# Requires wrangler, curl, jq on PATH.
#
# On success it prints the two Access service-token values (CF_ACCESS_CLIENT_ID
# and CF_ACCESS_CLIENT_SECRET) that must be added to the environment's variables
# so future sessions' agents can authenticate. These are the ONLY per-agent
# secrets; everything else is either in the repo or on Cloudflare.
set -euo pipefail

HOSTNAME="tunnel.deyaochen.com"
WORKER_NAME="claude-tunnel"
ACCOUNT_ID="ee3b4deef856baf11e1a67b242438325"
ZONE_ID="f51ca95ee5e6c664372000f887c96a92"
HERE="$(cd "$(dirname "$0")" && pwd)"

TOKEN="${CLOUDFLARE_API:-}"
[ -z "$TOKEN" ] && [ -f ~/drop/cftoken ] && TOKEN="$(cat ~/drop/cftoken)"
if [ -z "$TOKEN" ]; then
  echo "No Cloudflare API token: set CLOUDFLARE_API in the environment (or drop ~/drop/cftoken)." >&2
  exit 1
fi
export CLOUDFLARE_API_TOKEN="$TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
API="https://api.cloudflare.com/client/v4"
auth=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

say() { printf '==> %s\n' "$*"; }
api() { curl -s "${auth[@]}" "$@"; }

# 1. Deploy the Worker --------------------------------------------------------
# No AGENT_SECRET: Cloudflare Access (service token) is the auth for /__agent.
say "deploying Worker $WORKER_NAME"
( cd "$HERE" && wrangler deploy >/tmp/wrangler-deploy.log 2>&1 ) || { echo "wrangler deploy failed:"; cat /tmp/wrangler-deploy.log; exit 1; }

# 3. Route the hostname to the Worker ----------------------------------------
# The Workers Custom Domains API (PUT /workers/domains) returns a 10000 auth
# error with this token, so we use the equivalent primitives the token can
# do: a proxied DNS record + a Worker route. Both are idempotent here.
say "pointing $HOSTNAME at the Worker (proxied DNS record + route)"
if [ -z "$(api "$API/zones/$ZONE_ID/dns_records?name=$HOSTNAME" | jq -r '.result[0].id // empty')" ]; then
  api -X POST "$API/zones/$ZONE_ID/dns_records" \
    --data "{\"type\":\"A\",\"name\":\"tunnel\",\"content\":\"192.0.2.1\",\"proxied\":true,\"comment\":\"claude-tunnel worker route\"}" \
    | jq -e '.success' >/dev/null && say "created DNS record" || say "DNS record: continuing"
else
  say "DNS record already exists"
fi
if [ -z "$(api "$API/zones/$ZONE_ID/workers/routes" | jq -r --arg p "$HOSTNAME/*" '.result[]?|select(.pattern==$p)|.id')" ]; then
  api -X POST "$API/zones/$ZONE_ID/workers/routes" \
    --data "{\"pattern\":\"$HOSTNAME/*\",\"script\":\"$WORKER_NAME\"}" \
    | jq -e '.success' >/dev/null && say "created Worker route" || say "Worker route: continuing"
else
  say "Worker route already exists"
fi

# 4. Cloudflare Access application + policy -----------------------------------
say "configuring Cloudflare Access for $HOSTNAME"
APP_ID="$(api "$API/accounts/$ACCOUNT_ID/access/apps?domain=$HOSTNAME" | jq -r '.result[0].id // empty')"
APP_BODY="{\"name\":\"Claude Tunnel\",\"domain\":\"$HOSTNAME\",\"type\":\"self_hosted\",\"session_duration\":\"24h\"}"
if [ -z "$APP_ID" ]; then
  APP_ID="$(api -X POST "$API/accounts/$ACCOUNT_ID/access/apps" --data "$APP_BODY" | jq -r '.result.id')"
  say "created Access app $APP_ID"
else
  api -X PUT "$API/accounts/$ACCOUNT_ID/access/apps/$APP_ID" --data "$APP_BODY" >/dev/null
  say "updated Access app $APP_ID"
fi

# 5. Service token (for the container agent to bypass the login) --------------
# Delete any existing token of this name first (its secret is unrecoverable,
# so we always mint a fresh one and emit it for the environment config).
say "creating Access service token"
OLD_ST="$(api "$API/accounts/$ACCOUNT_ID/access/service_tokens" | jq -r '.result[]?|select(.name=="claude-container-agent")|.id')"
for t in $OLD_ST; do api -X DELETE "$API/accounts/$ACCOUNT_ID/access/service_tokens/$t" >/dev/null || true; done
ST_JSON="$(api -X POST "$API/accounts/$ACCOUNT_ID/access/service_tokens" \
  --data '{"name":"claude-container-agent","duration":"forever"}')"
ST_ID="$(printf '%s' "$ST_JSON" | jq -r '.result.id // empty')"          # UUID (for the policy)
CID="$(printf '%s' "$ST_JSON" | jq -r '.result.client_id // empty')"     # client id (for the agent)
CSECRET="$(printf '%s' "$ST_JSON" | jq -r '.result.client_secret // empty')"

# 6. Access policies: allow the owner email, and the service token ------------
# Recreate policies idempotently: remove any we previously made, then add.
say "writing Access policies"
for pid in $(api "$API/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies" | jq -r '.result[]?|select(.name=="allow-owner-email" or .name=="allow-agent-service-token")|.id'); do
  api -X DELETE "$API/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies/$pid" >/dev/null || true
done
# identity policy: allow the owner's email (one-time PIN login)
EMAIL_POLICY="$(cat <<JSON
{"name":"allow-owner-email","decision":"allow","precedence":1,
 "include":[{"email":{"email":"chendeyao000@gmail.com"}}]}
JSON
)"
api -X POST "$API/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies" --data "$EMAIL_POLICY" >/dev/null || true
# non-identity policy: allow the container agent's service token (no login).
# NOTE: token_id is the service token's UUID (.result.id), NOT the client_id.
SVC_POLICY="$(cat <<JSON
{"name":"allow-agent-service-token","decision":"non_identity","precedence":2,
 "include":[{"service_token":{"token_id":"$ST_ID"}}]}
JSON
)"
api -X POST "$API/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies" --data "$SVC_POLICY" >/dev/null || true

# 7. Emit the agent credentials for the environment config --------------------
# The agent reads these from env vars (CF_ACCESS_CLIENT_ID / _SECRET). Because
# the container is ephemeral, add them to the CCR environment's variables so
# every future session has them — do NOT rely on a file. A copy is written to
# ~/drop/service-token for THIS session's immediate use only.
umask 077
printf 'CF_ACCESS_CLIENT_ID=%s\nCF_ACCESS_CLIENT_SECRET=%s\n' "$CID" "$CSECRET" > ~/drop/service-token
chmod 600 ~/drop/service-token

say "done. Public URL: https://$HOSTNAME/  (Access-gated: chendeyao000@gmail.com)"
echo
echo "Service-token creds written to ~/drop/service-token (CF_ACCESS_CLIENT_ID,"
echo "CF_ACCESS_CLIENT_SECRET). The SECRET is not printed here to keep it out of"
echo "the transcript. Add both to the environment config so future sessions have"
echo "them, then relay them to Deyao via Discord (never echo the secret)."
echo
say "run the agent this session: set -a; . ~/drop/service-token; set +a; node cf-tunnel/agent.js &"
