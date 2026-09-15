#!/usr/bin/env node
// archive-dump.js — dump a web page's archive.today snapshot via Browserbase.
//
// Usage:
//   NODE_PATH=$(npm root -g) node scripts/archive-dump.js <url> [outfile.html]
//
// Handles both cases:
//   - URL already archived  -> fetches the newest snapshot and dumps it
//   - URL not archived yet  -> submits it for archiving, waits for the
//     capture to finish (wip page), then dumps the fresh snapshot
//
// Requirements:
//   - BROWSERBASE_API_KEY in the environment (BROWSERBASE_PROJECT_ID optional)
//   - playwright resolvable (globally installed: NODE_PATH=$(npm root -g))
//
// archive.today shows a "One more step" CAPTCHA wall to low-reputation IPs.
// The session is created with browserSettings.solveCaptchas=true and the
// script waits for Browserbase's built-in solver to clear the wall.
//
// Output: writes the snapshot's full HTML to the outfile (default
// archive-dump-<code>.html in the CWD) and prints a JSON summary
// {snapshotUrl, wasArchived, file} on stdout as the last line.

const fs = require('fs');
const { chromium } = require('playwright');

const API = 'https://api.browserbase.com/v1';
const API_KEY = process.env.BROWSERBASE_API_KEY;
const PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || '8f2c3e0b-53ae-4425-828e-79e5fd52a180';
const ARCHIVE_HOST = process.env.ARCHIVE_HOST || 'archive.ph'; // any archive.today mirror
const SUBMIT_WAIT_MS = 8 * 60 * 1000; // max wait for a fresh capture
const CAPTCHA_WAIT_MS = 120 * 1000;   // max wait for the built-in solver

function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

async function api(path, method = 'GET', body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'X-BB-API-Key': API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Browserbase API ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageState(page) {
  // Navigations (redirects, meta-refreshes on the wip page) destroy the
  // execution context mid-evaluate — just retry until the page holds still.
  for (let i = 0; ; i++) {
    try {
      return await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        text: document.body ? document.body.innerText.slice(0, 2000) : '',
      }));
    } catch (e) {
      if (i >= 10) throw e;
      await sleep(2000);
    }
  }
}

function isCaptcha(state) {
  return /One more step|complete the security check|Verifying you are human/i.test(state.text);
}

// Browserbase's built-in solver announces itself via console messages
// ("browserbase-solving-started" / "browserbase-solving-finished").
// Track them so we wait on the solver's own signal, with the page-text
// check as a fallback for walls the solver doesn't announce.
function trackCaptchaSolver(page) {
  const solver = { active: false };
  page.on('console', (msg) => {
    const t = msg.text();
    if (t === 'browserbase-solving-started') {
      solver.active = true;
      console.error('[+] captcha detected — Browserbase solver working...');
    } else if (t === 'browserbase-solving-finished') {
      solver.active = false;
      console.error('[+] captcha solved');
    }
  });
  return solver;
}

// Wait until the built-in solver is done and the CAPTCHA wall is gone.
async function waitPastCaptcha(page, solver) {
  const start = Date.now();
  let state = await pageState(page);
  while (solver.active || isCaptcha(state)) {
    if (Date.now() - start > CAPTCHA_WAIT_MS) {
      throw new Error('CAPTCHA wall did not clear within ' + CAPTCHA_WAIT_MS / 1000 + 's');
    }
    await sleep(5000);
    state = await pageState(page);
  }
  return state;
}

async function main() {
  const [, , targetUrl, outArg] = process.argv;
  if (!targetUrl) die('usage: archive-dump.js <url> [outfile.html]');
  if (!API_KEY) die('BROWSERBASE_API_KEY is not set');

  console.error(`[+] creating Browserbase session (solveCaptchas on)...`);
  const session = await api('/sessions', 'POST', {
    projectId: PROJECT_ID,
    browserSettings: { solveCaptchas: true },
    keepAlive: true,
    timeout: 3600,
  });
  console.error(`[+] session ${session.id}`);

  let exitCode = 0;
  try {
    const browser = await chromium.connectOverCDP(session.connectUrl);
    const page = browser.contexts()[0].pages()[0] || (await browser.contexts()[0].newPage());
    page.setDefaultTimeout(60000);
    const solver = trackCaptchaSolver(page);

    // 1) Ask for the newest snapshot. Redirects to it if one exists.
    const newestUrl = `https://${ARCHIVE_HOST}/newest/${targetUrl}`;
    console.error(`[+] opening ${newestUrl}`);
    await page.goto(newestUrl, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
    let state = await waitPastCaptcha(page, solver);
    // If the solver bounced us to the host root, retry the /newest/ request.
    if (state.url.replace(/\/$/, '') === `https://${ARCHIVE_HOST}`) {
      await page.goto(newestUrl, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
      state = await waitPastCaptcha(page, solver);
    }

    let wasArchived = true;
    if (state.url.includes('/newest/') && /No results/i.test(state.text)) {
      // 2) Not archived yet: follow "archive this url" and submit the form.
      wasArchived = false;
      console.error('[+] no snapshot exists — submitting for archiving...');
      const submitHref = await page.evaluate(() => {
        const a = [...document.querySelectorAll('a')].find((x) => /archive this url/i.test(x.innerText));
        return a ? a.href : null;
      });
      if (!submitHref) throw new Error('no "archive this url" link on the No-results page');
      await page.goto(submitHref, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await waitPastCaptcha(page, solver);
      const clicked = await page.evaluate(() => {
        const btn = document.querySelector('form[action*="submit"] input[type="submit"]');
        if (btn) btn.click();
        return !!btn;
      });
      if (!clicked) throw new Error('submit form not found on ' + submitHref);

      // 3) The wip/<code> page auto-refreshes until the capture completes.
      console.error('[+] waiting for capture to finish (wip page)...');
      const start = Date.now();
      for (;;) {
        await sleep(10000);
        state = await pageState(page);
        if (solver.active || isCaptcha(state)) { state = await waitPastCaptcha(page, solver); continue; }
        if (!/\/(wip|submit)\//.test(state.url) && !state.url.includes('/newest/')) break;
        if (Date.now() - start > SUBMIT_WAIT_MS) {
          throw new Error('capture did not finish in time; last url: ' + state.url);
        }
        console.error(`    ... still capturing (${state.url})`);
      }
    } else if (state.url.includes('/newest/')) {
      throw new Error('unexpected page at /newest/: ' + state.text.slice(0, 200));
    }

    // 4) We are on the snapshot page — dump it.
    console.error(`[+] snapshot: ${state.url}`);
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    const code = (state.url.match(/https?:\/\/[^/]+\/([A-Za-z0-9]+)/) || [])[1] || 'snapshot';
    const outfile = outArg || `archive-dump-${code}.html`;
    fs.writeFileSync(outfile, html);
    console.error(`[+] wrote ${outfile} (${html.length} bytes)`);
    console.log(JSON.stringify({ snapshotUrl: state.url, wasArchived, file: outfile }));
    await browser.close().catch(() => {});
  } catch (e) {
    console.error('ERROR: ' + e.message);
    exitCode = 1;
  } finally {
    await api(`/sessions/${session.id}`, 'POST', { projectId: PROJECT_ID, status: 'REQUEST_RELEASE' })
      .catch((e) => console.error('warn: release failed: ' + e.message));
    console.error('[+] session released');
  }
  process.exit(exitCode);
}

main().catch((e) => die(e.message));
