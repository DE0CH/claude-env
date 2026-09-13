## Fetching Reuters articles (2026-08-19, teen-ban report)

reuters.com hard-blocks every indirect route — go straight to a real browser on a
**GB residential IP** (a mobilerun cloud phone's Chrome with an IPRoyal GB
residential/mobile proxy attached, or claude-in-chrome on the Mac from a home
connection); that passes cleanly (full article text, no login):

- Exa live crawl: 401; Exa cached index: `CONTENT_NOT_CACHED` (Reuters blocks
  their crawler, so articles never enter the DB).
- **archive.today cannot capture reuters.com**: its own crawler gets 401 (visible
  in the wip page's status table), the capture "completes" but the final
  `archive.ph/<code>` page is just "Not Found (yet?)". Don't burn time
  resubmitting — a fresh Reuters URL will never produce a snapshot. (Each submit of
  an unarchived URL creates a NEW capture; to check on a pending one, open its
  `wip/<code>` URL directly.)
- ScrapingBee refuses the domain outright: `{"error":"This domain is no longer
  supported."}` (premium_proxy included) — blocklisted, don't retry.
- archive.org's availability API 429s the shared pod egress IP.
- What worked: a browser session exiting from a GB (London) residential IP + plain
  `page.goto` on the article URL → full text first try (~9k chars innerText). No
  captcha appeared.
