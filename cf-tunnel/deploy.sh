#!/usr/bin/env bash
# Deploy the Cloudflare tunnel edge + set up Access (see ngrok.md).
#
# Prereqs:
#   - ~/drop/cftoken  : a Cloudflare API token with permissions
#       Account: Workers Scripts:Edit, Access: Apps and Policies:Edit,
#                Access: Service Tokens:Edit, Account Settings:Read
#       Zone (deyaochen.com): DNS:Edit, Workers Routes:Edit, Zone:Read
#   - wrangler, curl, jq on PATH
#
# Idempotent-ish: re-running updates the Worker and re-uses existing Access
# app / service token by name where possible.
#
# Outputs (local disk only, never printed):
#   ~/drop/tunnel.env  : the container agent's env (worker url, secret, service token)
set -euo pipefail

HOSTNAME="tunnel.deyaochen.com"
WORKER_NAME="claude-tunnel"
ACCOUNT_ID="ee3b4deef856baf11e1a67b242438325"
ZONE_ID="f51ca95ee5e6c664372000f887c96a92"
ALLOWED_EMAIL="${ALLOWED_EMAIL:-chendeyao.hk@gmail.com}"
HERE="$(cd "$(dirname "$0")" && pwd)"

TOKEN="$(cat ~/drop/cftoken)"
export CLOUDFLARE_API_TOKEN="$TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
API="https://api.cloudflare.com/client/v4"
auth=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

say() { printf '==> %s\n' "$*"; }
api() { curl -s "${auth[@]}" "$@"; }

# 1. Worker secret (shared agent secret) --------------------------------------
if [ ! -f ~/drop/agent_secret ]; then
  head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40 > ~/drop/agent_secret
  chmod 600 ~/drop/agent_secret
fi
AGENT_SECRET="$(cat ~/drop/agent_secret)"

# 2. Deploy the Worker --------------------------------------------------------
say "deploying Worker $WORKER_NAME"
( cd "$HERE" && printf '%s' "$AGENT_SECRET" | wrangler secret put AGENT_SECRET --name "$WORKER_NAME" >/dev/null 2>&1 || true )
( cd "$HERE" && wrangler deploy >/tmp/wrangler-deploy.log 2>&1 ) || { echo "wrangler deploy failed:"; cat /tmp/wrangler-deploy.log; exit 1; }
# secret again after first deploy in case the script did not exist yet
( cd "$HERE" && printf '%s' "$AGENT_SECRET" | wrangler secret put AGENT_SECRET --name "$WORKER_NAME" >/dev/null 2>&1 || true )

# 3. Custom domain tunnel.deyaochen.com --------------------------------------
say "attaching custom domain $HOSTNAME"
api -X PUT "$API/accounts/$ACCOUNT_ID/workers/domains" \
  --data "{\"environment\":\"production\",\"hostname\":\"$HOSTNAME\",\"service\":\"$WORKER_NAME\",\"zone_id\":\"$ZONE_ID\"}" \
  | jq -e '.success' >/dev/null || say "custom domain: may already exist (continuing)"

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
say "creating Access service token"
ST_JSON="$(api -X POST "$API/accounts/$ACCOUNT_ID/access/service_tokens" \
  --data '{"name":"claude-container-agent","duration":"forever"}')"
CID="$(printf '%s' "$ST_JSON" | jq -r '.result.client_id // empty')"
CSECRET="$(printf '%s' "$ST_JSON" | jq -r '.result.client_secret // empty')"

# 6. Access policies: allow the email OR the service token --------------------
say "writing Access policies"
POLICY_BODY="$(cat <<JSON
{"name":"allow-owner-and-agent","decision":"allow","precedence":1,
 "include":[{"email":{"email":"$ALLOWED_EMAIL"}},{"service_token":{"token_id":"$CID"}}]}
JSON
)"
# non-identity policy so the service token alone (no login) is accepted
api -X POST "$API/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies" --data "$POLICY_BODY" >/dev/null || true

# 7. Write the container agent's env (local disk only) ------------------------
umask 077
cat > ~/drop/tunnel.env <<ENV
TUNNEL_WORKER_URL=wss://$HOSTNAME/__agent
TUNNEL_AGENT_SECRET=$AGENT_SECRET
CF_ACCESS_CLIENT_ID=$CID
CF_ACCESS_CLIENT_SECRET=$CSECRET
TUNNEL_TARGET=http://127.0.0.1:8899
ENV
chmod 600 ~/drop/tunnel.env

say "done. Public URL: https://$HOSTNAME/  (Access-gated: $ALLOWED_EMAIL)"
say "agent env written to ~/drop/tunnel.env"
