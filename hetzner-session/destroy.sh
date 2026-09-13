#!/bin/bash
# destroy.sh — delete the Claude remote-control box (by name, default "claude-remote",
# or by numeric id as $1). Only touches servers in the HETZNER_API token's project.
set -euo pipefail
set -a; . "${SECRETS_FILE:-$HOME/.secrets}"; set +a
: "${HETZNER_API:?missing HETZNER_API}"
TARGET="${1:-claude-remote}"

ID="$TARGET"
if ! [[ "$TARGET" =~ ^[0-9]+$ ]]; then
  ID="$(curl -fsS -H "Authorization: Bearer $HETZNER_API" \
    "https://api.hetzner.cloud/v1/servers?name=$TARGET" \
    | python3 -c "import sys,json;s=json.load(sys.stdin)['servers'];print(s[0]['id'] if s else '')")"
fi
[ -n "$ID" ] || { echo "no server named '$TARGET' in this project — nothing to do"; exit 0; }

echo ">> deleting server id=$ID ($TARGET) ..."
curl -fsS -X DELETE -H "Authorization: Bearer $HETZNER_API" \
  "https://api.hetzner.cloud/v1/servers/$ID" >/dev/null
echo ">> deleted."
