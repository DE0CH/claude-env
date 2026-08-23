---
name: exa-search
description: >
  Fast AI-native web search via Exa, accessed through OpenRouter's `web` plugin
  (engine=exa) — needs no Exa key, only OPENROUTER_API. Returns ranked results WITH
  clean, LLM-ready extracted page content (title + url + text), not just links.
  FALLBACK for web search: prefer the `exa` skill (direct Exa API, richer) when the
  EXA_API key is available; use THIS when it isn't. Trigger whenever a task needs to
  find pages/URLs, answer a factual/current question, gather sources for RAG, or look
  up docs/pricing and the direct Exa key is unavailable.
allowed-tools: Bash
---

# Exa search via OpenRouter

**This is the default web-search tool.** Prefer it over Browserbase/ScrapingBee
"type into Google" flows — those are slow and only return SERP links. Exa returns
semantically-ranked results *with the extracted page content inline*, so one call
gives you both the URLs and the text to read.

## Key fact: Exa is reachable through OpenRouter, not as a standalone endpoint

OpenRouter is an LLM router — it does **not** expose a raw Exa `/search` endpoint.
Exa is available only as the **`web` plugin** attached to a chat completion, with
`engine: "exa"`. The trick: the Exa results come back as `annotations`
(`type: "url_citation"`) on the assistant message — **each annotation carries the
full extracted page content** — regardless of what the model itself writes. So you
force the model to reply just "OK" (`max_tokens: 20`) and read the annotations.
That makes it behave like a pure search API; the LLM cost is negligible and the
~$0.007/search is essentially the Exa search fee.

- **Auth:** `OPENROUTER_API` (this env uses `OPENROUTER_API`, *not*
  `OPENROUTER_API_KEY` — the SDK default name).
- **Cost:** ≈ **$0.0074 per search** for 5 results (verified 2026-08-18). Scales
  with `max_results`. Comparable to hitting Exa directly ($2.50–5 / 1k searches).
- **Two modes**, same call:
  1. **Search-only** (recommended default) — tell the model to reply "OK", read
     `annotations`. You get `{title, url, content}` per result.
  2. **Search + answer** — let the model actually answer; it writes a cited summary
     and the sources are still in `annotations`. Use when you want a synthesized
     answer in one shot.

## Fastest path — the helper script

```bash
.claude/skills/exa-search/exa_search.sh "your query" [num_results]
# → JSON array [{title, url, content}, ...] on stdout; a "[exa] N results, cost=$…" line on stderr
```

Examples:

```bash
.claude/skills/exa-search/exa_search.sh "latest Anthropic model pricing" 6
.claude/skills/exa-search/exa_search.sh "Kubernetes 1.31 breaking changes"
```

Pick a specific result and read its `.content` field — it's already clean text,
no scraping needed. If you need the *full* page (content is truncated) fetch that
one URL with Browserbase/ScrapingBee.

## Raw curl (search-only)

```bash
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "plugins": [{"id": "web", "engine": "exa", "max_results": 5}],
    "max_tokens": 20,
    "messages": [{"role":"user","content":"YOUR QUERY\n\n(Reply with just: OK)"}]
  }'
# results = .choices[0].message.annotations[].url_citation  → {url, title, content}
```

## Raw curl (search + cited answer)

```bash
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "plugins": [{"id": "web", "engine": "exa", "max_results": 5}],
    "messages": [{"role":"user","content":"What did X announce recently? Cite sources."}]
  }'
# .choices[0].message.content = the answer;  .annotations[] = the sources
```

## Options / gotchas

- **`max_results`** controls both count and cost (default 5). The plugin derives the
  search query from the **user message** — there is no separate `query` field, so put
  exactly what you want to search as the message text.
- **`engine` MUST be `"exa"`.** Without it, some models default to `engine:"native"`
  (the provider's own search, e.g. OpenAI/Perplexity), not Exa.
- Any cheap model can host the plugin — the model choice barely affects cost in
  search-only mode. Override with `EXA_SEARCH_MODEL=…` for the helper. Don't invent
  model ids: `google/gemini-2.0-flash-001` 404s; `openai/gpt-4o-mini` works. Check
  https://openrouter.ai/models for valid ids.
- Annotation `content` is a cleaned excerpt (a few KB), not always the whole page.
  For long docs, fetch the winning URL separately.
- No new env var needed — `OPENROUTER_API` is already present. Nothing to install.

## Alternatives (only if this is down)

- **Direct Exa API** (`api.exa.ai/search`) if we ever get a native Exa key — richer
  params (autoprompt, category filters, date ranges, `/contents`, `/answer`).
- **ScrapingBee Google Search API** (`scrapingbee` skill) — real SERP links.
- **Browserbase Search API** — slowest; last resort.
