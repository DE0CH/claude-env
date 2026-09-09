#!/usr/bin/env node
/**
 * tunnel-live-capture.js — button-driven, low-latency live capture for the cf-tunnel.
 *
 * WHY: when Deyao needs a latency-sensitive screenshot (a QR code that expires,
 * a live page state), Claude driving the screenshot by hand is too slow — the QR
 * expires before the round-trip completes. Instead, this server holds a persistent
 * Playwright/CDP connection to a Browserbase session and exposes an HTML page with
 * BUTTONS. Deyao clicks a button; the server performs the action (e.g. regenerate
 * the QR) and returns a fresh PNG in the same request. Claude is NOT in the loop
 * between click -> action -> capture -> display.
 *
 * Point the cf-tunnel at this server's port (TUNNEL_TARGET=http://127.0.0.1:<port>).
 *
 * Env / args:
 *   --session <path>   JSON file with a Browserbase session {connectUrl,...} (required)
 *   --port <n>         listen port (default 8900)
 *
 * Endpoints:
 *   GET  /            -> the buttons page
 *   POST /capture?regen=1  -> regenerate QR (reload + activate QQ登录 tab), then PNG
 *   POST /capture          -> just screenshot current state, PNG (to check status)
 *   GET  /url        -> {url,title} of the current page (json)
 */
const { execSync } = require("node:child_process");
module.paths.push(execSync("npm root -g").toString().trim());
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const SESSION_PATH = arg("--session", "/tmp/claude-0/bb_session.json");
const PORT = parseInt(arg("--port", "8900"), 10);

let browser = null, page = null, connecting = null;

async function ensurePage() {
  if (page && !page.isClosed()) return page;
  if (connecting) return connecting;
  connecting = (async () => {
    const sess = JSON.parse(fs.readFileSync(SESSION_PATH, "utf8"));
    browser = await chromium.connectOverCDP(sess.connectUrl);
    const ctx = browser.contexts()[0];
    page = ctx.pages()[0] || (await ctx.newPage());
    browser.on("disconnected", () => { page = null; browser = null; });
    connecting = null;
    return page;
  })();
  return connecting;
}

async function activateQRTab(p) {
  // click the "QQ登录" tab so the QR iframe (re)loads
  try { await p.getByText("QQ登录", { exact: true }).click({ timeout: 6000 }); } catch (e) {}
}

// Find the QR <img> handle across all (nested) frames.
async function findQR(p) {
  for (const f of p.frames()) {
    try {
      const el = await f.$("#qrlogin_img, img.qrImg, img[src*='ptqrshow']");
      if (el) {
        const bb = await el.boundingBox();
        if (bb && bb.width > 20) return { el, bb };
      }
    } catch (e) {}
  }
  return null;
}

async function waitForQR(p, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const q = await findQR(p);
    if (q) return q;
    await p.waitForTimeout(500);
  }
  return null;
}

async function capture(regen) {
  const p = await ensurePage();
  if (regen) {
    await p.goto("https://mail.qq.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForTimeout(1500);
    await activateQRTab(p);
    await waitForQR(p, 9000); // wait until the QR image actually renders
  }
  const q = await findQR(p);
  if (q) {
    // clip a scannable region around the QR (page-relative coords from boundingBox)
    const b = q.bb;
    const pad = { x: Math.max(b.width * 0.9, 70), top: Math.max(b.height * 0.9, 60), bot: Math.max(b.height * 1.1, 80) };
    const clip = {
      x: Math.max(0, b.x - pad.x),
      y: Math.max(0, b.y - pad.top),
      width: b.width + pad.x * 2,
      height: b.height + pad.top + pad.bot,
    };
    return await p.screenshot({ clip });
  }
  // fallback: whole page (e.g. after login, to check mailbox state)
  return await p.screenshot({ fullPage: false });
}

const PAGE = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><title>QQ Mail QR · Claude</title>
<style>
 :root{--bg:#f4f5f7;--card:#fff;--text:#1a1d21;--muted:#6b7280;--accent:#12b7f5;--accent2:#0a8fd0;--ok:#16a34a;--border:#e5e7eb}
 @media(prefers-color-scheme:dark){:root{--bg:#101216;--card:#1a1e24;--text:#eceef1;--muted:#9aa1ab;--accent:#2fc6ff;--accent2:#12b7f5;--ok:#34d399;--border:#2a2f37}}
 *{box-sizing:border-box;margin:0;padding:0}
 body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:1rem}
 .card{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:1.5rem;width:100%;max-width:30rem;box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center}
 h1{font-size:1.2rem;margin-bottom:.4rem}
 p.sub{color:var(--muted);font-size:.9rem;line-height:1.45;margin-bottom:1rem}
 .imgwrap{background:#fff;border:1px solid var(--border);border-radius:14px;min-height:240px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:1rem}
 .imgwrap img{max-width:100%;display:block}
 .imgwrap .ph{color:var(--muted);font-size:.9rem;padding:2rem}
 .btns{display:flex;gap:.6rem;flex-wrap:wrap}
 button{flex:1 1 auto;font-size:1.02rem;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;border-radius:12px;padding:.9rem;cursor:pointer;transition:transform .1s,opacity .15s;min-width:9rem}
 button.secondary{background:transparent;color:var(--accent);border:1.5px solid var(--accent)}
 button:active{transform:scale(.98)} button:disabled{opacity:.55}
 .meta{color:var(--muted);font-size:.78rem;margin-top:.7rem;min-height:1.1em}
 .steps{text-align:left;color:var(--muted);font-size:.82rem;line-height:1.5;margin-top:1rem;border-top:1px dashed var(--border);padding-top:.8rem}
</style></head><body>
<div class="card">
 <h1>QQ Mail — scan to log in</h1>
 <p class="sub">Tap <b>New QR</b>, then scan the code with your 手机QQ app (扫一扫). The code refreshes each time you tap — scan it right after it appears.</p>
 <div class="imgwrap" id="wrap"><div class="ph" id="ph">Tap “New QR” to load the code</div></div>
 <div class="btns">
   <button id="newqr">🔄 New QR</button>
   <button id="refresh" class="secondary">👁 Refresh view</button>
 </div>
 <div class="meta" id="meta"></div>
 <div class="steps">
   <b>Steps:</b><br>1. Tap “New QR”.<br>2. Scan with 手机QQ → 扫一扫.<br>3. Confirm login on your phone.<br>4. Tap “Refresh view” — if it shows the mailbox, tell Claude in chat.
 </div>
</div>
<script>
(()=>{
 const $=id=>document.getElementById(id);
 async function grab(regen){
   const nb=$('newqr'), rb=$('refresh');
   nb.disabled=true; rb.disabled=true;
   $('meta').textContent = regen ? 'Generating a fresh QR…' : 'Capturing…';
   try{
     const r=await fetch('capture'+(regen?'?regen=1':''),{method:'POST'});
     if(!r.ok) throw new Error('HTTP '+r.status);
     const blob=await r.blob();
     const url=URL.createObjectURL(blob);
     const old=$('wrap').querySelector('img');
     const img=new Image(); img.onload=()=>{ if(old) old.remove(); const ph=$('ph'); if(ph) ph.remove(); };
     img.src=url; $('wrap').appendChild(img);
     $('meta').textContent='Updated '+new Date().toLocaleTimeString();
   }catch(e){ $('meta').textContent='Error: '+e.message+' — try again.'; }
   nb.disabled=false; rb.disabled=false;
 }
 $('newqr').addEventListener('click',()=>grab(true));
 $('refresh').addEventListener('click',()=>grab(false));
})();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && (u.pathname === "/" || u.pathname === "")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(PAGE);
    }
    if (req.method === "POST" && u.pathname === "/capture") {
      const regen = u.searchParams.get("regen") === "1";
      const buf = await capture(regen);
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      return res.end(buf);
    }
    if (req.method === "GET" && u.pathname === "/url") {
      const p = await ensurePage();
      const body = JSON.stringify({ url: p.url(), title: await p.title().catch(() => "") });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(body);
    }
    res.writeHead(404); res.end("not found");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("err: " + e.message);
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`live-capture on http://127.0.0.1:${PORT} (session ${SESSION_PATH})`));
