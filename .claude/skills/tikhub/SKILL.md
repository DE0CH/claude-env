---
name: tikhub
description: Fetch social-media data through the TikHub API (api.tikhub.io) — TikTok, Douyin, Xiaohongshu/RedNote, Instagram, YouTube, Twitter/X, Bilibili, Kuaishou, Weibo, Zhihu, Reddit, LinkedIn, Threads, Telegram, WeChat MP/Channels, Lemon8, Toutiao, NetEase Cloud Music. Use whenever a task needs video/post metadata, user profiles, comments, followers, search results, trending/billboard lists, no-watermark download URLs, or analytics from any of these platforms — it is far cheaper and more reliable than scraping them through a browser. Trigger on mentions of "tikhub", any of these platforms' data, or share-URL parsing.
---

# TikHub API

TikHub (https://tikhub.io) is a paid REST API exposing ~1000 data endpoints for
Chinese and Western social platforms. It replaces browser-scraping for platform data:
one authenticated GET usually returns the JSON you'd otherwise dig out of a webapp.

## Auth & basics

- Key lives in env var **`TIKHUB_API`** (note: not `TIKHUB_API_KEY`). Header:
  `Authorization: Bearer $TIKHUB_API`.
- Base URL: `https://api.tikhub.io`. Swagger UI / docs: https://api.tikhub.io/ and
  https://docs.tikhub.io. No-auth healthcheck: `GET /api/v1/health/check`.
- Billing is per successful request (typical `endpoint_cost` $0.001, rate limit
  10/s; failed requests are not charged). Daily free credit (~$0.05) is spent
  before the paid balance. Balance check (verified):

```bash
curl -sS -H "Authorization: Bearer $TIKHUB_API" \
  "https://api.tikhub.io/api/v1/tikhub/user/get_user_info"
# -> user_data.balance / user_data.free_credit; api_key_data.api_key_scopes
```

- Responses are an envelope: `{"code": 200, "data": {...}, "cache_url": ...}`.
  They are often HUGE — save to a file and extract with python; never dump raw
  responses into context. Each response includes a `cache_url` (24 h, free to
  re-fetch) — handy for re-reading a response without paying again.

## Finding the right endpoint (do this instead of guessing)

Endpoint paths are NOT guessable and guessing wrong verbs/paths wastes turns
(`{"detail":"Not Found"}` = wrong path; `{"detail":"Method Not Allowed"}` = wrong
HTTP verb — some endpoints are POST with a JSON body). The OpenAPI spec is the
authoritative reference; fetch it once per session and search it:

```bash
curl -sS "https://api.tikhub.io/openapi.json" -o "$SCRATCHPAD/tikhub-openapi.json"
python3 .claude/skills/tikhub/find_endpoints.py "$SCRATCHPAD/tikhub-openapi.json" search video   # keyword search
python3 .claude/skills/tikhub/find_endpoints.py "$SCRATCHPAD/tikhub-openapi.json" -d /api/v1/tiktok/app/v3/fetch_video_search_result  # full detail: verb, params, body schema
```

Endpoint families (path prefix → platform/flavor): `tiktok/{web,app/v3,creator,ads,shop,studio,analytics}`,
`douyin/{web,app/v3,search,billboard,xingtu_v2,creator_v2,douplus,index}`,
`xiaohongshu/{web_v3,app_v2,pgy}`, `instagram/{v1,v2,v3,web,web_app}`,
`youtube/{web,web_v2}`, `twitter/web`, `bilibili/{web,app}`, `kuaishou/{web,app/v2,mp}`,
`weibo/{web_v2,app}`, `zhihu/web`, `reddit/{web,app}`, `linkedin/web_v2`,
`threads/web`, `telegram/web`, `wechat_mp/v2`, `wechat_search/v2`, `wechat_channels/v2`,
`lemon8/app`, `pipixia/app`, `toutiao/web`, `xigua/app/v2`, `net_ease_cloud_music/app`,
`hybrid`, `captcha`, `temp_mail/v1`, `sora2`.

## Verified working examples (2026-08-17)

```bash
# Universal share-URL parser (TikTok + Douyin, videos/images): great first choice
curl -sS -G -H "Authorization: Bearer $TIKHUB_API" \
  --data-urlencode "url=https://www.tiktok.com/@tiktok/video/7231338487075638570" \
  --data-urlencode "minimal=true" \
  "https://api.tikhub.io/api/v1/hybrid/video_data"

# TikTok user profile by handle
curl -sS -H "Authorization: Bearer $TIKHUB_API" \
  "https://api.tikhub.io/api/v1/tiktok/web/fetch_user_profile?uniqueId=tiktok"

# TikTok video search (app v3) — data.search_item_list[].aweme_info
curl -sS -G -H "Authorization: Bearer $TIKHUB_API" \
  --data-urlencode "keyword=claude ai" --data-urlencode "count=5" \
  "https://api.tikhub.io/api/v1/tiktok/app/v3/fetch_video_search_result"

# YouTube video info (v2)
curl -sS -H "Authorization: Bearer $TIKHUB_API" \
  "https://api.tikhub.io/api/v1/youtube/web/get_video_info_v2?video_id=QK4Ogus0vgQ"

# Douyin hot-search billboard — a POST endpoint (JSON body, schema in the spec)
curl -sS -X POST -H "Authorization: Bearer $TIKHUB_API" -H "Content-Type: application/json" \
  -d '{"page_num":1,"page_size":10}' \
  "https://api.tikhub.io/api/v1/douyin/billboard/fetch_hot_total_search_list"
```

## Verified social-search endpoints (2026-09-04, Huanggang-port rumour sweep)

```bash
# Threads — recent posts by keyword (data.searchResults → posts with caption.text, taken_at, code, user.username)
curl -sS -G -H "Authorization: Bearer $TIKHUB_API" --data-urlencode "query=新皇崗口岸" \
  "https://api.tikhub.io/api/v1/threads/web/search_recent"      # search_top for ranked
# Threads post detail by URL (fetch_post_detail_v2) returned posts_count=0 for a public post — unreliable; rely on search results.

# Weibo — `weibo/web/fetch_search` is dead (404 "Database did not find endpoint data").
# Working: web_v2 realtime search / app comprehensive search; BOTH take `query=` (not keyword=)
curl -sS -G -H "Authorization: Bearer $TIKHUB_API" --data-urlencode "query=新皇岗口岸 开通" \
  "https://api.tikhub.io/api/v1/weibo/web_v2/fetch_realtime_search"
curl -sS -G -H "Authorization: Bearer $TIKHUB_API" --data-urlencode "query=皇岗口岸 开通时间" --data-urlencode "search_type=1" \
  "https://api.tikhub.io/api/v1/weibo/app/fetch_search_all"
# → cards with text_raw / text (HTML), created_at ("Sat Aug 29 20:17:27 +0800 2026"), mid, user.screen_name,
#   reposts_count / comments_count / attitudes_count. Post URL: https://m.weibo.cn/detail/<mid>

# Xiaohongshu — note search (keyword=; sort_type=time_descending; time_filter=一周内) and note body
curl -sS -G -H "Authorization: Bearer $TIKHUB_API" --data-urlencode "keyword=新皇岗口岸" --data-urlencode "time_filter=一周内" \
  "https://api.tikhub.io/api/v1/xiaohongshu/app_v2/search_notes"          # items: note_id/id, title, desc, user.nickname, liked_count, time
curl -sS -G -H "Authorization: Bearer $TIKHUB_API" --data-urlencode "note_id=<note_id>" \
  "https://api.tikhub.io/api/v1/xiaohongshu/app_v2/get_image_note_detail"  # full desc, no xsec_token needed (web_v3 detail requires it)

# Twitter/X — fetch_search_timeline (keyword=, search_type=Latest): data.timeline[] with text, created_at, screen_name,
#   favorites/retweets/views. Note: CJK keyword searches returned mostly unrelated results; X has little HK-port chatter.
# Reddit — reddit/app/fetch_dynamic_search (query=, sort=NEW, time_range=month, need_format=true): deeply nested GraphQL; posts under
#   data.search.dynamic.components.main.edges[].node.children[].post (postTitle, url, content.markdown, createdAt).
# Douyin — POST douyin/search/fetch_video_search_v1 {"keyword","sort_type":"2","publish_time":"7"}: items with desc, create_time, author.nickname, statistics.
```

Parsing tip: responses nest differently per platform — walk the JSON recursively for dicts carrying the
text field (`caption.text` / `text_raw` / `desc`) instead of hard-coding paths. LIHKG is not on TikHub and
blocks ScrapingBee, Browserbase Fetch and Exa (Cloudflare 403) — use Google-indexed titles/snippets via SerpApi.

## Gotchas

- Always `-G --data-urlencode` for query params with spaces/URLs/CJK.
- A `400` with "Request failed. Please retry... You won't be charged" is an
  UPSTREAM scrape failure, not your bug: retry once, then try a sibling flavor of
  the same endpoint (`web` ↔ `app/v3` ↔ `web_v2`, or `get_video_info` ↔
  `get_video_info_v2`). App-API flavors tend to be more reliable than web ones
  (e.g. `tiktok/web/fetch_search_video` 400'd where `tiktok/app/v3/
  fetch_video_search_result` worked on the first try).
- Most endpoints are GET, but a sizeable minority (e.g. the whole
  `douyin/billboard` ranking family) are POST — check the spec on Method Not Allowed.
- List endpoints paginate with `cursor`/`offset` + `hasMore`-style fields in
  `data`; pass the returned cursor back to continue.
- Per the Tools policy in CLAUDE.md: if requests start failing with
  balance/credit errors, ping Deyao on Discord to recharge — don't work around.
