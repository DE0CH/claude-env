## archive.today (archive.is/ph) dumps via Browserbase (2026-08-19)

`scripts/archive-dump.js` does the whole flow (details in the `archive-today` skill).
Mechanics worth remembering:

- **`https://archive.ph/newest/<url>` is the single entry point**: 302s to the newest
  snapshot if one exists; otherwise renders a "No results" page (URL stays on
  `/newest/`) with an "archive this url" link — that link goes to a tokenized
  per-visitor subdomain (`https://<token>.archive.ph/?url=...`) with the submit form
  prefilled (`form action=https://archive.ph/submit/`, input `url`, submit `save`).
- Submitting lands on `https://archive.ph/wip/<code>` which auto-refreshes until the
  capture finishes, then redirects to the final snapshot `https://archive.ph/<code>`
  (~30-60 s for a simple page). Poll `location.href` until it leaves `/wip/`.
- **Datacenter IPs get the "One more step" CAPTCHA wall**; a session created with
  `browserSettings:{solveCaptchas:true}` cleared it (see the Browserbase captcha
  lesson above). No login, no cookies needed.
- Navigations (the /newest/ redirect, wip meta-refreshes) destroy Playwright
  execution contexts mid-`evaluate` — wrap page-state reads in a retry loop instead
  of assuming a settled page.
