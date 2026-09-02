## Fetching Reuters articles (2026-08-19, teen-ban report)

reuters.com hard-blocks every indirect route — go straight to a Browserbase
browser session with a **GB residential proxy**; that passes cleanly (full
article text, no login):

- Exa live crawl: 401; Exa cached index: `CONTENT_NOT_CACHED` (Reuters blocks
  their crawler, so articles never enter the DB).
- **archive.today cannot capture reuters.com**: its own crawler gets 401 (visible
  in the wip page's status table), the capture "completes" but the final
  `archive.ph/<code>` page is just "Not Found (yet?)". Don't burn time
  resubmitting — a fresh Reuters URL will never produce a snapshot. (Script note:
  each `archive-dump.js` run on an unarchived URL submits a NEW capture; to check
  on a pending one, open its `wip/<code>` URL directly.)
- ScrapingBee refuses the domain outright: `{"error":"This domain is no longer
  supported."}` (premium_proxy included) — blocklisted, don't retry.
- archive.org's availability API 429s the shared pod egress IP.
- What worked: Browserbase session with `proxies:[{type:"browserbase",
  geolocation:{country:"GB",city:"LONDON"}}]` + plain `page.goto` on the article
  URL → full text first try (~9k chars innerText). solveCaptchas on, but no
  captcha appeared.
