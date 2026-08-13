/**
 * Cloudflare Worker tunnel edge (see tunnel.md).
 *
 * A container-side agent (agent.js) opens an outbound WebSocket to
 * /__agent; every HTTP request hitting this Worker is forwarded over that
 * socket to the agent, which proxies it to the local content server and
 * sends the response back.
 *
 * Auth layers:
 *  - Cloudflare Access in front of the workers.dev hostname (browser users
 *    log in; the agent presents an Access service token).
 *  - AGENT_SECRET (Worker secret) required on /__agent as belt-and-braces.
 *
 * Deploy: cd cf-tunnel && npx wrangler deploy
 * Secret: npx wrangler secret put AGENT_SECRET
 */

export default {
  async fetch(request, env) {
    const id = env.TUNNEL.idFromName("singleton");
    return env.TUNNEL.get(id).fetch(request);
  },
};

const MAX_BODY = 25 * 1024 * 1024; // bytes, request and response alike
const AGENT_TIMEOUT_MS = 60_000;

export class Tunnel {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.pending = new Map(); // reqId -> {resolve, timer}
    this.nextId = 1;
  }

  agentSocket() {
    const sockets = this.state.getWebSockets("agent");
    return sockets.length ? sockets[sockets.length - 1] : null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/__agent") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      // Cloudflare Access already gates this hostname (the agent presents an
      // Access service token). AGENT_SECRET is optional defense-in-depth:
      // enforced only if it is configured on the Worker.
      if (this.env.AGENT_SECRET &&
          request.headers.get("x-agent-secret") !== this.env.AGENT_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const pair = new WebSocketPair();
      // close any previous agent so a reconnect takes over cleanly
      for (const s of this.state.getWebSockets("agent")) {
        try { s.close(1012, "replaced"); } catch {}
      }
      this.state.acceptWebSocket(pair[1], ["agent"]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname === "/__status") {
      return Response.json({ agent: !!this.agentSocket() });
    }

    const agent = this.agentSocket();
    if (!agent) {
      return new Response(
        "tunnel agent is not connected (container offline or agent not running)",
        { status: 503 },
      );
    }

    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY) {
      return new Response("request too large", { status: 413 });
    }

    const reqId = String(this.nextId++);
    const headers = {};
    for (const [k, v] of request.headers) {
      // Access JWTs / CF plumbing are meaningless to the local server
      if (k.startsWith("cf-") || k === "host") continue;
      headers[k] = v;
    }

    const message = JSON.stringify({
      type: "req",
      id: reqId,
      method: request.method,
      path: url.pathname + url.search,
      headers,
      body_b64: body.byteLength ? b64encode(body) : "",
    });

    const response = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        resolve(new Response("tunnel agent timed out", { status: 504 }));
      }, AGENT_TIMEOUT_MS);
      this.pending.set(reqId, { resolve, timer });
      try {
        agent.send(message);
      } catch {
        clearTimeout(timer);
        this.pending.delete(reqId);
        resolve(new Response("tunnel agent send failed", { status: 502 }));
      }
    });
    return response;
  }

  webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (msg.type === "ping") {
      try { ws.send(JSON.stringify({ type: "pong" })); } catch {}
      return;
    }
    if (msg.type !== "res") return;
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(msg.id);
    const headers = new Headers();
    for (const [k, v] of Object.entries(msg.headers || {})) {
      if (["content-length", "transfer-encoding", "connection"].includes(k.toLowerCase())) continue;
      try { headers.set(k, v); } catch {}
    }
    const body = msg.body_b64 ? b64decode(msg.body_b64) : null;
    entry.resolve(new Response(body, { status: msg.status || 502, headers }));
  }

  webSocketClose() {
    this.failAllPending("tunnel agent disconnected");
  }

  webSocketError() {
    this.failAllPending("tunnel agent socket error");
  }

  failAllPending(reason) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve(new Response(reason, { status: 502 }));
    }
    this.pending.clear();
  }
}

function b64encode(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function b64decode(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
