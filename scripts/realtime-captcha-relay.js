#!/usr/bin/env node
/**
 * realtime-captcha-relay.js — phone-friendly near-real-time slider-captcha relay.
 *
 * Frame source: a self-scheduling CDP Page.captureScreenshot CLIPPED to the captcha
 * region, streamed to the phone over SSE (~3-5 fps, small frames). Each finger move
 * is dispatched to the browser IMMEDIATELY via Input.dispatchMouseEvent, so the
 * puzzle piece moves as Deyao drags and he aligns it live. No LLM turn in the loop.
 *
 *   node scripts/realtime-captcha-relay.js --session <bb.json> --port 8902 --phone <num>
 */
const { execSync } = require("node:child_process");
module.paths.push(execSync("npm root -g").toString().trim());
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");

function arg(n, d) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; }
const SESSION_PATH = arg("--session", "/tmp/claude-0/hk_session.json");
const PORT = parseInt(arg("--port", "8902"), 10);
const PHONE = arg("--phone", "19875576715");

let browser = null, page = null, cdp = null, connecting = null;
let currentBox = null, latestFrame = null, looping = false;
const sseClients = new Set();

async function ensure() {
  if (page && !page.isClosed() && cdp) return page;
  if (connecting) return connecting;
  connecting = (async () => {
    const sess = JSON.parse(fs.readFileSync(SESSION_PATH, "utf8"));
    browser = await chromium.connectOverCDP(sess.connectUrl);
    page = browser.contexts()[0].pages()[0];
    cdp = await browser.contexts()[0].newCDPSession(page);
    browser.on("disconnected", () => { page = null; browser = null; cdp = null; });
    connecting = null;
    return page;
  })();
  return connecting;
}

async function captchaBox(p) {
  return await p.evaluate(() => {
    const cands = [...document.querySelectorAll("div,iframe")];
    let best = null;
    for (const e of cands) {
      const t = (e.innerText || "") + " " + (e.id || "") + " " + (e.className || "");
      const isCap = /安全验证|Safety check|tcaptcha|captcha/i.test(t) || (e.tagName === "IFRAME" && /captcha/i.test(e.src || ""));
      if (!isCap) continue;
      const r = e.getBoundingClientRect();
      if (r.width > 200 && r.height > 200 && r.width < 700 && r.height < 800) {
        const area = r.width * r.height;
        if (!best || area < best.area) best = { x: r.x, y: r.y, w: r.width, h: r.height, area };
      }
    }
    return best;
  });
}
async function triggerCaptcha() {
  const p = await ensure();
  try { const inp = await p.$("input[placeholder*='手机号']"); if (inp) { await inp.click(); await inp.fill(""); await inp.type(PHONE, { delay: 20 }); } } catch (e) {}
  try { await p.getByText("获取验证码", { exact: true }).first().click({ timeout: 5000 }); } catch (e) {}
  let box = null;
  for (let i = 0; i < 20; i++) { box = await captchaBox(p); if (box && box.w > 200) break; await p.waitForTimeout(500); }
  if (box) { await p.waitForTimeout(2500); box = await captchaBox(p) || box; }
  currentBox = box;
  return box;
}
async function getBox() { const p = await ensure(); let b = await captchaBox(p); if (!b) b = await triggerCaptcha(); currentBox = b || currentBox; return currentBox; }

async function captureLoop() {
  if (looping) return; looping = true;
  while (sseClients.size > 0) {
    try {
      if (cdp && currentBox) {
        const r = await cdp.send("Page.captureScreenshot", {
          format: "jpeg", quality: 55,
          clip: { x: currentBox.x, y: currentBox.y, width: currentBox.w, height: currentBox.h, scale: 1 },
        });
        latestFrame = r.data;
        const msg = `data: ${JSON.stringify({ f: latestFrame })}\n\n`;
        for (const res of sseClients) { try { res.write(msg); } catch (e) {} }
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 60));
  }
  looping = false;
}

async function dispatch(type, x, y) {
  await ensure();
  const map = { down: "mousePressed", move: "mouseMoved", up: "mouseReleased" };
  await cdp.send("Input.dispatchMouseEvent", { type: map[type] || "mouseMoved", x, y, button: "left", buttons: type === "up" ? 0 : 1, clickCount: 1 });
}
async function checkPass() {
  const p = await ensure();
  return await p.evaluate(() => {
    const txt = document.body.innerText || "";
    const codeInput = [...document.querySelectorAll("input")].some(e => /验证码|code/i.test(e.placeholder || ""));
    return { capGone: !/安全验证|Safety check/.test(txt), codeInput };
  });
}
function readBody(req) { return new Promise((r) => { let d = ""; req.on("data", c => d += c); req.on("end", () => r(d)); }); }

const PAGE = `<!doctype html><html lang=zh><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>QQ 实时滑块 · Claude</title><style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#101216;color:#eceef1;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:.7rem}
.card{background:#1a1e24;border:1px solid #2a2f37;border-radius:18px;padding:1rem;width:100%;max-width:30rem;text-align:center}
h1{font-size:1.05rem;margin-bottom:.3rem}p.s{color:#9aa1ab;font-size:.82rem;line-height:1.4;margin-bottom:.7rem}
.wrap{position:relative;background:#000;border:1px solid #2a2f37;border-radius:12px;overflow:hidden;margin-bottom:.7rem;touch-action:none;aspect-ratio:1/1}
img{width:100%;height:100%;display:block;pointer-events:none;object-fit:contain}
.b{display:flex;gap:.5rem}button{flex:1;font-size:1rem;font-weight:700;color:#fff;background:linear-gradient(135deg,#2fc6ff,#12b7f5);border:none;border-radius:11px;padding:.8rem}
button.sec{background:transparent;color:#2fc6ff;border:1.5px solid #2fc6ff}
.m{color:#9aa1ab;font-size:.8rem;margin-top:.5rem;min-height:1.1em}
</style></head><body>
<div class=card><h1>QQ 滑块（实时）</h1><p class=s>① 点“出验证码” → ② 手指在画面里按住底部滑块往右拖，拼图会实时跟着动，对齐缺口后松手。</p>
<div class=wrap id=wrap><img id=im></div>
<div class=b><button id=t>① 出验证码</button><button id=r class=sec>刷新</button></div>
<div class=m id=m>连接中…</div></div>
<script>
const im=document.getElementById('im'),M=document.getElementById('m'),wrap=document.getElementById('wrap');
let clip=null;
const es=new EventSource('frames');
es.onmessage=e=>{try{const d=JSON.parse(e.data);if(d.f)im.src='data:image/jpeg;base64,'+d.f;}catch(x){}};
es.onopen=()=>{M.textContent='已连接，点“出验证码”';};
async function getBox(re){M.textContent=re?'刷新中…':'呼出验证码…';try{const r=await fetch(re?'box':'trigger',{method:'POST'});const j=await r.json();if(j.box){clip=j.box;M.textContent='按住滑块往右拖';}else M.textContent='没拿到验证码，重试';}catch(e){M.textContent='出错，重试';}}
function toPage(ev){const r=im.getBoundingClientRect();const t=ev.touches&&ev.touches[0]?ev.touches[0]:ev;let cx=(t.clientX-r.left)/r.width,cy=(t.clientY-r.top)/r.height;cx=Math.max(0,Math.min(1,cx));cy=Math.max(0,Math.min(1,cy));return{x:clip.x+cx*clip.w,y:clip.y+cy*clip.h};}
function send(type,p){fetch('input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,x:p.x,y:p.y}),keepalive:true}).catch(()=>{});}
let dragging=false,lastMove=0;
function down(ev){if(!clip)return;ev.preventDefault();dragging=true;send('down',toPage(ev));}
function move(ev){if(!dragging)return;ev.preventDefault();const now=Date.now();if(now-lastMove<35)return;lastMove=now;send('move',toPage(ev));}
async function up(ev){if(!dragging)return;dragging=false;ev.preventDefault();send('up',toPage(ev));setTimeout(async()=>{try{const r=await fetch('pass');const j=await r.json();if(j.codeInput)M.textContent='✅ 过了！去看手机验证码，发我';else if(j.capGone)M.textContent='✅ 通过';else M.textContent='没过，点“刷新”再拖';}catch(e){}},1500);}
document.getElementById('t').onclick=()=>getBox(false);
document.getElementById('r').onclick=()=>getBox(true);
wrap.addEventListener('touchstart',down,{passive:false});wrap.addEventListener('touchmove',move,{passive:false});wrap.addEventListener('touchend',up,{passive:false});
wrap.addEventListener('mousedown',down);wrap.addEventListener('mousemove',move);wrap.addEventListener('mouseup',up);
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && (u.pathname === "/" || u.pathname === "")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); return res.end(PAGE);
    }
    if (u.pathname === "/health") { res.writeHead(200); return res.end("ok"); }
    if (req.method === "GET" && u.pathname === "/frames") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
      res.write(": connected\n\n"); sseClients.add(res);
      await ensure(); captureLoop();
      req.on("close", () => sseClients.delete(res));
      return;
    }
    if (req.method === "POST" && (u.pathname === "/trigger" || u.pathname === "/box")) {
      const box = u.pathname === "/trigger" ? await triggerCaptcha() : await getBox();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ box: box ? { x: box.x, y: box.y, w: box.w, h: box.h } : null }));
    }
    if (req.method === "POST" && u.pathname === "/input") {
      const b = JSON.parse(await readBody(req) || "{}");
      dispatch(b.type, b.x, b.y).catch(() => {});
      res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{}");
    }
    if (req.method === "GET" && u.pathname === "/pass") {
      const s = await checkPass(); res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(s));
    }
    res.writeHead(404); res.end("not found");
  } catch (e) { res.writeHead(500, { "Content-Type": "text/plain" }); res.end("err: " + e.message); }
});
const BIND = process.env.BIND || "127.0.0.1";
server.listen(PORT, BIND, () => console.log("realtime-captcha-relay on " + BIND + ":" + PORT + " session " + SESSION_PATH));
