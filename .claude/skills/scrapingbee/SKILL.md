---
name: scrapingbee
description: "Fetch web page content with ScrapingBee: plain HTML fetches, JavaScript rendering, screenshots, structured extraction with extract_rules, Google search results, and credit/usage checks. Use whenever a task needs content from a website."
compatibility: "Requires `SCRAPINGBEE_TOKEN` (environment variable, or in `~/.secrets`). Only needs `curl`."
allowed-tools: Bash
---

# ScrapingBee

ScrapingBee is an HTTP API for fetching web pages — it handles headless browsers, proxies, and anti-bot measures server-side. Everything is a single `curl` call; no SDK or browser install needed.

## Setup

The API key is `SCRAPINGBEE_TOKEN`, either already exported in the environment or in `~/.secrets`:

```bash
[ -f ~/.secrets ] && { set -a; . ~/.secrets; set +a; }
```

Base endpoint: `https://app.scrapingbee.com/api/v1/`

The target `url` parameter must be URL-encoded. With curl, prefer `--data-urlencode` + `-G` so you never hand-encode:

```bash
curl -s -G "https://app.scrapingbee.com/api/v1/" \
  --data-urlencode "api_key=$SCRAPINGBEE_TOKEN" \
  --data-urlencode "url=https://example.com/some page?q=x"
```

## Fetching pages

**Static HTML (1 credit)** — start here; most pages don't need JS:

```bash
curl -s -G "https://app.scrapingbee.com/api/v1/" \
  --data-urlencode "api_key=$SCRAPINGBEE_TOKEN" \
  --data-urlencode "url=https://example.com" \
  -d render_js=false
```

**JavaScript rendering (5 credits)** — `render_js=true` is the API default; use it when the static fetch comes back empty or skeletal:

```bash
curl -s -G "https://app.scrapingbee.com/api/v1/" \
  --data-urlencode "api_key=$SCRAPINGBEE_TOKEN" \
  --data-urlencode "url=https://example.com" \
  -d render_js=true -d wait=2000
```

Useful knobs:

| Param | Effect |
|---|---|
| `wait=<ms>` | Fixed wait after load (max 35000) |
| `wait_for=<css>` | Wait until a CSS selector appears |
| `wait_browser=networkidle2` | Wait for network to settle |
| `js_scenario=<json>` | Click/scroll/fill before capture (see docs) |
| `block_resources=false` | Load images/CSS too (needed for some screenshots) |
| `premium_proxy=true` | Residential proxies, 25 credits — for sites that block datacenter IPs |
| `stealth_proxy=true` | Heaviest anti-bot evasion, 75 credits — last resort |
| `country_code=us` | Geo-targeted proxy |

Escalation ladder for blocked fetches (HTTP 403/429 or bot-wall HTML): `render_js=false` → `render_js=true` → `premium_proxy=true` → `stealth_proxy=true`. Don't start expensive.

## Structured extraction

`extract_rules` returns JSON instead of raw HTML — prefer this over parsing HTML yourself:

```bash
curl -s -G "https://app.scrapingbee.com/api/v1/" \
  --data-urlencode "api_key=$SCRAPINGBEE_TOKEN" \
  --data-urlencode "url=https://news.ycombinator.com" \
  -d render_js=false \
  --data-urlencode 'extract_rules={"titles":{"selector":".titleline > a","type":"list","output":"text"},"links":{"selector":".titleline > a","type":"list","output":"@href"}}'
```

Rule syntax: `{"key": {"selector": "<css>", "type": "item"|"list", "output": "text"|"html"|"@<attribute>"|<nested rules>}}`. A bare string value like `{"title": "h1"}` is shorthand for text of the first match.

## Screenshots

```bash
curl -s -G "https://app.scrapingbee.com/api/v1/" \
  --data-urlencode "api_key=$SCRAPINGBEE_TOKEN" \
  --data-urlencode "url=https://example.com" \
  -d screenshot=true -o page.png
```

Variants: `screenshot_full_page=true` for the whole page, `screenshot_selector=<css>` for one element. Add `block_resources=false` if images are missing, and `window_width`/`window_height` to set the viewport.

## Google search results

Dedicated endpoint — returns structured JSON (organic results, top ads, related queries):

```bash
curl -s -G "https://app.scrapingbee.com/api/v1/store/google" \
  --data-urlencode "api_key=$SCRAPINGBEE_TOKEN" \
  --data-urlencode "search=terracotta pots" \
  -d country_code=us
```

Extra params: `search_type=news|images`, `page=<n>`, `nb_results=<n>`, `language=en`.

## Usage / credits

```bash
curl -s "https://app.scrapingbee.com/api/v1/usage?api_key=$SCRAPINGBEE_TOKEN"
```

Returns `max_api_credit`, `used_api_credit`, and concurrency limits. This call is free and doesn't count toward concurrency. Check it before large scraping jobs and mention remaining credits if they're low.

## Costs and errors

- Credits per request: 1 (no JS) / 5 (JS) / 25 (premium proxy) / 75 (stealth proxy). Failed requests (non-2xx from the target after retries) are not charged.
- ScrapingBee returns the target's status code; a `500` with a JSON body is a ScrapingBee-side error — read the body's `reason`.
- `429` from ScrapingBee itself means concurrency limit hit — serialize requests or back off.
- Original response headers come back prefixed `Spb-`; send custom headers to the target by prefixing them `Spb-` and adding `forward_headers=true`.

Docs: https://www.scrapingbee.com/documentation/
