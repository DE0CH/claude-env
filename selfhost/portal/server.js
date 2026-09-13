// Claude self-host portal — the dashboard + API, running as a Deployment in the controller
// cluster. State lives in the cluster (Secrets/ConfigMap) with write-through to git (sops);
// sessions are Fly Machines that each run `claude --remote-control` (visible in the Claude app).
const path = require("path");
const express = require("express");
const store = require("./lib/store");
const fly = require("./lib/fly");
const tty = require("./lib/tty");
const auth = require("./lib/auth");
const imagebuild = require("./lib/imagebuild");

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || "127.0.0.1";
const ALLOWED_EMAIL = process.env.PORTAL_ALLOWED_EMAIL || "chendeyao000@gmail.com";
const VERSION = process.env.PORTAL_VERSION || require("./package.json").version;

const app = express();
app.use(express.json({ limit: "2mb" }));

// Defense in depth: if the tunnel/Access forwards the identity header, enforce it.
app.use((req, res, next) => {
  const email = req.get("Cf-Access-Authenticated-User-Email");
  if (email && ALLOWED_EMAIL && email.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
});
app.get("/api/health", (req, res) => res.json({ ok: true, version: VERSION }));

// ---- helpers --------------------------------------------------------------
function slug(s) {
  return (s || "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "session";
}
function rand(n = 5) { return Math.random().toString(36).slice(2, 2 + n); }

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
    const [cfg, creds] = await Promise.all([store.get(), store.getClaudeCredentials()]);
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
          permissionMode: m.config?.metadata?.permissionMode || "",
        }));
        // stable order: newest first, id as tie-break (Fly's list order is not deterministic)
        sessions.sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")) || a.id.localeCompare(b.id));
        // enrich running machines with the live name/status from inside
        await Promise.all(sessions.map(async (s) => {
          if (s.state !== "started") return;
          const reg = await readRegistry(s.id);
          if (reg) Object.assign(s, reg);
        }));
      } catch (e) { flyError = e.message; }
    } else { flyError = "FLY_API_TOKEN not set"; }
    let credsInfo = null;
    try { const c = JSON.parse(creds.credentials || "{}").claudeAiOauth || {}; credsInfo = { expiresAt: c.expiresAt || null, subscriptionType: c.subscriptionType || "", scopes: c.scopes || [] }; } catch {}
    const build = imagebuild.status();
    res.json({
      version: VERSION,
      environments,
      repos: cfg.repos || [],
      sessions,
      sessionImage: cfg.sessionImage || null,
      imageBuild: { running: build.running, ok: build.ok, image: build.image, startedAt: build.startedAt },
      flyApp: process.env.FLY_APP || "de0ch-claude-sessions",
      flyError,
      hasCreds: !!creds.credentials,
      creds: credsInfo,
      auth: auth.status(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- environments ---------------------------------------------------------
app.post("/api/environments", async (req, res) => {
  try {
    const { name, secrets } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    // merge: empty-string value deletes the key; otherwise set
    await store.setEnvironment(name, secrets && typeof secrets === "object" ? secrets : {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/environments/:name", async (req, res) => {
  try { await store.deleteEnvironment(req.params.name); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// Secret VALUES are never sent to the browser: the dashboard only sees key names
// (in /api/state) and writes updates/deletions through POST /api/environments.

// ---- repos ----------------------------------------------------------------
app.post("/api/repos", async (req, res) => {
  try {
    const { name, url } = req.body || {};
    if (!url) return res.status(400).json({ error: "url required" });
    const nm = name || path.basename(url).replace(/\.git$/, "");
    const repos = ((await store.get()).repos || []).filter((r) => r.url !== url);
    repos.push({ name: nm, url });
    await store.setRepos(repos);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/repos/:name", async (req, res) => {
  try {
    const repos = ((await store.get()).repos || []).filter((r) => r.name !== req.params.name);
    await store.setRepos(repos);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- session image (built on Fly's remote builder from the repo checkout) -----
app.post("/api/image/rebuild", async (req, res) => {
  try { res.json(await imagebuild.start(store)); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/image/build", (req, res) => res.json(imagebuild.status()));

// ---- Claude auth (re-login through the real CLI) ----------------------------
app.post("/api/auth/start", async (req, res) => {
  try { auth.seedHome(await store.getClaudeCredentials()); res.json(await auth.start()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/auth/code", async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "code required" });
    res.json(await auth.submit(code, (creds, account) => store.setClaudeCredentials(creds, account)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/auth/status", (req, res) => res.json(auth.status()));

// ---- sessions -------------------------------------------------------------
app.post("/api/sessions", async (req, res) => {
  try {
    if (!process.env.FLY_API_TOKEN) return res.status(400).json({ error: "FLY_API_TOKEN not set on the portal" });
    const cfg = await store.get();
    if (!cfg.sessionImage) return res.status(400).json({ error: "no session image yet — rebuild it from Settings" });
    const creds = await store.getClaudeCredentials();
    if (!creds.credentials) return res.status(400).json({ error: "no Claude credentials — re-login from Settings" });
    const { environment, repos = [], label, guest, permissionMode } = req.body || {};
    const env = cfg.environments[environment];
    if (environment && !env) return res.status(400).json({ error: `unknown environment '${environment}'` });

    const repoUrls = (repos || [])
      .map((n) => (cfg.repos || []).find((r) => r.name === n || r.url === n))
      .filter(Boolean).map((r) => r.url);

    // Permission mode for the remote-control host: "auto" (the default auto-approve
    // permission mode with the classifier) or "bypass" (--dangerously-skip-permissions).
    const permMode = permissionMode === "bypass" ? "bypass" : "auto";

    // Session title. If the user typed one, pin it everywhere: dashboard card, Fly machine,
    // AND the Remote Control session name in the Claude app (`claude --remote-control <name>`).
    // If left blank, leave SESSION_LABEL empty so the Claude session auto-generates its own
    // title (the dashboard then mirrors that live name once it comes up).
    const base = repoUrls.length
      ? path.basename(repoUrls[0]).replace(/\.git$/, "")
      : (environment || "session");
    const userLabel = String(label || "").replace(/["\\\r\n\t]/g, "").trim().slice(0, 60);

    const machineEnv = {
      CLAUDE_CREDENTIALS: creds.credentials,
      CLAUDE_ACCOUNT: creds.account || "{}",
      SESSION_SECRETS_JSON: JSON.stringify(env ? env.secrets || {} : {}),
      SESSION_REPOS: repoUrls.join(","),
      SESSION_LABEL: userLabel, // blank => the Claude session names itself
      SESSION_PERMISSION_MODE: permMode,
    };
    const name = `s-${slug(userLabel || base)}-${rand()}`;
    const machine = await fly.createMachine({
      name,
      image: cfg.sessionImage,
      env: machineEnv,
      guest: guest || undefined,
      metadata: {
        role: "claude-session",
        environment: environment || "",
        repos: repoUrls.join(" "),
        label: userLabel,
        permissionMode: permMode,
      },
    });
    res.json({ ok: true, id: machine.id, name, label: userLabel, state: machine.state });
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
// live terminal (tmux mirror) — see lib/tty.js. The dashboard polls /frame (SSE doesn't
// survive the cf-tunnel's WS relay); the SSE stream stays for direct/in-cluster clients.
app.get("/api/sessions/:id/tty", (req, res) => { tty.stream(req.params.id, res); });
app.get("/api/sessions/:id/tty/frame", async (req, res) => {
  try { res.json(await tty.snapshot(req.params.id)); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/sessions/:id/tty/input", async (req, res) => {
  try { await tty.input(req.params.id, req.body || {}); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/sessions/:id/tty/resize", async (req, res) => {
  try { const { cols, rows } = req.body || {}; res.json(await tty.resize(req.params.id, cols, rows)); }
  catch (e) { res.status(500).json({ error: e.message }); }
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

app.listen(PORT, HOST, () => {
  console.log(`[portal] v${VERSION} listening on ${HOST}:${PORT}`);
  store.get().then((c) => console.log(`[portal] cluster ok: ${Object.keys(c.environments).length} environment(s), ${(c.repos || []).length} repo(s), image ${c.sessionImage || "none"}`))
    .catch((e) => console.error("[portal] cluster read failed (will retry on requests):", e.message));
});
