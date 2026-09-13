#!/bin/bash
# rebuild.sh — nuke the box and recreate it identically from git + secrets.
# The whole point of the stateless design: this is safe to run anytime.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="${1:-claude-remote}"
"$HERE/destroy.sh" "$NAME" || true
echo ">> waiting 10s for the delete to settle ..."; sleep 10
exec "$HERE/create.sh" "$NAME"
