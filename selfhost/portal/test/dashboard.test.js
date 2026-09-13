#!/usr/bin/env node
// Browser smoke test for the dashboard (run before pushing UI changes, and after a rollout).
//   node selfhost/portal/test/dashboard.test.js <baseURL> [outDir]
//   e.g. http://127.0.0.1:18080/  (test/mock-server.js)  or  https://tunnel.deyaochen.com/t/portal/
//   (CF service token is read from the environment or ~/.secrets when the URL is the tunnel).
//   Needs playwright + chromium on NODE_PATH (preinstalled in the session image).
// Checks: no console errors / failed requests, sessions render, the Terminal auto-fits on open
// and again when its area shrinks, the sheet handle drags to full screen and down to dismiss,
// the session action menu opens, New session / env editor open, and NO secret value appears
// in the DOM. Screenshots land in outDir.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:18080/";
const OUT = process.argv[3] || path.join(os.tmpdir(), "dashboard-test");
fs.mkdirSync(OUT, { recursive: true });

function secrets() {
  const env = {};
  try {
    for (const line of fs.readFileSync(path.join(os.homedir(), ".secrets"), "utf8").split("\n")) {
      const i = line.indexOf("="); if (i > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, i))) env[line.slice(0, i)] = line.slice(i + 1).replace(/^'(.*)'$/, "$1");
    }
  } catch {}
  return env;
}
const LIVE = BASE.includes("tunnel.deyaochen.com"); // real sessions behind it — no keystrokes
const headers = LIVE
  ? (() => { const s = { ...secrets(), ...process.env }; return { "CF-Access-Client-Id": s.CF_ACCESS_CLIENT_ID || "", "CF-Access-Client-Secret": s.CF_ACCESS_CLIENT_SECRET || "" }; })()
  : {};

const failures = [];
const ok = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!cond) failures.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// drag with a pointer from (x,y1) to (x,y2) — touch on phones, mouse on desktop
async function drag(page, touch, x, y1, y2, steps = 12) {
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const pt = (y) => ({ x, y });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt(y1)] });
    for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [pt(y1 + (y2 - y1) * i / steps)] }); await sleep(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y1); await page.mouse.down();
    for (let i = 1; i <= steps; i++) { await page.mouse.move(x, y1 + (y2 - y1) * i / steps); await sleep(16); }
    await page.mouse.up();
  }
}

async function run(viewport, tag) {
  const touch = viewport.width < 600;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, extraHTTPHeaders: headers, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch });
  const page = await ctx.newPage();
  const consoleErrors = [], failed = [], resizes = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  page.on("request", (r) => { if (/tty\/resize$/.test(r.url())) resizes.push(r.postDataJSON()); });
  page.on("dialog", (d) => d.dismiss());
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${tag}-${n}.png`), fullPage: false, timeout: 90000, animations: "disabled" });

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => !!(window.getState && Array.isArray(window.getState().sessions)), null, { timeout: 30000 }).catch(() => {});
  await sleep(800);
  await shot("1-sessions");
  ok(`${tag}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  ok(`${tag}: no vertical overflow with a short list`, await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), await page.evaluate(() => `${document.documentElement.scrollHeight} vs ${window.innerHeight}`));
  const sessions = await page.evaluate(() => (window.getState().sessions || []).map((s) => ({ id: s.id, state: s.state, status: s.status })));
  ok(`${tag}: state loaded`, sessions.length >= 0, `${sessions.length} session(s)`);
  ok(`${tag}: one action row per card, no button wall`, await page.evaluate(() => [...document.querySelectorAll(".scard .actions")].every((r) => r.querySelectorAll("button").length <= 2)));

  const live = sessions.find((s) => s.state === "started" && s.status);
  if (live) {
    await page.click('.scard button:has-text("Terminal")');
    await page.waitForFunction(() => /^live/.test(document.getElementById("term-status")?.textContent || ""), null, { timeout: 20000 }).catch(() => {});
    const st = await page.locator("#term-status").textContent();
    ok(`${tag}: terminal live frame`, /^live/.test(st), st);
    await sleep(700);
    ok(`${tag}: terminal auto-fit on open`, resizes.length >= 1, JSON.stringify(resizes[0] || null));
    const box = await page.evaluate(() => { const r = document.querySelector(".term").getBoundingClientRect(); return { top: r.top, h: r.height, vh: innerHeight }; });
    ok(`${tag}: terminal fills the visual viewport`, Math.abs(box.top) < 2 && Math.abs(box.h - box.vh) < 2, JSON.stringify(box));
    const rows = await page.evaluate(() => document.querySelectorAll("#term .xterm-rows > div").length);
    ok(`${tag}: xterm rendered rows`, rows > 0, `${rows} rows`);
    await shot("2-terminal");
    // shrink the window (what the keyboard does to the visual viewport) → refit + remote resize
    const n0 = resizes.length;
    await page.setViewportSize({ width: viewport.width, height: Math.round(viewport.height * 0.55) });
    await sleep(900);
    ok(`${tag}: terminal refits when its area shrinks`, resizes.length > n0 && resizes[resizes.length - 1].rows < resizes[n0 - 1].rows, JSON.stringify(resizes.slice(n0)));
    await shot("3-terminal-short");
    await page.setViewportSize(viewport);
    await sleep(600);
    // key chip + input row — only against the mock: on the live portal this would type into a REAL session
    if (!LIVE) {
      await page.click('.term .keys button:has-text("Esc")');
      await page.fill("#term-in", "hello"); await page.press("#term-in", "Enter");
      ok(`${tag}: input row cleared after send`, (await page.inputValue("#term-in")) === "");
    }
    // ✕ closes the page (a plain full-screen page, no gestures around xterm)
    await page.click('.term button[aria-label="Close"]');
    await sleep(500);
    ok(`${tag}: terminal closes with ✕`, (await page.locator(".term").count()) === 0);
    // reopen and use the browser's Back
    await page.click('.scard button:has-text("Terminal")'); await sleep(800);
    await page.goBack(); await sleep(500);
    ok(`${tag}: terminal closes with browser Back`, (await page.locator(".term").count()) === 0);
    // put the live session's tmux back to its boot size (the test just refitted it to this viewport)
    if (LIVE) await page.evaluate((id) => fetch(`api/sessions/${id}/tty/resize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cols: 120, rows: 40 }) }), live.id);
  } else console.log(`skip  ${tag}: no live session to open a terminal on`);

  // action menu
  const more = page.locator('.scard button[aria-label="More actions"]').first();
  if (await more.count()) {
    await more.click(); await sleep(600);
    ok(`${tag}: action sheet opens`, (await page.locator(".menu button.mi").count()) >= 1, `${await page.locator(".menu button.mi").count()} items`);
    await shot("4-menu");
    await page.click(".menu .cancel");
    await page.waitForFunction(() => !document.querySelector(".menu"), null, { timeout: 2000 }).catch(() => {});
    ok(`${tag}: action sheet closes`, (await page.locator(".menu").count()) === 0);
  }

  // New session sheet: opens at the lower snap point, handle drags to full, drags down to dismiss
  await page.click("#newBtn");
  await page.waitForSelector(".sheet.snap"); await sleep(700);
  const checked = (sel) => page.evaluate((sel) => document.querySelector(sel + ' [data-state="checked"]')?.getAttribute("value"), sel);
  ok(`${tag}: claude-env pre-checked`, await page.evaluate(() => { const c = document.querySelector('#ns-repo [value="claude-env"]'); return !c || c.getAttribute("data-state") === "checked"; }));
  ok(`${tag}: size default = medium`, (await checked("#ns-size")) === "medium");
  ok(`${tag}: model default = opus 4.8`, (await checked("#ns-model")) === "claude-opus-4-8");
  ok(`${tag}: auto perm default`, (await checked("#ns-perm")) === "auto");
  const top1 = (await page.locator(".sheet.snap").boundingBox()).y;
  ok(`${tag}: sheet opens part-way (snap point)`, top1 > viewport.height * 0.25, `top ${Math.round(top1)}px of ${viewport.height}`);
  await shot("5-newsession-snap");
  let hb = await page.locator(".sheet.snap .handle-wrap").boundingBox();
  await drag(page, touch, hb.x + hb.width / 2, hb.y + hb.height / 2, 10);
  await sleep(700);
  const top2 = (await page.locator(".sheet.snap").boundingBox()).y;
  ok(`${tag}: handle drag expands to full screen`, top2 < top1 - 50 && top2 < viewport.height * 0.12, `top ${Math.round(top2)}px`);
  ok(`${tag}: header actions visible`, await page.locator('.sheet .head button:has-text("Start")').isVisible());
  await shot("6-newsession-full");
  // flick down: full → half (or closed), flick again → closed
  for (let i = 0; i < 2 && (await page.locator(".sheet.snap").count()); i++) {
    hb = await page.locator(".sheet.snap .handle-wrap").boundingBox();
    await drag(page, touch, hb.x + hb.width / 2, hb.y + hb.height / 2, hb.y + 400, 4);
    await sleep(700);
  }
  ok(`${tag}: handle flick down dismisses`, (await page.locator(".sheet").count()) === 0);

  await page.click("[data-tab=envs]"); await sleep(200);
  await page.click('button:has-text("Edit secrets")').catch(() => {});
  await page.waitForSelector(".sheet").catch(() => {}); await sleep(600);
  const leak = await page.evaluate(() => [...document.querySelectorAll(".sheet input, .sheet textarea")].map((i) => i.value).filter(Boolean).filter((v) => !/^[a-z0-9-]+$/.test(v)));
  ok(`${tag}: env editor shows no secret values`, leak.length === 0, leak.length ? `${leak.length} prefilled field(s)` : "");
  ok(`${tag}: env editor lists keys`, (await page.locator(".sheet .evk").count()) > 0);
  await shot("7-envedit");
  await page.click('.sheet .head button:has-text("Cancel")').catch(() => {}); await sleep(600);
  // Bootstrap's own dark mode follows the OS: the page must set data-bs-theme
  ok(`${tag}: colour mode set`, await page.evaluate(() => ["light", "dark"].some((c) => document.documentElement.classList.contains(c))));

  // Repos tab: the GitHub picker lists the token's repos, filters on typing, and a pick fills the URL
  await page.click("[data-tab=repos]");
  await page.click("#repo-search");
  await page.waitForFunction(() => document.querySelectorAll("#repo-dd .it").length > 0, null, { timeout: 30000 }).catch(() => {});
  const ddCount = await page.evaluate(() => document.querySelectorAll("#repo-dd .it").length);
  ok(`${tag}: repo picker lists GitHub repos`, ddCount > 0, `${ddCount} shown`);
  await page.fill("#repo-search", "claude-env"); await sleep(200);
  const first = await page.evaluate(() => { const b = document.querySelector("#repo-dd .it"); return b ? { name: b.querySelector(".n").textContent, disabled: b.disabled } : null; });
  ok(`${tag}: picker filters + marks already-added`, !!first && /claude-env$/i.test(first.name) && first.disabled, JSON.stringify(first));
  await shot("8-repos-picker");
  await page.fill("#repo-search", ""); await sleep(200);
  const pickable = page.locator("#repo-dd .it:not([disabled])").first();
  if (await pickable.count()) {
    const nm = await pickable.locator(".n").textContent();
    await pickable.click();
    const url = await page.inputValue("#repo-url");
    ok(`${tag}: pick fills git URL`, url.toLowerCase().includes(nm.toLowerCase()), `${nm} -> ${url}`);
    ok(`${tag}: picker closes after pick`, await page.evaluate(() => document.getElementById("repo-dd").hidden));
  } else console.log(`skip  ${tag}: every listed repo is already added`);
  // a poll-driven re-render must not wipe the typed URL
  await page.fill("#repo-url", "https://example.com/x/y.git");
  await page.evaluate(() => window.__refresh()); await sleep(300);
  ok(`${tag}: add card survives re-render`, (await page.inputValue("#repo-url")) === "https://example.com/x/y.git");
  await page.click("[data-tab=settings]"); await sleep(300); await shot("9-settings");

  const benign = (s) => /favicon/.test(s);
  ok(`${tag}: no console errors`, consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 300));
  ok(`${tag}: no failed requests`, failed.filter((f) => !benign(f)).length === 0, failed.filter((f) => !benign(f)).join(" | ").slice(0, 300));
  await browser.close();
}

(async () => {
  console.log(`testing ${BASE} -> screenshots in ${OUT}`);
  await run({ width: 390, height: 844 }, "phone");
  await run({ width: 1600, height: 900 }, "desktop");
  console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(", ")}` : "\nALL PASSED");
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error("test crashed:", e); process.exit(2); });
