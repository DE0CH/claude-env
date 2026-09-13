#!/bin/bash
# destroy.sh — delete the controller cluster box (name default "claude-controller", or id as $1).
# Safe to rerun create.sh afterwards: everything comes back from git + the age key.
set -euo pipefail
if [ -z "${HETZNER_API:-}" ] && [ -f "${SECRETS_FILE:-$HOME/.secrets}" ]; then
  HETZNER_API="$(python3 -c "
import sys
for l in open(sys.argv[1]):
    if l.startswith('HETZNER_API='): print(l.rstrip('\n').split('=',1)[1]); break" "${SECRETS_FILE:-$HOME/.secrets}")"
fi
: "${HETZNER_API:?}"
T="${1:-claude-controller}"; ID="$T"
if ! [[ "$T" =~ ^[0-9]+$ ]]; then
  ID="$(curl -fsS -H "Authorization: Bearer $HETZNER_API" "https://api.hetzner.cloud/v1/servers?name=$T" | python3 -c "import sys,json;s=json.load(sys.stdin)['servers'];print(s[0]['id'] if s else '')")"
fi
[ -n "$ID" ] || { echo "no server '$T'"; exit 0; }
curl -fsS -X DELETE -H "Authorization: Bearer $HETZNER_API" "https://api.hetzner.cloud/v1/servers/$ID" >/dev/null
echo "deleted $ID ($T). Running Fly session machines are NOT touched — destroy them in the dashboard."
