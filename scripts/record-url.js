#!/usr/bin/env node
// Self-hosted "session recorder": point a headless Chromium at a live monitoring
// URL (e.g. a mobilerun / MobileNext device live view) and record whatever the
// page shows to a .webm video file, so we get a Browserbase-style run recording
// without depending on the device vendor's opt-in recording API.
//
// Aspect ratio: by default it probes the page for the device's media element
// (the largest <video>/<canvas>/<img>), derives its aspect ratio, sizes the
// recording to match, and fits that element to fill the frame (reparent + hide
// the rest) so the video is just the device screen, correctly proportioned and
// not letterboxed. Override any of that with the env knobs below.
//
// Usage:
//   NODE_PATH=/opt/node22/lib/node_modules \
//   node scripts/record-url.js <url> <outDir> [durationSeconds]
//
//   - durationSeconds given  -> records that long, then finalizes and exits.
//   - durationSeconds absent -> records until SIGINT/SIGTERM, then finalizes.
//
// Env knobs:
//   REC_FIT_SELECTOR  CSS selector for the device element (default: auto-detect
//                     largest of video,canvas,img). Set REC_FIT=off to disable
//                     fitting and just record the page as-is.
//   REC_LONG          long-side pixels of the output video (default 900)
//   REC_WIDTH/REC_HEIGHT  hard-override the video size (skips aspect probe)
//   REC_WAIT_UNTIL    nav wait state (default 'domcontentloaded')
//   REC_SETTLE_MS     ms to wait after nav before probing/fitting (default 2500)
//
// The finalized video path is printed as the last stdout line: "VIDEO: <path>".

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const even = n => (n % 2 ? n + 1 : n); // some encoders dislike odd dimensions

// Runs in the page: find the biggest visible media element (or a given selector)
// and return its rect + a stable-ish selector we can re-find it by.
function probeScript(userSelector) {
  const pick = () => {
    if (userSelector) {
      const el = document.querySelector(userSelector);
      return el ? [el] : [];
    }
    return Array.from(document.querySelectorAll('video,canvas,img'));
  };
  let best = null, bestArea = 0;
  for (const el of pick()) {
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (r.width > 40 && r.height > 40 && area > bestArea) { best = el; bestArea = area; }
  }
  if (!best) return null;
  const r = best.getBoundingClientRect();
  // tag it so the fit step can find the exact element
  best.setAttribute('data-rec-fit-target', '1');
  return { w: Math.round(r.width), h: Math.round(r.height), tag: best.tagName.toLowerCase() };
}

// Runs in the page: make the tagged element fill the viewport, hide siblings.
function fitScript() {
  const el = document.querySelector('[data-rec-fit-target="1"]');
  if (!el) return false;
  document.body.appendChild(el); // escape any clipped/positioned ancestor
  const s = el.style;
  s.position = 'fixed'; s.left = '0'; s.top = '0';
  s.width = '100vw'; s.height = '100vh';
  s.objectFit = 'contain'; s.zIndex = '2147483647'; s.background = '#000';
  const kill = document.createElement('style');
  kill.textContent = 'body>*:not([data-rec-fit-target="1"]){display:none!important}' +
    'html,body{margin:0!important;padding:0!important;background:#000!important;overflow:hidden!important}';
  document.head.appendChild(kill);
  return true;
}

async function main() {
  const [url, outDir, durationArg] = process.argv.slice(2);
  if (!url || !outDir) {
    console.error('usage: record-url.js <url> <outDir> [durationSeconds]');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const fitOff = (process.env.REC_FIT || '').toLowerCase() === 'off';
  const userSelector = process.env.REC_FIT_SELECTOR || null;
  const longSide = parseInt(process.env.REC_LONG || '900', 10);
  const waitUntil = process.env.REC_WAIT_UNTIL || 'domcontentloaded';
  const settleMs = parseInt(process.env.REC_SETTLE_MS || '2500', 10);
  const durationMs = durationArg ? Math.round(parseFloat(durationArg) * 1000) : null;

  const browser = await chromium.launch({ headless: true });

  // ---- Phase 1: probe the real device element to learn its aspect ratio ----
  let recW = parseInt(process.env.REC_WIDTH || '0', 10);
  let recH = parseInt(process.env.REC_HEIGHT || '0', 10);
  let probe = null;
  if (!recW || !recH) {
    const probeCtx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const probePage = await probeCtx.newPage();
    try {
      await probePage.goto(url, { waitUntil, timeout: 60000 });
      await probePage.waitForTimeout(settleMs);
      probe = await probePage.evaluate(probeScript, userSelector);
    } catch (e) {
      console.error(`probe warning: ${e.message}`);
    }
    await probeCtx.close();

    if (probe && probe.w && probe.h) {
      const ar = probe.w / probe.h;
      if (ar >= 1) { recW = longSide; recH = Math.round(longSide / ar); }
      else { recH = longSide; recW = Math.round(longSide * ar); }
      console.log(`probed device element <${probe.tag}> ${probe.w}x${probe.h} (aspect ${ar.toFixed(3)}) -> video ${recW}x${recH}`);
    } else {
      // sensible phone-portrait default if we couldn't find a media element
      recW = Math.round(longSide * 1080 / 2340);
      recH = longSide;
      console.error(`no media element detected; defaulting to portrait ${recW}x${recH}`);
    }
  }
  recW = even(clamp(recW, 100, 2000));
  recH = even(clamp(recH, 100, 2000));

  // ---- Phase 2: record at the derived size, fitting the element to fill ----
  const context = await browser.newContext({
    viewport: { width: recW, height: recH },
    recordVideo: { dir: outDir, size: { width: recW, height: recH } },
  });
  const page = await context.newPage();

  let finished = false;
  async function finalize(reason) {
    if (finished) return;
    finished = true;
    console.log(`finalizing (${reason})...`);
    const video = page.video();
    try { await context.close(); } catch (e) {}
    try { await browser.close(); } catch (e) {}
    let out = null;
    if (video) { try { out = await video.path(); } catch (e) {} }
    if (!out || !fs.existsSync(out)) {
      const webms = fs.readdirSync(outDir).filter(f => f.endsWith('.webm'))
        .map(f => path.join(outDir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      out = webms[0] || null;
    }
    if (out) console.log(`VIDEO: ${path.resolve(out)}`);
    else console.error('no video produced');
    process.exit(0);
  }
  process.on('SIGINT', () => finalize('SIGINT'));
  process.on('SIGTERM', () => finalize('SIGTERM'));

  console.log(`recording ${url} -> ${outDir} (${recW}x${recH})`);
  try {
    await page.goto(url, { waitUntil, timeout: 60000 });
  } catch (e) {
    console.error(`nav warning: ${e.message} (continuing)`);
  }
  await page.waitForTimeout(settleMs);
  if (!fitOff) {
    try {
      await page.evaluate(probeScript, userSelector); // re-tag target in this ctx
      const ok = await page.evaluate(fitScript);
      console.log(ok ? 'fitted device element to frame' : 'fit: no target found (recording page as-is)');
    } catch (e) {
      console.error(`fit warning: ${e.message}`);
    }
  }
  console.log('RECORDING (send SIGTERM to stop, or wait for duration)');

  if (durationMs) {
    await page.waitForTimeout(durationMs);
    await finalize('duration');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
