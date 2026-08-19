---
name: serpapi
description: >
  SerpApi (serpapi.com) — real Google SERP data as clean JSON: organic results,
  answer box, knowledge graph, AI overview, plus dedicated engines for Google
  News/Images/Maps/Shopping/Scholar/Jobs/Flights/Trends, YouTube, Bing, Baidu,
  DuckDuckGo and more. This is the PRIMARY web-search tool (Deyao's preference,
  2026-08-19) — use it before Exa whenever a task needs to find pages/URLs,
  answer a factual or current question from the web, get news, or look up
  docs/pricing. Key in env var SERPAPI_KEY. Quota is small (free plan,
  250 searches/month) — for bulk research or extracted page content, chain to
  the exa skill / ScrapingBee for the winning URLs.
allowed-tools: Bash
---

# SerpApi

**Default web-search tool** (prioritised over Exa per Deyao, 2026-08-19). One GET
returns Google's actual results page as structured JSON — organic links, answer box,
knowledge graph, AI overview, related questions — with no browser, no captchas.

What it does NOT return: extracted page content. Results are titles/links/snippets.
When you need the page text, fetch the winning URLs afterwards (exa `contents`,
ScrapingBee, or Browserbase).

## Auth & quota

- **Env var `SERPAPI_KEY`** (session env var, verified present 2026-08-19).
  Account: chendeyao000@gmail.com, **Free Plan — 250 searches/month** (renews
  monthly, 250/hour rate limit).
- **Budget accordingly**: a search = 1 credit. **Identical searches within ~1 h are
  served from cache and are FREE** (verified: repeat calls didn't increment usage).
  Don't burn credits on speculative variations; if the plan runs out mid-task,
  discord Deyao per the Tools policy (billing issue), and fall back to `exa`.
- Check remaining: `.claude/skills/serpapi/serpapi.sh account`
  (or `GET https://serpapi.com/account?api_key=$SERPAPI_KEY`).

## Fastest path — the helper

```bash
.claude/skills/serpapi/serpapi.sh search  "query" [num]   # Google organic (+answer_box/KG/AI-overview when present)
.claude/skills/serpapi/serpapi.sh news    "query" [num]   # Google News
.claude/skills/serpapi/serpapi.sh images  "query" [num]   # Google Images
.claude/skills/serpapi/serpapi.sh scholar "query" [num]   # Google Scholar
.claude/skills/serpapi/serpapi.sh account                 # plan / searches left
.claude/skills/serpapi/serpapi.sh raw <engine> [k=v ...]  # full JSON, any engine + params
# e.g. raw google_maps "q=coffee near Oxford" "type=search"
#      raw google "q=site:github.com serpapi" "num=20" "tbs=qdr:m"
```

Compact JSON to stdout (`answer_box` / `knowledge_graph` / `ai_overview` included
when present, then the result list), a `[serpapi] <id> <status> <n> results` line to
stderr. `raw` prints the untrimmed response.

## Raw API

One endpoint: `GET https://serpapi.com/search` with `api_key`, `engine`, and
engine-specific params (JSON by default):

```bash
curl -sG https://serpapi.com/search \
  --data-urlencode "api_key=$SERPAPI_KEY" \
  --data-urlencode "engine=google" \
  --data-urlencode "q=anthropic claude" \
  --data-urlencode "num=10"
```

Google response keys (verified): `organic_results[]` `{position,title,link,snippet,
date,source}`, plus `answer_box`, `knowledge_graph`, `ai_overview`, `related_questions[]`,
`news_results`, `ads`, `pagination`. Errors come back as `{"error": "..."}` (HTTP 200
for "no results"; 401 bad key; 429 out of quota).

### Useful `engine=google` params

- `num` (up to 100 results/page), `start` (pagination offset)
- `hl` / `gl` — UI language / country (e.g. `hl=zh-CN`, `gl=cn` for Chinese-flavoured
  results; `gl=uk`)
- `location` — search from a place (e.g. `location=London,England,United Kingdom`)
- `tbs=qdr:h|d|w|m|y` — recency filter (past hour/day/week/month/year)
- `safe=active|off`, `filter=0` (no dedup), `nfpr=1` (no autocorrect)

### Engines worth knowing

`google` (default), `google_news`, `google_images`, `google_videos`, `google_maps`
(+`google_maps_reviews`), `google_shopping`, `google_scholar` (+cite/author),
`google_jobs`, `google_flights`, `google_finance`, `google_trends`, `google_play`,
`apple_app_store`, `youtube` (`search_query=` not `q=`), `bing`, `duckduckgo`,
`baidu`, `yandex`, `ebay`, `walmart`, `home_depot`. Params differ per engine —
docs: serpapi.com/search-api →
each engine has its own page; the JSON keys differ per engine (e.g. `news_results`,
`images_results`, `local_results`, `jobs_results`).

## When to use what (priority order)

1. **serpapi** — any web search: finding URLs, current events/news, factual lookups,
   Google-specific verticals (Maps, Scholar, Shopping, Trends), Chinese web via
   `hl/gl` or `engine=baidu`.
2. **exa** — when you need *extracted page content with the search* (RAG/research
   over many pages), semantic/neural matching, find-similar, or when the SerpApi
   quota is exhausted. Also `exa contents` to turn SerpApi's winning URLs into text.
3. **exa-search** (OpenRouter) — if both keys above are unavailable.
4. Browserbase/ScrapingBee Google flows — last resort only.

## Notes / gotchas

- **Don't print or commit the key** — always `$SERPAPI_KEY` inline.
- `google_news` ignores `num` (returns ~100); the helper trims client-side.
- Cached searches (same params, ~1 h) are free — safe to re-run for parsing retries.
- `search_metadata.id` lets you re-fetch a past search:
  `GET https://serpapi.com/searches/<id>.json?api_key=$SERPAPI_KEY`.
- AI Overview: present inline as `ai_overview` when Google shows one. Per the
  sourcing lesson (lessons.md): treat `ai_overview` and `answer_box` as pointers,
  not answers — verify on the primary source pages.
- Full docs: https://serpapi.com/search-api
