#!/usr/bin/env bash
# Exa web search via OpenRouter's `web` plugin (engine=exa).
# Returns clean JSON: [{title, url, content}, ...] from the response annotations.
# The LLM completion is forced tiny (reply "OK"); the real payload is the Exa
# results injected as url_citation annotations, so cost ≈ the Exa search fee only.
#
# Usage:   exa_search.sh "your query" [num_results]
#          exa_search.sh "exa.ai pricing 2026" 8
# Env:     OPENROUTER_API   (note: not OPENROUTER_API_KEY in this environment)
set -euo pipefail

QUERY="${1:?usage: exa_search.sh <query> [num_results]}"
NUM="${2:-5}"
MODEL="${EXA_SEARCH_MODEL:-openai/gpt-4o-mini}"   # any cheap model; only used to host the plugin

python3 - "$QUERY" "$NUM" "$MODEL" <<'PY'
import json, os, sys, urllib.request

query, num, model = sys.argv[1], int(sys.argv[2]), sys.argv[3]
key = os.environ.get("OPENROUTER_API") or os.environ.get("OPENROUTER_API_KEY")
if not key:
    sys.exit("OPENROUTER_API not set")

body = json.dumps({
    "model": model,
    "plugins": [{"id": "web", "engine": "exa", "max_results": num}],
    "max_tokens": 20,
    "messages": [{"role": "user", "content": f"{query}\n\n(Reply with just: OK)"}],
}).encode()

req = urllib.request.Request(
    "https://openrouter.ai/api/v1/chat/completions",
    data=body,
    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=60) as r:
    d = json.load(r)

if "choices" not in d:
    sys.exit("error: " + json.dumps(d)[:400])

ann = d["choices"][0]["message"].get("annotations") or []
out = [{
    "title": a["url_citation"].get("title", ""),
    "url": a["url_citation"].get("url", ""),
    "content": a["url_citation"].get("content", ""),
} for a in ann if a.get("type") == "url_citation"]

sys.stderr.write(f"[exa] {len(out)} results, cost=${d.get('usage',{}).get('cost')}\n")
print(json.dumps(out, ensure_ascii=False, indent=2))
PY
