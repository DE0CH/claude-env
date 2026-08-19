#!/usr/bin/env bash
# SerpApi helper — key from $SERPAPI_KEY. JSON to stdout, status line to stderr.
# usage:
#   serpapi.sh search  "query" [num]        # Google organic + answer_box/KG/AI-overview
#   serpapi.sh news    "query" [num]        # Google News
#   serpapi.sh images  "query" [num]        # Google Images
#   serpapi.sh scholar "query" [num]        # Google Scholar
#   serpapi.sh account                      # plan / searches left
#   serpapi.sh raw     <engine> [k=v ...]   # full JSON, any engine/params (values NOT urlencoded)
set -euo pipefail
: "${SERPAPI_KEY:?SERPAPI_KEY not set}"
cmd=${1:?usage: serpapi.sh search|news|images|scholar|account|raw ...}
shift || true

api() { # api <engine> [extra curl args...]
  local engine=$1; shift
  curl -sS -G "https://serpapi.com/search" \
    --data-urlencode "api_key=$SERPAPI_KEY" \
    --data-urlencode "engine=$engine" "$@"
}

compact() { # compact <list_key>  (reads full JSON on stdin, prints trimmed JSON)
  python3 -c '
import json, sys
key = sys.argv[1]
d = json.load(sys.stdin)
if d.get("error"):
    print(json.dumps({"error": d["error"]})); sys.exit(1)
out = {}
for extra in ("answer_box", "knowledge_graph", "ai_overview"):
    if d.get(extra): out[extra] = d[extra]
limit = int(sys.argv[2]) if len(sys.argv) > 2 else None
rows = []
for r in d.get(key, [])[:limit]:
    rows.append({k: r.get(k) for k in
        ("position","title","link","source","snippet","date","publication_info","original","thumbnail")
        if r.get(k) is not None})
out[key] = rows
print(json.dumps(out, ensure_ascii=False, indent=1))
sm = d.get("search_metadata", {})
print("[serpapi] %s %s %d results" % (sm.get("id","?"), sm.get("status","?"), len(rows)), file=sys.stderr)
' "$@"
}

case "$cmd" in
  search)  q=${1:?query}; n=${2:-10}
           api google --data-urlencode "q=$q" --data-urlencode "num=$n" | compact organic_results "$n" ;;
  news)    q=${1:?query}; n=${2:-10}
           api google_news --data-urlencode "q=$q" | compact news_results "$n" ;;
  images)  q=${1:?query}; n=${2:-10}
           api google_images --data-urlencode "q=$q" | compact images_results "$n" ;;
  scholar) q=${1:?query}; n=${2:-10}
           api google_scholar --data-urlencode "q=$q" --data-urlencode "num=$n" | compact organic_results "$n" ;;
  account) curl -sS -G "https://serpapi.com/account" --data-urlencode "api_key=$SERPAPI_KEY" |
           python3 -c 'import json,sys; d=json.load(sys.stdin); d.pop("api_key",None); print(json.dumps(d,indent=1))' ;;
  raw)     engine=${1:?engine}; shift
           args=(); for kv in "$@"; do args+=(--data-urlencode "$kv"); done
           api "$engine" "${args[@]}" ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
