---
name: 2captcha
description: >
  Solve CAPTCHAs with the 2Captcha API — above all Cloudflare Turnstile and
  Cloudflare Challenge pages, plus reCAPTCHA v2/v3 and hCaptcha. Uses the
  2Captcha API (createTask/getTaskResult, key in env var TWOCAPTCHA_API) to get
  a token, then injects it into a live browser page over CDP/Playwright (any
  CDP endpoint — a mobilerun cloud phone's Chrome, or claude-in-chrome on the
  Mac). Use whenever a page is blocked by a Turnstile widget, a Cloudflare
  "Verifying you are human" / "One more step" wall, a reCAPTCHA/hCaptcha
  widget, or whenever a task mentions 2captcha / Turnstile / captcha-solving.
allowed-tools: Bash
---

# 2Captcha (token solve + CDP injection)

2Captcha solves the captcha off-page: you hand it the site URL + sitekey, it
returns a token, and you inject that token into the live page yourself. This
works for **Cloudflare Turnstile** (standalone widgets and full-page Cloudflare
Challenge interstitials), **reCAPTCHA v2** and **hCaptcha**. It does NOT solve
slider/drag captchas (Tencent TCaptcha etc.) — those are relayed to Deyao's
phone with `scripts/realtime-captcha-relay.js` (see CLAUDE.md).

## When to reach for this (fallback ladder)

1. **A plain fetch may not need a browser at all** — for content-only tasks try
   the `scrapingbee` skill first (`mode=auto` escalates through premium/stealth
   proxies, which clears many bot walls without any captcha solving).
2. **2Captcha via this skill** — Cloudflare Turnstile, Cloudflare Challenge
   pages, reCAPTCHA v2, hCaptcha, when you need to drive the page interactively.
3. Residential/mobile proxy (`iproyal`) if the wall is IP-reputation driven
   rather than a solvable captcha (instant rejections with no captcha to solve).

## Auth, cost, balance

- **Key: env var `TWOCAPTCHA_API`** (already a session env var). Endpoints are the
  JSON v2 API at `api.2captcha.com` — never print or commit the key.
- **Cost:** ~$0.001–0.003 per Turnstile/reCAPTCHA solve; ~10–30 s each.
- **Check balance:** `node .claude/skills/2captcha/twocaptcha.js balance`
- **Billing rule (CLAUDE.md):** if a solve fails with `ERROR_ZERO_BALANCE` (the
  helper flags this as a billing error, exit code 2), **STOP and discord Deyao to
  recharge — do NOT work around it** (don't silently switch solvers or give up).

## Files

- `twocaptcha.js` — raw 2Captcha client (`createTask`/`getTaskResult`/`getBalance`
  plus the `turnstileTask`/`recaptchaV2Task`/`hcaptchaTask` builders),
  tool-agnostic, no browser dependency. The injection side is plain Playwright
  code you write in your driver script (pattern below).

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
(pass them as extra args) — the in-page flow below captures them for you.

### B) Inside a Playwright-over-CDP driver script (the main pattern)

Connect Playwright to whatever browser you are driving: any CDP endpoint works
(a mobilerun cloud phone's Chrome via its CDP URL, or claude-in-chrome on the
Mac). **Install the interceptor before `page.goto()`** — Turnstile params must
be captured as the widget renders.

```js
const { chromium } = require('playwright');          // NODE_PATH=$(npm root -g)
const tc = require('./.claude/skills/2captcha/twocaptcha');

const browser = await chromium.connectOverCDP(CDP_URL);   // any CDP endpoint
const page = browser.contexts()[0].pages()[0];

// 1) Interceptor — BEFORE navigation. Overrides turnstile.render to stash the
//    render options + callback and returns a fake widget id (the real widget
//    never renders; we solve via the API). Mirrors 2Captcha's official method.
await page.addInitScript(() => {
  window.__ts = { params: null, callback: null };
  const iv = setInterval(() => {
    if (!window.turnstile) return;
    clearInterval(iv);
    window.turnstile.render = (container, opts) => {
      window.__ts.params = { sitekey: opts.sitekey, action: opts.action,
        data: opts.cData, pagedata: opts.chlPageData, userAgent: navigator.userAgent };
      window.__ts.callback = opts.callback;
      return 'twocaptcha-intercepted';
    };
  }, 10);
});
await page.goto('https://target.com/protected');

// 2) Read the params (interceptor first; fall back to a static data-sitekey for
//    widgets that rendered before the interceptor / implicit render mode).
const params = await page.evaluate(() => {
  if (window.__ts && window.__ts.params) return window.__ts.params;
  const el = document.querySelector('.cf-turnstile[data-sitekey], [data-sitekey]');
  return el ? { sitekey: el.getAttribute('data-sitekey'), userAgent: navigator.userAgent } : null;
});
if (!params) throw new Error('no Turnstile sitekey found — page may not be Turnstile-walled');

// 3) Solve (Challenge pages: action/data/pagedata/userAgent are all required).
const sol = await tc.solve(tc.turnstileTask({ url: page.url(), ...params }),
                           { onProgress: m => console.error('[2captcha] ' + m) });
const token = sol.token;

// 4) Inject: fire the intercepted callback (SPA flows) AND set the hidden
//    response fields (classic form-submit flows). Belt and suspenders.
await page.evaluate((tok) => {
  try { if (window.__ts && typeof window.__ts.callback === 'function') window.__ts.callback(tok); } catch (e) {}
  const set = (el) => { el.value = tok;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true })); };
  document.querySelectorAll('input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]').forEach(set);
  document.querySelectorAll('input[name="g-recaptcha-response"], textarea[name="g-recaptcha-response"]').forEach(set);
}, token);
// then submit the form / continue as normal
```

**reCAPTCHA v2** is the same shape without an interceptor: read the sitekey off
`.g-recaptcha[data-sitekey]`, solve with `tc.recaptchaV2Task({ url, sitekey,
invisible })`, take `sol.gRecaptchaResponse`, set `#g-recaptcha-response` /
`textarea[name="g-recaptcha-response"]` (make it `display:block` first), and
best-effort invoke the site's callback by walking `window.___grecaptcha_cfg.clients`
for any object with a `callback` function. hCaptcha: `tc.hcaptchaTask`, token in
`sol.token`, set `textarea[name="h-captcha-response"]` and `g-recaptcha-response`.

## How it works (mechanics worth knowing)

- **Task types:** standalone → `TurnstileTaskProxyless` (url + sitekey only).
  Challenge page → same task **plus** `action`, `data`(cData),
  `pagedata`(chlPageData), and `userAgent` **matching the browser** (2Captcha
  emulates that UA — a mismatch fails validation).
- **Proxies:** default is proxyless (Turnstile tokens are largely IP-independent
  for standalone widgets). If a Challenge page rejects a proxyless token, pass
  `proxy: {type,address,port,login,password}` to the task builder to use
  `TurnstileTask` with the **same egress** the browser uses (e.g. the SOCKS5
  proxy attached to the mobilerun device — see `device-egress-proxy`).
- **Solution shapes:** Turnstile/hCaptcha → `solution.token`; reCAPTCHA →
  `solution.gRecaptchaResponse`.
- **Polling:** first result is rarely ready for ~10–20 s; `solve()` waits then
  polls every 5 s up to a 180 s timeout, throwing on `ERROR_CAPTCHA_UNSOLVABLE`.

## Gotchas

- **`NODE_PATH=$(npm root -g)`** is required for any Playwright driver script
  (Playwright is a global install), same as the other node scripts in `scripts/`.
- Test the pipeline for free against 2Captcha's demo: sitekey
  `3x00000000000000000000FF` at `https://2captcha.com/demo/cloudflare-turnstile`
  (a Cloudflare **test** key — returns a `XXXX.DUMMY.TOKEN.XXXX` token that still
  validates on the demo form; verified end-to-end 2026-08-22).
- Turnstile tokens are **single-use and expire in ~5 min** — solve right before
  you submit, not minutes ahead.
- If no Turnstile sitekey is found, the page probably isn't Turnstile-walled —
  check the page state before assuming a solve is needed.

## Docs

- API reference: https://2captcha.com/api-docs (Turnstile:
  `/api-docs/cloudflare-turnstile`, error codes: `/api-docs/error-codes`)
