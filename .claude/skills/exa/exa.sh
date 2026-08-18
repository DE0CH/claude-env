#!/usr/bin/env bash
# Direct Exa API (api.exa.ai) — thin wrapper over the four main endpoints.
# Auth: env var EXA_API, else cached at scratchpad/exa_key (repo-relative, gitignored).
#
# Usage:
#   exa.sh search   "query" [num]        # neural search + content excerpts + highlights
#   exa.sh answer    "question"          # LLM answer grounded in Exa results, with citations
#   exa.sh contents  <url> [url2 ...]    # fetch clean extracted text for specific URLs
#   exa.sh similar   <url> [num]         # find pages similar to a URL
#
# Prints clean JSON to stdout and a "[exa] cost=$… " line to stderr.
# Run from the repo root so the scratchpad fallback resolves.
set -euo pipefail

CMD="${1:?usage: exa.sh <search|answer|contents|similar> ...}"; shift

python3 - "$CMD" "$@" <<'PY'
import json, os, sys, urllib.request

cmd, rest = sys.argv[1], sys.argv[2:]
key = os.environ.get("EXA_API")
if not key:
    for p in ("scratchpad/exa_key", os.path.expanduser("~/claude-env/scratchpad/exa_key")):
        if os.path.exists(p):
            key = open(p).read().strip(); break
if not key:
    sys.exit("no EXA_API env var and no scratchpad/exa_key (run from repo root)")

def call(path, payload):
    req = urllib.request.Request("https://api.exa.ai"+path, data=json.dumps(payload).encode(),
        headers={"x-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"exa {path} HTTP {e.code}: {e.read().decode()[:300]}")

if cmd == "search":
    q = rest[0]; num = int(rest[1]) if len(rest) > 1 else 5
    d = call("/search", {"query": q, "numResults": num, "type": "auto",
        "contents": {"text": {"maxCharacters": 1000}, "highlights": {"numSentences": 2}}})
    out = [{"title": x.get("title"), "url": x.get("url"),
            "published": x.get("publishedDate"),
            "highlights": x.get("highlights"),
            "text": x.get("text")} for x in d.get("results", [])]
elif cmd == "answer":
    d = call("/answer", {"query": rest[0], "text": False})
    out = {"answer": d.get("answer"),
           "citations": [{"title": c.get("title"), "url": c.get("url")} for c in d.get("citations", [])]}
elif cmd == "contents":
    d = call("/contents", {"urls": rest, "text": True})
    out = [{"url": x.get("url"), "title": x.get("title"), "text": x.get("text")} for x in d.get("results", [])]
elif cmd == "similar":
    url = rest[0]; num = int(rest[1]) if len(rest) > 1 else 5
    d = call("/findSimilar", {"url": url, "numResults": num,
        "contents": {"text": {"maxCharacters": 500}}})
    out = [{"title": x.get("title"), "url": x.get("url"), "text": x.get("text")} for x in d.get("results", [])]
else:
    sys.exit(f"unknown command: {cmd}")

cost = (d.get("costDollars") or {}).get("total") if isinstance(d, dict) else None
sys.stderr.write(f"[exa] {cmd} cost=${cost}\n")
print(json.dumps(out, ensure_ascii=False, indent=2))
PY
