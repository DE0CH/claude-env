#!/usr/bin/env node
// 2Captcha <-> Browserbase integration.
//
// WHY THIS EXISTS: Browserbase's built-in solver (browserSettings.solveCaptchas)
// clears ordinary reCAPTCHA / hCaptcha / image walls on its own — use that first
// and DON'T pay 2Captcha for what it already handles. What it does NOT reliably
// solve is **Cloudflare Turnstile** (verified failing on Turnstile in lessons.md).
// This module fills exactly that gap: run the page in a normal Browserbase
// session, and when a Turnstile widget / Cloudflare Challenge blocks you, get a
// token from 2Captcha and inject it into the live page over CDP.
//
// Requires global Playwright: run with  NODE_PATH=$(npm root -g)
//
// Module use (inside your own Browserbase+Playwright script):
//   const bb = require('./bb-solve');
//   await bb.installTurnstileInterceptor(page);   // BEFORE page.goto()
//   await page.goto(targetUrl);
//   await bb.solveTurnstile(page);                // gets token, injects, fires callback
//
// CLI (self-contained demo / one-shot solve of a URL):
//   NODE_PATH=$(npm root -g) node bb-solve.js <url> [--recaptcha] [--keep-alive] [--debug-url]
//     <url>          page to open in a fresh Browserbase session and solve
//     --recaptcha    also try a 2Captcha reCAPTCHA v2 solve (fallback if BB's fails)
//     --keep-alive   don't release the session at the end
//     --debug-url    print the live-view debuggerFullscreenUrl (to watch / share)

const { chromium } = require('playwright');
const tc = require('./twocaptcha');

const BB_API = 'https://api.browserbase.com/v1';
const BB_KEY = process.env.BROWSERBASE_API_KEY;
const PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || '8f2c3e0b-53ae-4425-828e-79e5fd52a180';

const log = (m) => console.error('[bb-solve] ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bbApi(path, method = 'GET', body) {
  const res = await fetch(BB_API + path, {
    method,
    headers: { 'X-BB-API-Key': BB_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Browserbase ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Turnstile: intercept turnstile.render so we capture the sitekey, the site's
// callback, and (on Cloudflare Challenge pages) the extra cData/chlPageData/
// action params. This mirrors 2Captcha's official approach and works for BOTH
// standalone widgets and full-page challenges. MUST be installed before the
// Turnstile script loads, i.e. before page.goto().
// ---------------------------------------------------------------------------
async function installTurnstileInterceptor(page) {
  await page.addInitScript(() => {
    window.__ts = { params: null, callback: null };
    const iv = setInterval(() => {
      if (window.turnstile) {
        clearInterval(iv);
        window.turnstile.render = (container, opts) => {
          window.__ts.params = {
            sitekey: opts.sitekey,
            action: opts.action,
            data: opts.cData,
            pagedata: opts.chlPageData,
            userAgent: navigator.userAgent,
          };
          window.__ts.callback = opts.callback;
          // return a fake widget id; the real widget won't render (we solve via API)
          return 'twocaptcha-intercepted';
        };
      }
    }, 10);
  });
}

// Wait for the interceptor to have captured render params, OR fall back to
// reading a static data-sitekey off the DOM (standalone widgets that render
// before our interceptor, or sites using the implicit render mode).
async function getTurnstileParams(page, { timeoutMs = 30000 } = {}) {
  const start = Date.now();
  for (;;) {
    const p = await page.evaluate(() => {
      if (window.__ts && window.__ts.params) return window.__ts.params;
      const el = document.querySelector('.cf-turnstile[data-sitekey], [data-sitekey]');
      if (el) return { sitekey: el.getAttribute('data-sitekey'), userAgent: navigator.userAgent };
      return null;
    });
    if (p && p.sitekey) return p;
    if (Date.now() - start > timeoutMs) {
      throw new Error('no Turnstile sitekey found on page within ' + timeoutMs / 1000 + 's');
    }
    await sleep(1000);
  }
}

// Full standalone/challenge Turnstile solve on a live page.
// opts: { url, proxy, timeoutMs } — url defaults to the page's current URL.
async function solveTurnstile(page, opts = {}) {
  const url = opts.url || page.url();
  const params = await getTurnstileParams(page, opts);
  log(`Turnstile sitekey ${params.sitekey}${params.data ? ' (Cloudflare Challenge mode)' : ' (standalone)'}`);
  const solution = await tc.solve(
    tc.turnstileTask({ url, sitekey: params.sitekey, action: params.action,
                       data: params.data, pagedata: params.pagedata,
                       userAgent: params.userAgent, proxy: opts.proxy }),
    { onProgress: log, timeoutMs: opts.timeoutMs || 180000 }
  );
  const token = solution.token;
  // Inject: fire the intercepted callback (SPA flows) AND set the hidden
  // response fields (classic form-submit flows). Belt and suspenders.
  await page.evaluate((tok) => {
    try { if (window.__ts && typeof window.__ts.callback === 'function') window.__ts.callback(tok); } catch (e) {}
    const set = (el) => {
      if (!el) return;
      el.value = tok;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelectorAll('input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]').forEach(set);
    document.querySelectorAll('input[name="g-recaptcha-response"], textarea[name="g-recaptcha-response"]').forEach(set);
  }, token);
  log('token injected');
  return token;
}

// ---------------------------------------------------------------------------
// reCAPTCHA v2 fallback. Prefer Browserbase's own solver first; use this only
// when it can't clear it. Finds the sitekey, solves via 2Captcha, sets the
// g-recaptcha-response textarea and fires the client callback if discoverable.
// ---------------------------------------------------------------------------
async function solveRecaptcha(page, opts = {}) {
  const url = opts.url || page.url();
  const sitekey = opts.sitekey || await page.evaluate(() => {
    const el = document.querySelector('.g-recaptcha[data-sitekey], [data-sitekey]');
    return el ? el.getAttribute('data-sitekey') : null;
  });
  if (!sitekey) throw new Error('no reCAPTCHA sitekey found on page');
  log(`reCAPTCHA v2 sitekey ${sitekey}`);
  const solution = await tc.solve(
    tc.recaptchaV2Task({ url, sitekey, invisible: opts.invisible, proxy: opts.proxy }),
    { onProgress: log, timeoutMs: opts.timeoutMs || 180000 }
  );
  const token = solution.gRecaptchaResponse;
  await page.evaluate((tok) => {
    const set = (el) => { if (el) { el.style.display = 'block'; el.value = tok; } };
    document.querySelectorAll('#g-recaptcha-response, textarea[name="g-recaptcha-response"]').forEach(set);
    // Best-effort: invoke the site's callback registered with grecaptcha.
    try {
      const cfg = window.___grecaptcha_cfg;
      if (cfg && cfg.clients) {
        for (const cid of Object.keys(cfg.clients)) {
          const client = cfg.clients[cid];
          const stack = [client];
          while (stack.length) {
            const o = stack.pop();
            if (o && typeof o === 'object') {
              for (const k of Object.keys(o)) {
                const v = o[k];
                if (v && typeof v === 'object' && typeof v.callback === 'function') { v.callback(tok); }
                else if (v && typeof v === 'object') stack.push(v);
              }
            }
          }
        }
      }
    } catch (e) {}
  }, token);
  log('reCAPTCHA token injected');
  return token;
}

module.exports = {
  installTurnstileInterceptor, getTurnstileParams, solveTurnstile, solveRecaptcha,
  bbApi,
};

// ---------------------------------------------------------------------------
// CLI: create a Browserbase session (built-in solver ON for the easy walls),
// open <url>, install the Turnstile interceptor, and solve.
// ---------------------------------------------------------------------------
if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    const url = argv.find((a) => !a.startsWith('--'));
    const doRecaptcha = argv.includes('--recaptcha');
    const keepAlive = argv.includes('--keep-alive');
    const wantDebug = argv.includes('--debug-url');
    if (!url) { console.error('usage: bb-solve.js <url> [--recaptcha] [--keep-alive] [--debug-url]'); process.exit(1); }
    if (!BB_KEY) { console.error('ERROR: BROWSERBASE_API_KEY is not set'); process.exit(1); }

    log('creating Browserbase session (built-in solveCaptchas ON)...');
    const session = await bbApi('/sessions', 'POST', {
      projectId: PROJECT_ID,
      browserSettings: { solveCaptchas: true },
      keepAlive: true,
      timeout: 3600,
    });
    log('session ' + session.id);
    let code = 0;
    try {
      if (wantDebug) {
        const dbg = await bbApi(`/sessions/${session.id}/debug`);
        log('live view: ' + dbg.debuggerFullscreenUrl);
      }
      const browser = await chromium.connectOverCDP(session.connectUrl);
      const page = browser.contexts()[0].pages()[0] || (await browser.contexts()[0].newPage());
      page.setDefaultTimeout(60000);

      await installTurnstileInterceptor(page); // must precede navigation
      log('opening ' + url);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
      await sleep(4000);

      let result = {};
      try {
        result.turnstileToken = (await solveTurnstile(page)).slice(0, 24) + '...';
      } catch (e) {
        log('Turnstile: ' + e.message);
      }
      if (doRecaptcha) {
        try { result.recaptchaToken = (await solveRecaptcha(page)).slice(0, 24) + '...'; }
        catch (e) { log('reCAPTCHA: ' + e.message); }
      }
      result.finalUrl = page.url();
      result.title = await page.title().catch(() => '');
      console.log(JSON.stringify(result, null, 2));
      await browser.close().catch(() => {});
    } catch (e) {
      if (e.isBilling) {
        console.error('ERROR (BILLING): ' + e.message);
        console.error('>> Discord Deyao to recharge 2Captcha (per CLAUDE.md). Do NOT work around.');
        code = 2;
      } else {
        console.error('ERROR: ' + e.message);
        code = 1;
      }
    } finally {
      if (!keepAlive) {
        await bbApi(`/sessions/${session.id}`, 'POST', { projectId: PROJECT_ID, status: 'REQUEST_RELEASE' }).catch(() => {});
        log('session released');
      }
    }
    process.exit(code);
  })();
}
