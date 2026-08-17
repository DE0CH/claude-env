#!/usr/bin/env bash
# Upload files to the Hetzner Storage Box (claude-records, u652856) over WebDAV.
#
# Usage: storagebox-upload.sh <remote-dir> <file>...
#   <remote-dir> is relative to the box root, e.g. "claude-records/2026-08-17 my task".
#   Parent directories are created as needed. Filenames keep their basename.
#
# Credentials come from STORAGEBOX_HOST / STORAGEBOX_USER / STORAGEBOX_PASSWORD
# (harness env vars). WebDAV runs over 443, so it works from Claude-on-the-web
# pods (SSH/rsync ports are blocked there — use those only on the Mac).
# The egress gateway drops the odd CONNECT (transient 000/502), hence retries.
set -euo pipefail

: "${STORAGEBOX_HOST:?set STORAGEBOX_HOST}" "${STORAGEBOX_USER:?set STORAGEBOX_USER}" "${STORAGEBOX_PASSWORD:?set STORAGEBOX_PASSWORD}"
remote_dir="${1:?usage: storagebox-upload.sh <remote-dir> <file>...}"; shift
[ "$#" -ge 1 ] || { echo "no files given" >&2; exit 1; }

curlrc="$(mktemp)"; trap 'rm -f "$curlrc"' EXIT
printf 'user = "%s:%s"\n' "$STORAGEBOX_USER" "$STORAGEBOX_PASSWORD" > "$curlrc"

req() { # req <expect-regex> <curl-args...> -> retries transient gateway failures
  local expect="$1" code attempt; shift
  for attempt in 1 2 3 4 5; do
    code=$(curl -s -o /dev/null -m 300 -K "$curlrc" -w '%{http_code}' "$@") || code=000
    if [[ "$code" =~ $expect ]]; then echo "$code"; return 0; fi
    sleep $((attempt * 2))
  done
  echo "FAILED($code) on: $*" >&2; return 1
}

# create each path segment (MKCOL is not recursive); 405 = already exists
base="https://$STORAGEBOX_HOST"; path=""
IFS='/' read -ra segs <<< "$remote_dir"
for seg in "${segs[@]}"; do
  [ -n "$seg" ] || continue
  path="$path/$seg"
  req '^(201|405)$' -X MKCOL "$base$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$path")/" > /dev/null
done

for f in "$@"; do
  name=$(basename "$f")
  url="$base$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$path/$name")"
  code=$(req '^2' -T "$f" "$url")
  echo "uploaded $name ($code) -> $path/$name"
done
