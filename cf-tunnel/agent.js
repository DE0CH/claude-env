#!/usr/bin/env node
/**
 * Container-side tunnel agent (see tunnel.md).
 *
 * Opens an outbound WebSocket to the Cloudflare Worker (worker.js) and
 * proxies forwarded HTTP requests to the local content server.
 *
 * The container is ephemeral: everything not in the git repo must come from
 * the environment. So the credentials are read from environment variables
 * (set once in the CCR environment config, like LOBSTER_TOKEN etc.), NOT a
 * file on disk.
 *
 * Env:
 *   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET
 *                       Access service token (REQUIRED). Minted by deploy.sh;
 *                       add both to the environment's variables.
 *   TUNNEL_WORKER_URL   default wss://tunnel.deyaochen.com/__agent
 *   TUNNEL_TARGET       local origin to proxy to (default http://127.0.0.1:8899)
 *   TUNNEL_AGENT_SECRET optional; only needed if the Worker was deployed with
 *                       an AGENT_SECRET (defense-in-depth; off by default).
 *
 * Requires the `ws` package (npm install -g ws; setup.sh does this).
 */

const { execSync } = require("node:child_process");
try {
  module.paths.push(execSync("npm root -g").toString().trim());
} catch {}
const WebSocket = require("ws");

const WORKER_URL = process.env.TUNNEL_WORKER_URL || "wss://tunnel.deyaochen.com/__agent";
const TARGET = process.env.TUNNEL_TARGET || "http://127.0.0.1:8899";
const AGENT_SECRET = process.env.TUNNEL_AGENT_SECRET; // optional
const ACCESS_ID = process.env.CF_ACCESS_CLIENT_ID;
const ACCESS_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;
if (!ACCESS_ID || !ACCESS_SECRET) {
  console.error(
    "CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required " +
    "(set them in the environment; mint with cf-tunnel/deploy.sh).",
  );
  process.exit(1);
}

const MAX_BODY = 25 * 1024 * 1024;
let backoff = 1000;
let replaced = 0;

function connect() {
  const headers = {
    "CF-Access-Client-Id": ACCESS_ID,
    "CF-Access-Client-Secret": ACCESS_SECRET,
  };
  if (AGENT_SECRET) headers["x-agent-secret"] = AGENT_SECRET;
  const ws = new WebSocket(WORKER_URL, { headers });
  let pingTimer, stableTimer;

  ws.on("open", () => {
    // only treat the connection as healthy after it survives a while —
    // during an agent-vs-agent ping-pong (see tunnel.md) each side reconnects
    // instantly, and resetting backoff here would keep the fight at 1s forever
    stableTimer = setTimeout(() => { backoff = 1000; replaced = 0; }, 60_000);
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
    clearTimeout(stableTimer);
    if (why.includes("replaced") && ++replaced === 3) {
      console.error(
        "[agent] replaced 3x — another agent is fighting for the tunnel " +
        "(likely a previous session's container still alive; archive that " +
        "session — see the stale-agent gotcha in tunnel.md)",
      );
    }
    console.error(`[agent] ${why}; reconnecting in ${backoff}ms`);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };
  ws.on("close", (code, reason) => retry(`closed (${code} ${reason})`));
  ws.on("error", (e) => { ws.terminate(); retry(`error (${e.message})`); });
}

connect();
