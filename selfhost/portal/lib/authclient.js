// Portal-side client for the auth broker (auth-broker.js — the separate Deployment that holds
// the Re-login PTY so portal rollouts can't lose it). AUTH_BROKER_URL is set in the portal
// Deployment; status() never throws (the dashboard shows "unavailable" instead).
const BASE = (process.env.AUTH_BROKER_URL || "http://auth-broker:80").replace(/\/$/, "");

async function call(method, p, body, timeoutMs = 150000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(BASE + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
    const txt = await r.text();
    let j = {}; try { j = JSON.parse(txt); } catch { j = { error: txt.slice(0, 300) }; }
    if (!r.ok) throw new Error(j.error || `auth broker: HTTP ${r.status}`);
    return j;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("auth broker timed out");
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(String(e.message || e.cause))) throw new Error(`auth broker unreachable at ${BASE} (${e.cause?.code || e.message})`);
    throw e;
  } finally { clearTimeout(t); }
}

module.exports = {
  start: (pair) => call("POST", "/start", pair, 45000),
  submit: (code) => call("POST", "/code", { code }, 150000),
  status: async () => { try { return await call("GET", "/status", null, 3000); } catch (e) { return { inProgress: false, unavailable: true, error: e.message }; } },
};
