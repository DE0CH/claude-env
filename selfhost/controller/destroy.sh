#!/bin/bash
# destroy.sh — delete the controller box (name default "claude-controller", or id as $1).
set -euo pipefail
set -a; . "${SECRETS_FILE:-$HOME/.secrets}"; set +a
: "${HETZNER_API:?}"
T="${1:-claude-controller}"; ID="$T"
if ! [[ "$T" =~ ^[0-9]+$ ]]; then
  ID="$(curl -fsS -H "Authorization: Bearer $HETZNER_API" "https://api.hetzner.cloud/v1/servers?name=$T" | python3 -c "import sys,json;s=json.load(sys.stdin)['servers'];print(s[0]['id'] if s else '')")"
fi
[ -n "$ID" ] || { echo "no server '$T'"; exit 0; }
curl -fsS -X DELETE -H "Authorization: Bearer $HETZNER_API" "https://api.hetzner.cloud/v1/servers/$ID" >/dev/null
echo "deleted $ID ($T). Note: running Fly session machines are NOT deleted — destroy them in the dashboard."
