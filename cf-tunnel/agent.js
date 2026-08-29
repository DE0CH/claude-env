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
 * Requires the `ws` package (npm install -g ws).
 */

const { execSync } = require("node:child_process");
try {
  module.paths.push(execSync("npm root -g").toString().trim());
} catch {}
const WebSocket = require("ws");

// Per-session tunnel id: each session tunnels under its own id so multiple
// sessions/containers don't clash over one slot (see tunnel.md). Defaults to
// the CCR session id; override with TUNNEL_ID. Empty id => legacy shared tunnel.
const TUNNEL_HOST = process.env.TUNNEL_HOST || "tunnel.deyaochen.com";
const TUNNEL_ID = (
  process.env.TUNNEL_ID ||
  process.env.CLAUDE_CODE_SESSION_ID ||
  process.env.CLAUDE_CODE_CONTAINER_ID ||
  ""
).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
if (!TUNNEL_ID && !process.env.TUNNEL_WORKER_URL) {
  console.error(
    "no tunnel id: set TUNNEL_ID (CLAUDE_CODE_SESSION_ID is used by default).",
  );
  process.exit(1);
}
const WORKER_URL = process.env.TUNNEL_WORKER_URL ||
  `wss://${TUNNEL_HOST}/__agent/${TUNNEL_ID}`;
const PUBLIC_URL = `https://${TUNNEL_HOST}/t/${TUNNEL_ID}/`;
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

// Streaming protocol: response bodies are sent as res-start / res-chunk* /
// res-end messages so a body is never one giant WS message (Cloudflare caps
// WS messages at ~1MB, which the old single-message protocol hit on any file
// bigger than ~700KB). CHUNK*4/3 must stay well under that cap.
const CHUNK = 512 * 1024;
const WS_BUFFER_MAX = 8 * 1024 * 1024;
let backoff = 1000;

function connect() {
  const headers = {
    "CF-Access-Client-Id": ACCESS_ID,
    "CF-Access-Client-Secret": ACCESS_SECRET,
  };
  if (AGENT_SECRET) headers["x-agent-secret"] = AGENT_SECRET;
  const ws = new WebSocket(WORKER_URL, { headers });
  let pingTimer;

  ws.on("open", () => {
    backoff = 1000;
    console.log(`[agent] connected to ${WORKER_URL}, proxying to ${TARGET}`);
    console.log(`[agent] public URL: ${PUBLIC_URL}`);
    // keep the socket warm through idle periods
    pingTimer = setInterval(() => {
      try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
    }, 30_000);
  });

  const cancelled = new Set(); // req ids the worker told us to stop streaming

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "res-cancel") { cancelled.add(msg.id); return; }
    if (msg.type !== "req") return;
    const send = (obj) => ws.send(JSON.stringify(obj));
    let started = false;
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
      const respHeaders = {};
      resp.headers.forEach((v, k) => { respHeaders[k] = v; });
      send({ type: "res-start", id: msg.id, status: resp.status, headers: respHeaders });
      started = true;
      if (resp.body && msg.method !== "HEAD") {
        const reader = resp.body.getReader();
        let pending = Buffer.alloc(0);
        const sendChunks = async (final) => {
          while (pending.length >= CHUNK || (final && pending.length)) {
            if (cancelled.has(msg.id)) return false;
            const piece = pending.subarray(0, CHUNK);
            pending = pending.subarray(piece.length);
            send({ type: "res-chunk", id: msg.id, data_b64: piece.toString("base64") });
            while (ws.bufferedAmount > WS_BUFFER_MAX) {
              await new Promise((r) => setTimeout(r, 50));
            }
          }
          return true;
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending = pending.length ? Buffer.concat([pending, Buffer.from(value)]) : Buffer.from(value);
          if (!(await sendChunks(false))) { await reader.cancel().catch(() => {}); break; }
        }
        await sendChunks(true);
      }
    } catch (e) {
      if (!started) {
        try {
          send({ type: "res-start", id: msg.id, status: 502, headers: { "content-type": "text/plain" } });
          send({ type: "res-chunk", id: msg.id, data_b64: Buffer.from(`agent: local fetch failed: ${e.message}`).toString("base64") });
        } catch {}
      } else {
        console.error("[agent] stream failed:", e.message);
      }
    }
    cancelled.delete(msg.id);
    try { send({ type: "res-end", id: msg.id }); } catch (e) {
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
