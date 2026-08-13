#!/usr/bin/env node
/**
 * Container-side tunnel agent (see ngrok.md).
 *
 * Opens an outbound WebSocket to the Cloudflare Worker (worker.js) and
 * proxies forwarded HTTP requests to the local content server.
 *
 * Env:
 *   TUNNEL_WORKER_URL   wss://<name>.<subdomain>.workers.dev/__agent (required)
 *   TUNNEL_AGENT_SECRET shared secret, must match the Worker's AGENT_SECRET (required)
 *   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET
 *                       Access service token (required once Access is enabled)
 *   TUNNEL_TARGET       local origin to proxy to (default http://127.0.0.1:8899)
 *
 * Requires the `ws` package (npm install -g ws; setup.sh does this).
 */

const { execSync } = require("node:child_process");
try {
  module.paths.push(execSync("npm root -g").toString().trim());
} catch {}
const WebSocket = require("ws");

const WORKER_URL = process.env.TUNNEL_WORKER_URL;
const AGENT_SECRET = process.env.TUNNEL_AGENT_SECRET;
const TARGET = process.env.TUNNEL_TARGET || "http://127.0.0.1:8899";
if (!WORKER_URL || !AGENT_SECRET) {
  console.error("TUNNEL_WORKER_URL and TUNNEL_AGENT_SECRET are required");
  process.exit(1);
}

const MAX_BODY = 25 * 1024 * 1024;
let backoff = 1000;

function connect() {
  const headers = { "x-agent-secret": AGENT_SECRET };
  if (process.env.CF_ACCESS_CLIENT_ID) {
    headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
  }
  const ws = new WebSocket(WORKER_URL, { headers });
  let pingTimer;

  ws.on("open", () => {
    backoff = 1000;
    console.log(`[agent] connected to ${WORKER_URL}, proxying to ${TARGET}`);
    // keep the socket warm through idle periods
    pingTimer = setInterval(() => {
      try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
    }, 30_000);
  });

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type !== "req") return;
    let status = 502, respHeaders = {}, bodyBuf = Buffer.alloc(0);
    try {
      const resp = await fetch(TARGET + msg.path, {
        method: msg.method,
        headers: msg.headers,
        body: ["GET", "HEAD"].includes(msg.method)
          ? undefined
          : msg.body_b64
            ? Buffer.from(msg.body_b64, "base64")
            : undefined,
        redirect: "manual",
      });
      status = resp.status;
      resp.headers.forEach((v, k) => { respHeaders[k] = v; });
      const ab = await resp.arrayBuffer();
      bodyBuf = Buffer.from(ab.slice(0, MAX_BODY));
    } catch (e) {
      status = 502;
      respHeaders = { "content-type": "text/plain" };
      bodyBuf = Buffer.from(`agent: local fetch failed: ${e.message}`);
    }
    try {
      ws.send(JSON.stringify({
        type: "res",
        id: msg.id,
        status,
        headers: respHeaders,
        body_b64: bodyBuf.length ? bodyBuf.toString("base64") : "",
      }));
    } catch (e) {
      console.error("[agent] send failed:", e.message);
    }
  });

  let retried = false;
  const retry = (why) => {
    if (retried) return;
    retried = true;
    clearInterval(pingTimer);
    console.error(`[agent] ${why}; reconnecting in ${backoff}ms`);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };
  ws.on("close", (code, reason) => retry(`closed (${code} ${reason})`));
  ws.on("error", (e) => { ws.terminate(); retry(`error (${e.message})`); });
}

connect();
