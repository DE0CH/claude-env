#!/usr/bin/env node
/**
 * captcha-relay-server.js — phone-friendly, low-latency interactive captcha relay.
 *
 * Deyao taps a button to TRIGGER the captcha (the action that raises it), the slider
 * is screenshotted to his phone, he DRAGS it with his finger, and his exact drag
 * trajectory is replayed onto the Browserbase page over CDP mouse events — with no
 * LLM turn in the loop. Replaying his real human trajectory is what beats Tencent's
 * bot-detection. Reached via a cf-tunnel agent pointed at this port.
 *
 *   node scripts/captcha-relay-server.js --session <bb_session.json> --port 8901
 */
const { execSync } = require("node:child_process");
module.paths.push(execSync("npm root -g").toString().trim());
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");

function arg(n, d) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; }
const SESSION_PATH = arg("--session", "/tmp/claude-0/hk_session.json");
const PORT = parseInt(arg("--port", "8901"), 10);
const PHONE = arg("--phone", "19875576715");

let browser = null, page = null, connecting = null;
async function ensure() {
  if (page && !page.isClosed()) return page;
  if (connecting) return connecting;
  connecting = (async () => {
    const sess = JSON.parse(fs.readFileSync(SESSION_PATH, "utf8"));
    browser = await chromium.connectOverCDP(sess.connectUrl);
    page = browser.contexts()[0].pages()[0];
    browser.on("disconnected", () => { page = null; browser = null; });
    connecting = null;
    return page;
  })();
  return connecting;
}
function readBody(req) { return new Promise((res) => { let d = ""; req.on("data", c => d += c); req.on("end", () => res(d)); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// find the captcha dialog's bounding box (CSS px) on the main page
async function captchaBox(p) {
  return await p.evaluate(() => {
    // the account-safety dialog / captcha container
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
  // ensure phone filled + click 获取验证码 to raise the captcha
  try {
    const inp = await p.$("input[placeholder*='手机号']");
    if (inp) { await inp.click(); await inp.fill(""); await inp.type(PHONE, { delay: 20 }); }
  } catch (e) {}
  try { await p.getByText("获取验证码", { exact: true }).first().click({ timeout: 5000 }); } catch (e) {}
  // wait for captcha box
  let box = null;
  for (let i = 0; i < 20; i++) { box = await captchaBox(p); if (box && box.w > 200) break; await p.waitForTimeout(500); }
  if (box) await p.waitForTimeout(3000); // let the slider image actually render
  return box;
}

async function snap() {
  const p = await ensure();
  let box = await captchaBox(p);
  if (!box) box = await triggerCaptcha();
  if (!box) return null;
  const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.w, height: box.h };
  let png = await p.screenshot({ clip });
  // retry once if the capture looks blank (still loading)
  if (png.length < 15000) { await p.waitForTimeout(2500); png = await p.screenshot({ clip }); }
  return { png, clip };
}

// replay a human trajectory (page-coord points [{x,y,t}]) as CDP mouse events
async function dragReplay(points) {
  const p = await ensure();
  if (!points || points.length < 2) return { ok: false, msg: "too few points" };
  await p.mouse.move(points[0].x, points[0].y);
  await p.mouse.down();
  let last = points[0].t || 0;
  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    const dt = Math.max(0, Math.min(120, (pt.t || 0) - last)); last = pt.t || last;
    if (dt) await sleep(dt);
    await p.mouse.move(pt.x, pt.y);
  }
  await p.mouse.up();
  await sleep(2500);
  // check outcome
  const state = await p.evaluate(() => {
    const txt = document.body.innerText || "";
    const capGone = !/安全验证|Safety check/.test(txt);
    const codeInput = [...document.querySelectorAll("input")].some(e => /验证码|code/i.test(e.placeholder || ""));
    const err = /验证失败|重试|拖动|再试/.test(txt);
    return { capGone, codeInput, err, url: location.href };
  });
  return { ok: true, ...state };
}

const PAGE = `<!doctype html><html lang=zh><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name=robots content=noindex><title>QQ 滑块验证 · Claude</title>
<style>
 :root{--bg:#f4f5f7;--card:#fff;--tx:#1a1d21;--mut:#6b7280;--ac:#12b7f5;--ac2:#0a8fd0;--ok:#16a34a;--bd:#e5e7eb}
 @media(prefers-color-scheme:dark){:root{--bg:#101216;--card:#1a1e24;--tx:#eceef1;--mut:#9aa1ab;--ac:#2fc6ff;--ac2:#12b7f5;--ok:#34d399;--bd:#2a2f37}}
 *{box-sizing:border-box;margin:0;padding:0;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
 body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--tx);min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:.8rem}
 .card{background:var(--card);border:1px solid var(--bd);border-radius:18px;padding:1.1rem;width:100%;max-width:32rem;box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center}
 h1{font-size:1.1rem;margin-bottom:.3rem}
 p.s{color:var(--mut);font-size:.85rem;line-height:1.4;margin-bottom:.8rem}
 .w{position:relative;background:#fff;border:1px solid var(--bd);border-radius:12px;min-height:180px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:.8rem;touch-action:none}
 .w img{max-width:100%;display:block;pointer-events:none}
 .w .ph{color:var(--mut);padding:2rem;font-size:.9rem}
 .b{display:flex;gap:.5rem;flex-wrap:wrap}
 button{flex:1 1 auto;font-size:1rem;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--ac),var(--ac2));border:none;border-radius:11px;padding:.85rem;min-width:8rem}
 button.sec{background:transparent;color:var(--ac);border:1.5px solid var(--ac)}
 button:disabled{opacity:.5}
 .m{color:var(--mut);font-size:.8rem;margin-top:.6rem;min-height:1.1em}
 .hint{font-size:.78rem;color:var(--mut);margin-top:.5rem;line-height:1.4}
 canvas{position:absolute;inset:0;pointer-events:none}
</style></head><body>
<div class=card>
 <h1>QQ 滑块验证</h1>
 <p class=s>① 点“出验证码” → ② 用手指把拼图块拖到缺口（在图片上直接拖）→ 松手即自动重放到浏览器。</p>
 <div class=w id=w><div class=ph id=ph>点“出验证码”</div><canvas id=cv></canvas></div>
 <div class=b><button id=t>① 出验证码</button><button id=r class=sec>刷新图片</button></div>
 <div class=m id=m></div>
 <div class=hint>拖动无效就点“刷新图片”再试。成功后 QQ 会给你手机发验证码，直接在聊天里发给我。</div>
</div>
<script>
const $=i=>document.getElementById(i);
let clip=null, drawn=false, pts=[], dragging=false, t0=0;
const wrap=$('w'), cv=$('cv');
function setImg(blob,meta){
 clip=meta;
 const old=wrap.querySelector('img'); const u=URL.createObjectURL(blob); const im=new Image();
 im.onload=()=>{ if(old)old.remove(); const ph=$('ph'); if(ph)ph.remove(); drawn=true; sizeCanvas(); };
 im.src=u; wrap.insertBefore(im,cv);
}
function sizeCanvas(){ const im=wrap.querySelector('img'); if(!im)return; cv.width=im.clientWidth; cv.height=im.clientHeight; cv.style.width=im.clientWidth+'px'; cv.style.height=im.clientHeight+'px'; }
async function trigger(re){
 const tb=$('t'),rb=$('r'); tb.disabled=rb.disabled=true; $('m').textContent=re?'刷新中…':'呼出验证码中…';
 try{ const rs=await fetch(re?'snap':'trigger',{method:'POST'}); if(!rs.ok)throw new Error('HTTP '+rs.status);
   const meta={x:+rs.headers.get('X-Clip-X'),y:+rs.headers.get('X-Clip-Y'),w:+rs.headers.get('X-Clip-W'),h:+rs.headers.get('X-Clip-H')};
   const blob=await rs.blob(); setImg(blob,meta); $('m').textContent='拖动拼图块对齐缺口';
 }catch(e){ $('m').textContent='出错: '+e.message; }
 tb.disabled=rb.disabled=false;
}
function toPage(ev){ // touch/mouse point on the image -> page coords on the browserbase viewport
 const im=wrap.querySelector('img'); const r=im.getBoundingClientRect();
 const cx=(ev.touches?ev.touches[0].clientX:ev.clientX)-r.left;
 const cy=(ev.touches?ev.touches[0].clientY:ev.clientY)-r.top;
 return {ix:cx,iy:cy, x: clip.x + (cx/r.width)*clip.w, y: clip.y + (cy/r.height)*clip.h};
}
function draw(){ const ctx=cv.getContext('2d'); ctx.clearRect(0,0,cv.width,cv.height); ctx.strokeStyle='#12b7f5'; ctx.lineWidth=2; ctx.beginPath(); pts.forEach((p,i)=>{ i?ctx.lineTo(p.ix,p.iy):ctx.moveTo(p.ix,p.iy);}); ctx.stroke(); }
function start(ev){ if(!drawn)return; ev.preventDefault(); dragging=true; pts=[]; t0=performance.now(); const p=toPage(ev); p.t=0; pts.push(p); draw(); }
function move(ev){ if(!dragging)return; ev.preventDefault(); const p=toPage(ev); p.t=performance.now()-t0; pts.push(p); draw(); }
async function end(ev){ if(!dragging)return; dragging=false; ev.preventDefault();
 if(pts.length<3){ $('m').textContent='拖动太短，重试'; return; }
 $('m').textContent='重放中…';
 try{ const rs=await fetch('drag',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({points:pts.map(p=>({x:p.x,y:p.y,t:p.t}))})});
   const j=await rs.json();
   if(j.codeInput){ $('m').textContent='✅ 通过！QQ 已给你手机发验证码，去聊天里发给我'; }
   else if(j.capGone){ $('m').textContent='✅ 验证通过'; }
   else { $('m').textContent='❌ 没过，点“刷新图片”再拖一次'; }
 }catch(e){ $('m').textContent='重放出错: '+e.message; }
}
$('t').addEventListener('click',()=>trigger(false));
$('r').addEventListener('click',()=>trigger(true));
wrap.addEventListener('touchstart',start,{passive:false});
wrap.addEventListener('touchmove',move,{passive:false});
wrap.addEventListener('touchend',end,{passive:false});
wrap.addEventListener('mousedown',start); wrap.addEventListener('mousemove',move); wrap.addEventListener('mouseup',end);
window.addEventListener('resize',sizeCanvas);
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && (u.pathname === "/" || u.pathname === "")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); return res.end(PAGE);
    }
    if (u.pathname === "/health") { res.writeHead(200); return res.end("ok"); }
    if (req.method === "POST" && (u.pathname === "/trigger" || u.pathname === "/snap")) {
      if (u.pathname === "/trigger") await triggerCaptcha();
      const s = await snap();
      if (!s) { res.writeHead(503); return res.end("no captcha"); }
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store",
        "X-Clip-X": String(s.clip.x), "X-Clip-Y": String(s.clip.y), "X-Clip-W": String(s.clip.width), "X-Clip-H": String(s.clip.height) });
      return res.end(s.png);
    }
    if (req.method === "POST" && u.pathname === "/drag") {
      const body = JSON.parse(await readBody(req) || "{}");
      const r = await dragReplay(body.points);
      res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(r));
    }
    if (req.method === "GET" && u.pathname === "/url") {
      const p = await ensure(); res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ url: p.url(), title: await p.title().catch(() => "") }));
    }
    res.writeHead(404); res.end("not found");
  } catch (e) { res.writeHead(500, { "Content-Type": "text/plain" }); res.end("err: " + e.message + "\n" + (e.stack || "")); }
});
server.listen(PORT, "127.0.0.1", () => console.log("captcha-relay on 127.0.0.1:" + PORT + " session " + SESSION_PATH));
