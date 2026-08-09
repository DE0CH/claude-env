---
name: scrapingbee
description: "Fetch web page content with ScrapingBee: HTML fetches, JavaScript rendering, auto proxy escalation, screenshots, CSS/XPath and AI extraction, Google search results, and credit/usage checks. Use whenever a task needs content from a website."
compatibility: "Requires `SCRAPINGBEE_TOKEN` (environment variable, or in `~/.secrets`). Only needs `curl`."
allowed-tools: Bash
---

# ScrapingBee

ScrapingBee is an HTTP API for fetching web pages — it handles headless browsers, proxies, and anti-bot measures server-side. Everything is a single `curl` call; no SDK or browser install needed.

**Source of truth:** ScrapingBee maintains LLM-oriented reference docs at [scrapingbee.com/llms.txt](https://www.scrapingbee.com/llms.txt), an index of per-topic files ([HTML API](https://www.scrapingbee.com/llms/html-api.txt), [data extraction](https://www.scrapingbee.com/llms/data-extraction.txt), [JS scenarios](https://www.scrapingbee.com/llms/js-scenario.txt), [Google Search](https://www.scrapingbee.com/llms/google-search-api.txt), and more — including Amazon/Walmart/YouTube endpoints). Fetch the relevant file for anything not covered here; those files carry the full contract, constraints, and costs.

## Setup

The API key is `SCRAPINGBEE_TOKEN`, either already exported in the environment or in `~/.secrets`:

```bash
[ -f ~/.secrets ] && { set -a; . ~/.secrets; set +a; }
```

Authenticate with a Bearer header (the `api_key` query parameter still works but is deprecated). URL-encode the target `url` — with curl, use `--get` + `--data-urlencode`:

```bash
curl -s --get 'https://app.scrapingbee.com/api/v1/' \
  --header "Authorization: Bearer $SCRAPINGBEE_TOKEN" \
  --data-urlencode 'url=https://example.com'
```

## Fetching pages

**Static HTML (1 credit)** — start here; most pages don't need JS:

```bash
curl -s --get 'https://app.scrapingbee.com/api/v1/' \
  --header "Authorization: Bearer $SCRAPINGBEE_TOKEN" \
  --data-urlencode 'url=https://example.com' \
  -d render_js=false
```

**JavaScript rendering (5 credits)** — `render_js=true` is the API default. **Auto mode** is the best answer for blocked or unknown sites: it escalates through proxy/rendering tiers (1 → 5 → 10 → 25 → 75 credits) and charges only the tier that succeeds; total failure costs 0:

```bash
curl -s --get 'https://app.scrapingbee.com/api/v1/' \
  --header "Authorization: Bearer $SCRAPINGBEE_TOKEN" \
  --data-urlencode 'url=https://example.com' \
  -d mode=auto -d max_cost=25
```

`max_cost` caps the escalation (e.g. `25` prevents the 75-credit stealth tier). Don't combine `mode=auto` with `render_js`/`premium_proxy`/`stealth_proxy` — that's a `400`. Auto mode only varies proxy/rendering; pass waits, headers, and cookies yourself.

Useful knobs (full list in [html-api.txt](https://www.scrapingbee.com/llms/html-api.txt)):

| Param | Effect |
|---|---|
| `wait=<ms>` | Fixed wait after load (max 35000); runs after `wait_for` |
| `wait_for=<selector>` | Wait for CSS selector (XPath if it starts with `/`) |
| `js_scenario=<json>` | Click/scroll/fill before capture — see [js-scenario.txt](https://www.scrapingbee.com/llms/js-scenario.txt) |
| `block_resources=false` | Load images/CSS too |
| `premium_proxy=true` | Residential proxy: 10 credits without JS, 25 with |
| `stealth_proxy=true` | Heaviest anti-bot tier, 75 credits, requires JS |
| `country_code=<iso>` | Geo-targeted proxy (lower-case ISO 3166-1) |
| `return_page_markdown=true` | Main content as Markdown — good for LLM context |
| `return_page_text=true` | Main content as plain text |
| `session_id=<int>` | Reuse the same IP for 5 minutes |
| `transparent_status_code=true` | Return target's real status/body (bills every request) |

For file downloads use `render_js=false`; non-HTML downloads are capped at 2 MB.

## Structured extraction

**CSS/XPath (`extract_rules`, no extra cost)** — returns JSON instead of HTML; prefer this over parsing yourself. JSON params must be stringified in the query:

```bash
curl -s --get 'https://app.scrapingbee.com/api/v1/' \
  --header "Authorization: Bearer $SCRAPINGBEE_TOKEN" \
  --data-urlencode 'url=https://news.ycombinator.com' \
  -d render_js=false \
  --data-urlencode 'extract_rules={"titles":{"selector":".titleline > a","type":"list","output":"text"},"links":{"selector":".titleline > a","type":"list","output":"@href"}}'
```

Shorthand: `{"title": "h1", "link": "a@href"}`. Fields: `selector`, `type` (`item`|`list`), `output` (`text`|`html`|`@attr`|`table_json`|`table_array`|nested rules), `clean`. `table_json` turns a table into row objects keyed by headers; nested `output` under a `list` extracts repeated structured items. Details: [data-extraction.txt](https://www.scrapingbee.com/llms/data-extraction.txt).

**AI extraction (+5 credits)** — for semantic or irregularly structured fields:

```bash
# Natural-language question about the page
-d 'ai_query=What is the product price?' -d 'ai_selector=#product-details'

# Structured schema (supports string/number/boolean/list/item and enum)
--data-urlencode 'ai_extract_rules={"price":{"description":"current price in dollars","type":"number"},"in_stock":{"description":"is it available","type":"boolean"}}'
```

## Screenshots

```bash
curl -s --get 'https://app.scrapingbee.com/api/v1/' \
  --header "Authorization: Bearer $SCRAPINGBEE_TOKEN" \
  --data-urlencode 'url=https://example.com' \
  -d screenshot=true -o page.png
```

`screenshot_full_page=true` for the whole page, `screenshot_selector=<css>` for one element. Screenshots require JS rendering and auto-disable resource blocking. `json_response=true` if you need HTML and screenshot together.

## Google search

**Google Search API** (10 credits; 15 with `light_request=false`) — structured SERP JSON:

```bash
curl -s --get 'https://app.scrapingbee.com/api/v1/store/google' \
  --header "Authorization: Bearer $SCRAPINGBEE_TOKEN" \
  --data-urlencode 'search=terracotta pots' \
  -d country_code=us
```

Params: `search_type=classic|news|maps|lens|shopping|images|ai_mode|ads`, `page`/`pages` (≤3 recommended), `language`, `date_range=past_hour|past_day|past_week|past_month|past_year`, `nfpr=true` to disable autocorrect. AI Overviews need `light_request=false`. Response includes `organic_results`, `knowledge_graph`, `news_results`, `related_queries`, etc. — see [google-search-api.txt](https://www.scrapingbee.com/llms/google-search-api.txt).

**Fast Search API** (10 credits) — lightweight sub-second organic results: same shape with `https://app.scrapingbee.com/api/v1/fast_search`.

## Usage / credits

```bash
curl -s 'https://app.scrapingbee.com/api/v1/usage' \
  --header "Authorization: Bearer $SCRAPINGBEE_TOKEN"
```

Returns `max_api_credit`, `used_api_credit`, `max_concurrency`, `current_concurrency`. Rate-limited to 6 calls/minute; free. Check it before large jobs and mention remaining credits if low.

## Costs and errors

- Credits per successful request: 1 (no JS) / 5 (JS) / 10 (premium, no JS) / 25 (premium + JS) / 75 (stealth); AI extraction +5; Google Search 10–15.
- Billing by status: `200` and `404` are billed; `400` (bad request), `401` (out of credits), `429` (concurrency limit — back off or serialize), and `500` (misc error — retry) are not.
- Without `transparent_status_code`, any target status other than `2xx`/`404` surfaces as a ScrapingBee `500` with a JSON `reason`.
- Failed target fetches are retried server-side for up to 30 s — set client timeouts accordingly.
- Response headers `Spb-cost`, `Spb-resolved-url`, `Spb-initial-status-code` report what happened; target headers come back `Spb-`-prefixed. To send custom headers to the target, prefix them `Spb-` and add `forward_headers=true`.
