---
name: archive-today
description: "Dump or create archive.today (archive.is / archive.ph) snapshots of web pages through Browserbase. Use whenever a task mentions archive.is/archive.today/archive.ph, needs the archived copy of a page (e.g. paywalled or deleted content), needs to push a page into a web archive — or whenever a source URL turns out to be unavailable when fetched (dead link, 404/410, domain gone, paywall, unbeatable bot wall): standing rule is to try the archived copy via scripts/archive-dump.js before giving up on the content. Handles both already-archived URLs (fetch newest snapshot) and never-archived URLs (submit, wait for capture, dump)."
compatibility: "Requires BROWSERBASE_API_KEY; playwright resolvable globally (NODE_PATH=$(npm root -g))."
---

# archive.today snapshots via Browserbase

archive.today (mirrors: archive.ph, archive.is, archive.li, archive.md, archive.fo,
archive.vn) blocks datacenter IPs with a "One more step" CAPTCHA wall, so drive it
through a Browserbase session created with **`browserSettings: {solveCaptchas: true}`**
— the built-in solver clears the wall (verified 2026-08-19). No login or cookies needed.

## The ready-made script

```bash
NODE_PATH=$(npm root -g) node scripts/archive-dump.js <url> [outfile.html]
```

- Creates its own Browserbase session (solveCaptchas on, timeout 3600), releases it when done.
- **Already archived** → follows `https://archive.ph/newest/<url>` to the newest snapshot, dumps full HTML.
- **Not archived** → clicks "archive this url" from the No-results page, submits the
  capture form, polls the `wip/<code>` page until the snapshot is ready (~30–60 s for a
  simple page, budget up to 8 min), dumps it.
- Last stdout line is JSON: `{"snapshotUrl", "wasArchived", "file"}`. Progress goes to stderr.
- Exit 0 on success. Env overrides: `ARCHIVE_HOST` (default `archive.ph`),
  `BROWSERBASE_PROJECT_ID`.

## Site mechanics (if scripting it manually)

- `https://archive.ph/newest/<url>` — 302s to the newest snapshot if one exists;
  otherwise a "No results" page (URL stays on `/newest/`). Other selectors:
  `/oldest/<url>`, `/<timestamp>/<url>`, and `/<url>` for a snapshot list.
- The No-results page's **"archive this url"** link goes to a tokenized per-visitor
  subdomain `https://<token>.archive.ph/?url=...` with the submit form prefilled:
  `form action="https://archive.ph/submit/"`, text input `url`, submit button `save`.
  Don't fabricate the token — always follow the link the page gives you.
- After submit you land on `https://archive.ph/wip/<code>` which auto-refreshes until
  the capture completes, then redirects to the final snapshot `https://archive.ph/<code>`.
  Poll `location.href` until it leaves `/wip/`.
- Snapshot pages also offer: a screenshot view (tab on the page), `download .zip`, and a
  short link. The full-page HTML dump (`document.documentElement.outerHTML`) includes
  archive.today's toolbar/header chrome above the reconstructed page.
- Re-submitting an already-archived URL is allowed (it makes a new snapshot); `/newest/`
  never re-captures.
- **Pitfall:** navigations (the `/newest/` redirect, wip meta-refreshes) destroy
  Playwright execution contexts mid-`evaluate` — wrap page-state reads in a retry loop.
- CAPTCHA handling: the built-in solver announces itself via page console messages
  `browserbase-solving-started` / `browserbase-solving-finished` — listen for those
  (Playwright `page.on('console')`) and wait while solving is active. Keep a body-text
  fallback (`One more step|complete the security check`) for walls it doesn't announce;
  allow ~2 min. Verified live 2026-08-19: solver cleared archive.ph's wall mid-flow.
