// Claude self-host portal — the controller's dashboard + API.
// Manages Environments (named secret sets) and Repos, and starts/stops per-session
// Fly Machines that each run `claude --remote-control` (visible in the Claude app).
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const store = require("./lib/store");
const fly = require("./lib/fly");

const PORT = process.env.PORT || 8080;
const ALLOWED_EMAIL = process.env.PORTAL_ALLOWED_EMAIL || "chendeyao000@gmail.com";
const HOME = os.homedir();

const app = express();
app.use(express.json({ limit: "1mb" }));

// Defense in depth: if the tunnel/Access forwards the identity header, enforce it.
app.use((req, res, next) => {
  const email = req.get("Cf-Access-Authenticated-User-Email");
  if (email && ALLOWED_EMAIL && email.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
});

// ---- helpers --------------------------------------------------------------
function claudeCreds() {
  try { return fs.readFileSync(path.join(HOME, ".claude/.credentials.json"), "utf8"); }
  catch { return ""; }
}
function claudeAccount() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(HOME, ".claude.json"), "utf8"));
    const out = {};
    for (const k of ["oauthAccount", "userID"]) if (d[k] !== undefined) out[k] = d[k];
    return JSON.stringify(out);
  } catch { return "{}"; }
}
function slug(s) {
  return (s || "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "session";
}
function rand(n = 5) { return Math.random().toString(36).slice(2, 2 + n); }
function maskEnv(env) {
  // return key names + a masked preview only
  const out = {};
  for (const k of Object.keys(env || {})) out[k] = "••••••";
  return out;
}

// ---- live session registry (inside each machine) ---------------------------
// claude keeps ~/.claude/sessions/<pid>.json with the live display name and
// busy/idle status. Read it via Fly exec so the dashboard reflects the current
// name/state on refresh. Cached briefly; failures just fall back to metadata.
const regCache = new Map();
async function readRegistry(machineId) {
  const c = regCache.get(machineId);
  if (c && Date.now() - c.at < 8000) return c.data;
  let data = null;
  try {
    const r = await Promise.race([
      fly.exec(machineId, ["bash", "-lc", "cat /home/claude/.claude/sessions/*.json 2>/dev/null"], 10),
      new Promise((_, rej) => setTimeout(() => rej(new Error("exec timeout")), 12000)),
    ]);
    const entries = String(r.stdout || "").split("\n")
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    const host = entries.find((e) => e.bridgeSessionId) || entries[0] || null;
    if (host) {
      data = {
        liveName: host.name || "",
        nameSource: host.nameSource || "",
        status: host.status || "",
        bridgeSessionId: host.bridgeSessionId || "",
        sessionsInside: entries.length,
      };
    }
  } catch (e) { data = null; }
  regCache.set(machineId, { at: Date.now(), data });
  return data;
}

// ---- state ----------------------------------------------------------------
app.get("/api/state", async (req, res) => {
  try {
    const cfg = await store.get();
    const environments = {};
    for (const [name, e] of Object.entries(cfg.environments)) {
      environments[name] = { keys: Object.keys(e.secrets || {}) };
    }
    let sessions = [];
    let flyError = null;
    if (process.env.FLY_API_TOKEN) {
      try {
        const machines = await fly.listMachines();
        sessions = machines.map((m) => ({
          id: m.id,
          name: m.name,
          state: m.state,
          region: m.region,
          created: m.created_at,
          environment: m.config?.metadata?.environment || "",
          repos: m.config?.metadata?.repos || "",
          label: m.config?.metadata?.label || "",
        }));
        // enrich running machines with the live name/status from inside
        await Promise.all(sessions.map(async (s) => {
          if (s.state !== "started") return;
          const reg = await readRegistry(s.id);
          if (reg) Object.assign(s, reg);
        }));
      } catch (e) { flyError = e.message; }
    } else { flyError = "FLY_API_TOKEN not set"; }
    res.json({
      environments,
      repos: cfg.repos || [],
      sessions,
      sessionImage: cfg.sessionImage || null,
      flyApp: process.env.FLY_APP || "de0ch-claude-sessions",
      flyError,
      hasCreds: !!claudeCreds(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- environments ---------------------------------------------------------
app.post("/api/environments", async (req, res) => {
  try {
    const { name, secrets } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    await store.mutate((c) => {
      c.environments[name] = c.environments[name] || { secrets: {} };
      if (secrets && typeof secrets === "object") {
        // merge: empty-string value deletes the key; otherwise set
        for (const [k, v] of Object.entries(secrets)) {
          if (v === "") delete c.environments[name].secrets[k];
          else c.environments[name].secrets[k] = String(v);
        }
      }
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/environments/:name", async (req, res) => {
  try { await store.mutate((c) => { delete c.environments[req.params.name]; }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// reveal one environment's full secrets (values) — used by the editor on demand
app.get("/api/environments/:name/secrets", async (req, res) => {
  try {
    const c = await store.get();
    const e = c.environments[req.params.name];
    if (!e) return res.status(404).json({ error: "not found" });
    res.json({ secrets: e.secrets || {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- repos ----------------------------------------------------------------
app.post("/api/repos", async (req, res) => {
  try {
    const { name, url } = req.body || {};
    if (!url) return res.status(400).json({ error: "url required" });
    const nm = name || path.basename(url).replace(/\.git$/, "");
    await store.mutate((c) => {
      c.repos = (c.repos || []).filter((r) => r.url !== url);
      c.repos.push({ name: nm, url });
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/repos/:name", async (req, res) => {
  try { await store.mutate((c) => { c.repos = (c.repos || []).filter((r) => r.name !== req.params.name); }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- session image ref (set by deploy-session-image.sh) -------------------
app.post("/api/image", async (req, res) => {
  try { const { image } = req.body || {}; await store.mutate((c) => { c.sessionImage = image; }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- sessions -------------------------------------------------------------
app.post("/api/sessions", async (req, res) => {
  try {
    if (!process.env.FLY_API_TOKEN) return res.status(400).json({ error: "FLY_API_TOKEN not set on controller" });
    const cfg = await store.get();
    if (!cfg.sessionImage) return res.status(400).json({ error: "no session image deployed yet (run deploy-session-image.sh)" });
    const { environment, repos = [], label, guest } = req.body || {};
    const env = cfg.environments[environment];
    if (environment && !env) return res.status(400).json({ error: `unknown environment '${environment}'` });

    const secretsEnv = env ? Object.entries(env.secrets || {}).map(([k, v]) => `${k}=${v}`).join("\n") : "";
    const repoUrls = (repos || [])
      .map((n) => (cfg.repos || []).find((r) => r.name === n || r.url === n))
      .filter(Boolean).map((r) => r.url);

    // One friendly name used everywhere: dashboard card, Fly machine, AND the Remote
    // Control session name in the Claude app (passed as `claude --remote-control <name>`).
    const base = repoUrls.length
      ? path.basename(repoUrls[0]).replace(/\.git$/, "")
      : (environment || "session");
    const friendly = String(label || `${base}-${rand(4)}`)
      .replace(/["\\\r\n\t]/g, "").trim().slice(0, 60) || `session-${rand(4)}`;

    const machineEnv = {
      CLAUDE_CREDENTIALS: claudeCreds(),
      CLAUDE_ACCOUNT: claudeAccount(),
      SESSION_SECRETS_ENV: secretsEnv,
      SESSION_REPOS: repoUrls.join(","),
      SESSION_LABEL: friendly,
    };
    const name = `s-${slug(friendly)}-${rand()}`;
    const machine = await fly.createMachine({
      name,
      image: cfg.sessionImage,
      env: machineEnv,
      guest: guest || undefined,
      metadata: {
        role: "claude-session",
        environment: environment || "",
        repos: repoUrls.join(" "),
        label: friendly,
      },
    });
    res.json({ ok: true, id: machine.id, name, label: friendly, state: machine.state });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Pre-destroy check: uncommitted / unpushed work in each repo inside the session.
app.get("/api/sessions/:id/changes", async (req, res) => {
  try {
    const id = req.params.id;
    const m = await fly.getMachine(id);
    if (m.state !== "started") return res.json({ checked: false, reason: `session is ${m.state}`, repos: [] });
    const script = 'cd ~/workspace 2>/dev/null || exit 0; for d in */; do d=${d%/}; [ -d "$d/.git" ] || continue; '
      + 'u=$(git -C "$d" status --porcelain 2>/dev/null | wc -l); '
      + 'if git -C "$d" rev-parse --abbrev-ref @{u} >/dev/null 2>&1; then p=$(git -C "$d" rev-list @{u}..HEAD --count 2>/dev/null || echo 0); else p=-1; fi; '
      + 'echo "$d $u $p"; done';
    const r = await fly.exec(id, ["/usr/bin/sudo", "-u", "claude", "-H", "/bin/bash", "-lc", script], 20);
    const repos = String(r.stdout || "").split("\n").filter((l) => l.trim()).map((l) => {
      const [name, u, p] = l.trim().split(/\s+/);
      return { name, uncommitted: parseInt(u, 10) || 0, unpushed: parseInt(p, 10) };
    });
    const reg = await readRegistry(id);
    res.json({ checked: true, repos, status: (reg && reg.status) || "" });
  } catch (e) { res.json({ checked: false, reason: e.message, repos: [] }); }
});

// Rename a session everywhere: drive `/rename` inside the running claude (so the
// Claude app shows it) and keep the Fly metadata label in sync (shown when stopped).
app.post("/api/sessions/:id/rename", async (req, res) => {
  try {
    const name = String((req.body || {}).name || "").replace(/["'\\\r\n\t]/g, "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: "name required" });
    const id = req.params.id;
    let inside = "skipped";
    try {
      const m = await fly.getMachine(id);
      if (m.state === "started") {
        const r = await fly.exec(id, ["/usr/bin/sudo", "-u", "claude", "-H", "/bin/bash", "-lc",
          `tmux send-keys -t claude '/rename ${name}' Enter`], 15);
        inside = r.exit_code === 0 ? "ok" : `exit ${r.exit_code}`;
      }
    } catch (e) { inside = e.message; }
    await fly.setMetadata(id, "label", name);
    regCache.delete(id);
    res.json({ ok: true, name, inside });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/sessions/:id/stop", async (req, res) => {
  try { res.json(await fly.stopMachine(req.params.id)); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/sessions/:id/start", async (req, res) => {
  try { res.json(await fly.startMachine(req.params.id)); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/sessions/:id", async (req, res) => {
  try { res.json(await fly.destroyMachine(req.params.id)); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, "public")));

store.load()
  .then(() => app.listen(PORT, "127.0.0.1", () => console.log(`[portal] listening on 127.0.0.1:${PORT}`)))
  .catch((e) => { console.error("[portal] failed to load config from S3:", e.message); process.exit(1); });
