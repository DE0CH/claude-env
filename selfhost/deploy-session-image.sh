#!/bin/bash
# Build + push the Fly session image, then record its ref in the portal config.
# Run on the controller (needs flyctl + FLY_API_TOKEN + PORTAL_ENC_KEY + HETZNER_S3_* in env).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a; . "${SECRETS_FILE:-$HOME/.secrets}" 2>/dev/null || true; set +a
: "${FLY_API_TOKEN:?missing FLY_API_TOKEN}"
APP="${FLY_APP:-de0ch-claude-sessions}"
export FLY_ACCESS_TOKEN="$FLY_API_TOKEN"   # flyctl reads this
FLY="${FLYCTL:-$(command -v flyctl || command -v fly || echo "$HOME/.fly/bin/flyctl")}"

echo ">> ensuring Fly app '$APP' exists"
"$FLY" apps create "$APP" --machines 2>/dev/null || echo "   (app exists)"

echo ">> building + pushing image on Fly's remote builder"
OUT="$("$FLY" deploy "$HERE/session-image" --config "$HERE/session-image/fly.toml" \
        --app "$APP" --build-only --push 2>&1 | tee /dev/stderr)"

# capture the image ref
IMG="$(printf '%s\n' "$OUT" | grep -oE 'registry\.fly\.io/[^ ]*' | tail -1 || true)"
if [ -z "$IMG" ]; then
  echo ">> parsing failed; querying current image"
  IMG="$("$FLY" image show --app "$APP" --json 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('Ref') or d.get('ref') or '')" 2>/dev/null || true)"
fi
[ -n "$IMG" ] || { echo "FATAL: could not determine image ref"; exit 1; }
echo ">> image: $IMG"

echo ">> recording image ref in portal config (S3)"
( cd "$HERE/portal" && node set-image.js "$IMG" )
echo ">> done."
