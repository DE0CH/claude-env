---
name: exa
description: >
  Direct Exa API (api.exa.ai) — AI-native web search that returns semantically
  ranked results WITH clean extracted page content, plus grounded LLM answers,
  URL content fetch, and find-similar. SECONDARY web-search tool: the `serpapi`
  skill is the primary (Deyao, 2026-08-19) — reach for Exa when a task needs
  extracted page content WITH the search (research/RAG over many pages), semantic
  matching / find-similar, /contents on known URLs, or when the SerpApi quota is
  exhausted. Richer than the OpenRouter route (autoprompt, filters, /answer,
  /contents, /findSimilar). Prefer over Browserbase/ScrapingBee "type into Google"
  flows.
allowed-tools: Bash
---

# Exa (direct API)

**Secondary web-search tool** — the `serpapi` skill is the default (Deyao,
2026-08-19); use Exa for content-with-search, find-similar, `/contents`, or when
SerpApi's quota is out. Exa is a neural/embeddings search engine built for LLMs:
one call returns ranked results *and* the extracted page text, so you get URLs +
readable content together. Faster and richer than driving Google in a browser.

Two ways to reach Exa in this environment:
- **This skill — the direct `api.exa.ai` key.** Full feature set (filters, `/answer`,
  `/contents`, `/findSimilar`). Prefer this.
- The **`exa-search` skill** (Exa via OpenRouter's web plugin) — no Exa key needed,
  but search-only. Use it as a fallback if the direct key is unavailable.

## Auth

- **Env var `EXA_API`** (a UUID-form key). **Not yet a session env var** — ask Deyao
  to persist it for future sessions. This session it's cached (gitignored) at
  **`scratchpad/exa_key`**; the helper falls back to that file. Run from the repo root.
- Header on every request: `x-api-key: $EXA_API` (Exa also accepts
  `Authorization: Bearer <key>`).

## Cost (verified 2026-08-18)

- `/search` neural: **$0.007 per request** (≈ $7 / 1k searches), independent of
  `numResults` for the search itself; requesting `contents` (text/highlights) can add
  a little. `/answer`: ~$0.005/call. `/contents` and `/findSimilar` similar.
- The response includes `costDollars.total` — trust that field for the real number.

## Fastest path — the helper

```bash
.claude/skills/exa/exa.sh search   "your query" [num]     # → [{title,url,published,highlights,text}]
.claude/skills/exa/exa.sh answer   "your question"        # → {answer, citations:[{title,url}]}
.claude/skills/exa/exa.sh contents <url> [url2 ...]       # → [{url,title,text}]  (clean extracted text)
.claude/skills/exa/exa.sh similar  <url> [num]            # → [{title,url,text}]
```

JSON to stdout, a `[exa] <cmd> cost=$…` line to stderr. Read a result's `text`/`highlights`
directly — no scraping needed. For the *full* page (helper truncates), pass its URL to
`contents`.

## Raw API (four endpoints, all POST, JSON, `x-api-key` header)

**`/search`** — the workhorse. `type: "auto"` lets Exa pick neural vs keyword (and
autoprompt-rewrite the query). Ask for content inline so you don't need a second call:
```bash
curl -s https://api.exa.ai/search -H "x-api-key: $EXA_API" -H "Content-Type: application/json" -d '{
  "query": "latest Anthropic model announcement",
  "type": "auto",
  "numResults": 5,
  "contents": { "text": {"maxCharacters": 1000}, "highlights": {"numSentences": 2} }
}'
# results[] → {title, url, publishedDate, text, highlights, score}
```

**`/answer`** — search + LLM-synthesized answer with citations, one shot:
```bash
curl -s https://api.exa.ai/answer -H "x-api-key: $EXA_API" -H "Content-Type: application/json" \
  -d '{"query":"What is Exa'\''s pricing per 1k searches?"}'
# → { answer, citations:[{title,url,...}] }
```

**`/contents`** — clean extracted text/markdown for URLs you already have (great for
turning any link into LLM-ready text). Options: `text`, `highlights`, `summary`,
`livecrawl: "always"|"fallback"`:
```bash
curl -s https://api.exa.ai/contents -H "x-api-key: $EXA_API" -H "Content-Type: application/json" \
  -d '{"urls":["https://example.com/post"],"text":true}'
```

**`/findSimilar`** — pages semantically similar to a URL:
```bash
curl -s https://api.exa.ai/findSimilar -H "x-api-key: $EXA_API" -H "Content-Type: application/json" \
  -d '{"url":"https://exa.ai","numResults":5}'
```

## Useful `/search` options

- `type`: `"auto"` (default here), `"neural"`, `"keyword"`, or `"fast"` (cheaper/faster).
- `category`: bias the index — e.g. `"company"`, `"research paper"`, `"news"`, `"github"`,
  `"pdf"`, `"tweet"`, `"personal site"`, `"financial report"`.
- Date filters: `startPublishedDate` / `endPublishedDate` (ISO), also
  `start/endCrawlDate` — good for "only recent" queries.
- `includeDomains` / `excludeDomains`: restrict or drop sites.
- `includeText` / `excludeText`: require/forbid a phrase in results.
- `contents.livecrawl: "always"` to force a fresh fetch instead of the cache.

## Notes / gotchas

- Content in `text`/`highlights` is cleaned extract, may be truncated by `maxCharacters`
  — request more, or call `/contents` on the winning URL for the whole page.
- `costDollars.total` is authoritative per call; log it if cost matters.
- Do NOT commit the key. It lives in `EXA_API` / gitignored `scratchpad/exa_key`.
- If the direct key is ever missing, fall back to the `exa-search` skill (OpenRouter).
- Full API reference: https://docs.exa.ai
