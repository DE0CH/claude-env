## archive.today (archive.is/ph) dumps (2026-08-19)

Mechanics of the site worth remembering when pulling or creating a snapshot (drive it
from a browser over CDP — claude-in-chrome on the Mac or a mobilerun cloud phone's
Chrome — or, for an already-archived URL, just fetch the snapshot with ScrapingBee):

- **`https://archive.ph/newest/<url>` is the single entry point**: 302s to the newest
  snapshot if one exists; otherwise renders a "No results" page (URL stays on
  `/newest/`) with an "archive this url" link — that link goes to a tokenized
  per-visitor subdomain (`https://<token>.archive.ph/?url=...`) with the submit form
  prefilled (`form action=https://archive.ph/submit/`, input `url`, submit `save`).
- Submitting lands on `https://archive.ph/wip/<code>` which auto-refreshes until the
  capture finishes, then redirects to the final snapshot `https://archive.ph/<code>`
  (~30-60 s for a simple page). Poll `location.href` until it leaves `/wip/`. Each
  submit of an unarchived URL creates a NEW capture; to check on a pending one, open its
  `wip/<code>` URL directly.
- **Datacenter IPs get the "One more step" CAPTCHA wall**; it is an ordinary solvable
  captcha (a generic browser captcha solver cleared it in 2026-08) — solve it with the
  `2captcha` skill or avoid it by browsing from a residential/mobile exit (mobilerun
  phone + IPRoyal). No login, no cookies needed.
- Navigations (the /newest/ redirect, wip meta-refreshes) destroy Playwright
  execution contexts mid-`evaluate` — wrap page-state reads in a retry loop instead
  of assuming a settled page.
