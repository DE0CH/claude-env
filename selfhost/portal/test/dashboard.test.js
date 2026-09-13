#!/usr/bin/env node
// Browser smoke test for the dashboard (run before pushing UI changes, and after a rollout).
//   node selfhost/portal/test/dashboard.test.js <baseURL> [outDir]
//   e.g. http://127.0.0.1:18080/  or  https://tunnel.deyaochen.com/t/portal/  (CF service token
//   is read from ~/.secrets when the URL is the tunnel). Needs `npm i playwright` +
//   `npx playwright install chromium` somewhere on NODE_PATH (e.g. ~/pwtest).
// Checks: no console errors / failed requests, sessions render, Terminal shows a live frame,
// New session dialog + environment editor open, and NO secret value appears in the DOM.
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
      const i = line.indexOf("="); if (i > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, i))) env[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch {}
  return env;
}
const headers = BASE.includes("tunnel.deyaochen.com")
  ? (() => { const s = secrets(); return { "CF-Access-Client-Id": s.CF_ACCESS_CLIENT_ID || "", "CF-Access-Client-Secret": s.CF_ACCESS_CLIENT_SECRET || "" }; })()
  : {};

const failures = [];
const ok = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!cond) failures.push(name); };

async function run(viewport, tag) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, extraHTTPHeaders: headers, deviceScaleFactor: 2, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
  const page = await ctx.newPage();
  const consoleErrors = [], failed = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${tag}-${n}.png`), fullPage: false, timeout: 90000, animations: "disabled" });

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => !!(window.getState && Array.isArray(window.getState().sessions)), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot("1-sessions");
  ok(`${tag}: xterm loaded`, await page.evaluate(() => typeof Terminal !== "undefined" && typeof FitAddon !== "undefined"));
  ok(`${tag}: terminal dialog hidden on load`, await page.evaluate(() => !document.getElementById("termdlg").open && getComputedStyle(document.getElementById("termdlg")).display === "none"));
  ok(`${tag}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const sessions = await page.evaluate(() => (window.getState().sessions || []).map((s) => ({ id: s.id, state: s.state, status: s.status })));
  ok(`${tag}: state loaded`, sessions.length >= 0, `${sessions.length} session(s)`);

  const live = sessions.find((s) => s.state === "started" && s.status);
  if (live) {
    await page.click(`button:has-text("Terminal")`);
    const status = page.locator("#term-status");
    await page.waitForFunction(() => /^live/.test(document.getElementById("term-status").textContent), null, { timeout: 20000 }).catch(() => {});
    const st = await status.textContent();
    ok(`${tag}: terminal live frame`, /^live/.test(st), st);
    const rows = await page.evaluate(() => document.querySelectorAll("#term .xterm-rows > div").length);
    ok(`${tag}: xterm rendered rows`, rows > 0, `${rows} rows`);
    await shot("2-terminal");
    await page.click("#termdlg .bar button");
    ok(`${tag}: terminal closes`, await page.evaluate(() => !document.getElementById("termdlg").open));
  } else console.log(`skip  ${tag}: no live session to open a terminal on`);

  await page.click("#fab button");
  await page.waitForSelector("#dlg[open]");
  ok(`${tag}: claude-env pre-checked`, await page.evaluate(() => { const c = document.querySelector('input[name=ns-repo][value="claude-env"]'); return !c || c.checked; }));
  ok(`${tag}: size default = medium`, await page.evaluate(() => document.querySelector('input[name=ns-size]:checked')?.value === "medium"));
  ok(`${tag}: auto perm default`, await page.evaluate(() => document.querySelector('input[name=ns-perm]:checked')?.value === "auto"));
  await shot("3-newsession");
  // action bar must sit at the very bottom of the dialog viewport
  const gap = await page.evaluate(() => { const d = document.getElementById("dlg").getBoundingClientRect(); const a = document.querySelector("#dlg .actions").getBoundingClientRect(); return Math.round(d.bottom - a.bottom); });
  ok(`${tag}: action bar flush with dialog bottom`, gap <= 1, `gap ${gap}px`);
  await page.click('#dlg button:has-text("Cancel")');

  await page.click("#t-envs");
  await page.click('button:has-text("Edit secrets")').catch(() => {});
  await page.waitForSelector("#dlg[open]").catch(() => {});
  const leak = await page.evaluate(() => {
    const vals = [...document.querySelectorAll("#dlg input, #dlg textarea")].map((i) => i.value).filter(Boolean);
    return vals.filter((v) => !/^[a-z0-9-]+$/.test(v)); // only the env id may be prefilled
  });
  ok(`${tag}: env editor shows no secret values`, leak.length === 0, leak.length ? `${leak.length} prefilled field(s)` : "");
  ok(`${tag}: env editor lists keys`, (await page.locator("#dlg .evk").count()) > 0);
  await shot("4-envedit");
  await page.click('#dlg button:has-text("Cancel")').catch(() => {});
  // Repos tab: the GitHub picker lists the token's repos, filters on typing, and a pick fills the URL
  await page.click("#t-repos");
  await page.click("#repo-search");
  await page.waitForFunction(() => document.querySelectorAll("#repo-dd .it").length > 0, null, { timeout: 30000 }).catch(() => {});
  const ddCount = await page.evaluate(() => document.querySelectorAll("#repo-dd .it").length);
  ok(`${tag}: repo picker lists GitHub repos`, ddCount > 0, `${ddCount} shown`);
  await page.fill("#repo-search", "claude-env");
  await page.waitForTimeout(200);
  const first = await page.evaluate(() => { const b = document.querySelector("#repo-dd .it"); return b ? { name: b.querySelector(".n").textContent, disabled: b.disabled } : null; });
  ok(`${tag}: picker filters + marks already-added`, !!first && /claude-env$/i.test(first.name) && first.disabled, JSON.stringify(first));
  await shot("5-repos-picker");
  await page.fill("#repo-search", "");
  await page.waitForTimeout(200);
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
  await page.evaluate(() => render());
  ok(`${tag}: add card survives re-render`, (await page.inputValue("#repo-url")) === "https://example.com/x/y.git");
  await page.click("#t-settings"); await page.waitForTimeout(300); await shot("6-settings");

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
