---
name: 2captcha
description: >
  Solve CAPTCHAs that Browserbase's built-in solver can't — above all
  Cloudflare Turnstile and Cloudflare Challenge pages, plus reCAPTCHA v2/v3 and
  hCaptcha as fallbacks. Uses the 2Captcha API (createTask/getTaskResult, key in
  env var TWOCAPTCHA_API) to get a token, then injects it into a live Browserbase
  page over CDP/Playwright. Use whenever a page is blocked by a Turnstile widget
  or a Cloudflare "Verifying you are human" / "One more step" wall that a normal
  Browserbase session (solveCaptchas:true) does not clear, or whenever a task
  mentions 2captcha / Turnstile / captcha-solving.
allowed-tools: Bash
---

# 2Captcha (+ Browserbase integration)

Browserbase's own solver (`browserSettings.solveCaptchas: true`) clears ordinary
reCAPTCHA / hCaptcha / image walls by itself — **use that first and don't pay
2Captcha for what it already handles.** What it does **not** reliably solve is
**Cloudflare Turnstile** and full-page **Cloudflare Challenge** interstitials
(verified failing on Turnstile — see lessons.md, cobalt.tools). This skill fills
exactly that gap: run the page in a normal Browserbase session, and when a
Turnstile / Cloudflare wall blocks you, fetch a token from 2Captcha and inject it
into the live page over CDP.

## When to reach for this (fallback ladder)

1. **Browserbase built-in** (`solveCaptchas: true`) — reCAPTCHA, hCaptcha, image
   challenges. Wait on its console signals (`browserbase-solving-started` /
   `-finished`). Free (part of the session). **Try this first.**
2. **2Captcha via this skill** — Cloudflare Turnstile, Cloudflare Challenge
   pages, and reCAPTCHA/hCaptcha when the built-in solver can't clear them.
3. Residential proxy (`iproyal`) if the wall is IP-reputation driven rather than
   a solvable captcha (instant rejections with no captcha to solve).

## Auth, cost, balance

- **Key: env var `TWOCAPTCHA_API`** (already a session env var). Endpoints are the
  JSON v2 API at `api.2captcha.com` — never print or commit the key.
- **Cost:** ~$0.001–0.003 per Turnstile/reCAPTCHA solve; ~10–30 s each.
- **Check balance:** `node .claude/skills/2captcha/twocaptcha.js balance`
- **Billing rule (CLAUDE.md):** if a solve fails with `ERROR_ZERO_BALANCE` (the
  helpers flag this as a billing error, exit code 2), **STOP and discord Deyao to
  recharge — do NOT work around it** (don't silently switch solvers or give up).

## Files

- `twocaptcha.js` — raw 2Captcha client (`createTask`/`getTaskResult`/`getBalance`),
  tool-agnostic, no browser. Use when you already have the sitekey.
- `bb-solve.js` — the Browserbase integration: connects over CDP, detects the
  captcha on a live page, solves via `twocaptcha.js`, injects the token + fires
  the widget callback. **Needs global Playwright — run with `NODE_PATH=$(npm root -g)`.**

## Quick use

### A) I already have the sitekey (no browser)

```bash
node .claude/skills/2captcha/twocaptcha.js turnstile "https://site.com/page" "0x4AAA..."
node .claude/skills/2captcha/twocaptcha.js recaptcha "https://site.com/page" "6Lc..." [--invisible]
node .claude/skills/2captcha/twocaptcha.js hcaptcha  "https://site.com/page" "a1b2..." [--invisible]
# → prints the solution JSON: {"token":"..."} or {"gRecaptchaResponse":"..."}
```

For a **Cloudflare Challenge page** (not a standalone widget) you also need the
`action`, `cData`, `chlPageData` grabbed by intercepting `turnstile.render`
(pass them as extra args) — the Browserbase flow below does this for you.

### B) One-shot: open a URL in Browserbase and solve (CLI)

```bash
NODE_PATH=$(npm root -g) node .claude/skills/2captcha/bb-solve.js "https://target.com" [--recaptcha] [--debug-url] [--keep-alive]
```

Creates a session (built-in solver on), opens the URL, installs the Turnstile
interceptor, solves, injects. `--debug-url` prints the live-view
`debuggerFullscreenUrl` to watch/share.

### C) Inside your own Browserbase + Playwright-over-CDP script

This is the main integration pattern. **Install the interceptor before
`page.goto()`** — Turnstile params must be captured as the widget renders.

```js
const { chromium } = require('playwright');          // NODE_PATH=$(npm root -g)
const bb = require('./.claude/skills/2captcha/bb-solve');

const browser = await chromium.connectOverCDP(session.connectUrl);
const page = browser.contexts()[0].pages()[0];

await bb.installTurnstileInterceptor(page);           // BEFORE navigation
await page.goto('https://target.com/protected');
// ... if a Turnstile / Cloudflare wall is present:
const token = await bb.solveTurnstile(page);          // solves + injects + fires callback
// then submit the form / continue as normal

// reCAPTCHA fallback (only if Browserbase's own solver didn't clear it):
// const rtoken = await bb.solveRecaptcha(page, { invisible: false });
```

`solveTurnstile` handles **both** standalone widgets and Cloudflare Challenge
pages: the interceptor captures `sitekey` (+ `action`/`cData`/`chlPageData` and
the page's `userAgent` on challenge pages), solves the matching 2Captcha task,
then both fires the intercepted `callback(token)` (SPA flows) and sets the hidden
`cf-turnstile-response` / `g-recaptcha-response` fields (form-submit flows).

## How it works (mechanics worth knowing)

- **Interceptor:** `page.addInitScript` overrides `window.turnstile.render` to
  stash the render options and callback into `window.__ts`, returning a fake
  widget id so the real challenge never renders. Mirrors 2Captcha's official
  method. Falls back to reading a static `data-sitekey` off the DOM if the widget
  rendered before the interceptor (or uses implicit render).
- **Task types:** standalone → `TurnstileTaskProxyless` (url + sitekey only).
  Challenge page → same task **plus** `action`, `data`(cData),
  `pagedata`(chlPageData), and `userAgent` **matching the browser** (2Captcha
  emulates that UA — a mismatch fails validation).
- **Proxies:** default is proxyless (Turnstile tokens are largely IP-independent
  for standalone widgets, and Browserbase silently ignores external proxies on
  this plan — see lessons.md). If a Challenge page rejects a proxyless token,
  pass `{ proxy: {type,address,port,login,password} }` to use `TurnstileTask`
  with the **same egress** the browser uses.
- **Solution shapes:** Turnstile/hCaptcha → `solution.token`; reCAPTCHA →
  `solution.gRecaptchaResponse`.
- **Polling:** first result is rarely ready for ~10–20 s; `solve()` waits then
  polls every 5 s up to a 180 s timeout, throwing on `ERROR_CAPTCHA_UNSOLVABLE`.

## Gotchas

- **`NODE_PATH=$(npm root -g)`** is required for `bb-solve.js` (Playwright is a
  global install), same as the other Browserbase node scripts here.
- Test the pipeline for free against 2Captcha's demo: sitekey
  `3x00000000000000000000FF` at `https://2captcha.com/demo/cloudflare-turnstile`
  (a Cloudflare **test** key — returns a `XXXX.DUMMY.TOKEN.XXXX` token that still
  validates on the demo form; verified end-to-end 2026-08-22).
- Turnstile tokens are **single-use and expire in ~5 min** — solve right before
  you submit, not minutes ahead.
- If `solveTurnstile` throws "no Turnstile sitekey found", the page probably
  isn't Turnstile-walled (or the built-in solver already cleared it) — check the
  page state before assuming a solve is needed.

## Docs

- API reference: https://2captcha.com/api-docs (Turnstile:
  `/api-docs/cloudflare-turnstile`, error codes: `/api-docs/error-codes`)
