// Claude self-host portal — the dashboard + API, running as a Deployment in the controller
// cluster. State lives in the cluster (Secrets/ConfigMap) with write-through to git (sops);
// sessions are Fly Machines that each run `claude --remote-control` (visible in the Claude app).
const path = require("path");
const express = require("express");
const store = require("./lib/store");
const fly = require("./lib/fly");
const tty = require("./lib/tty");
const authclient = require("./lib/authclient"); // Re-login runs in the auth broker (auth-broker.js)
const archive = require("./lib/archive");
const github = require("./lib/github");
const oauth = require("./lib/oauth");
const hetzner = require("./lib/hetzner");
const redroid = require("./lib/redroid");

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || "127.0.0.1";
const ALLOWED_EMAIL = process.env.PORTAL_ALLOWED_EMAIL || "chendeyao000@gmail.com";
const VERSION = process.env.PORTAL_VERSION || require("./package.json").version;
const PUBLIC_URL = (process.env.PORTAL_PUBLIC_URL || "https://tunnel.deyaochen.com/t/portal").replace(/\/$/, "");

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

// ---- Claude credentials: keep the stored OAuth pair usable ------------------------
// Sessions get a COPY of the stored ~/.claude/.credentials.json. Claude rotates the refresh
// token whenever it refreshes, which invalidates the stored one — so (1) sessions push their
// refreshed copy back (POST /api/credentials, newest expiresAt wins), and (2) before a session
// is created the portal refreshes the stored pair itself if the access token is expired or
// about to be. If that refresh is rejected, the only way out is a Re-login (Settings).
const FRESH_MARGIN_MS = 30 * 60 * 1000;   // refresh when less than this is left
const REFRESH_RETRY_MS = 5 * 60 * 1000;   // after a rejected refresh, don't hammer the endpoint
let refreshLock = null;
let refreshFail = null; // { at, error, expiresAt } — for the creds that failed
function needLogin(msg) { const e = new Error(msg); e.needLogin = true; return e; }
async function ensureFreshCredentials({ force = false } = {}) {
  if (refreshLock) return refreshLock;
  refreshLock = (async () => {
    const creds = await store.getClaudeCredentials();
    if (!creds.credentials) throw needLogin("no Claude credentials — Re-login from Settings");
    const exp = oauth.expiresAt(creds.credentials);
    const left = exp - Date.now();
    if (!force && left > FRESH_MARGIN_MS) return { refreshed: false, expiresAt: exp };
    if (!force && refreshFail && refreshFail.expiresAt === exp && Date.now() - refreshFail.at < REFRESH_RETRY_MS) {
      throw needLogin(`Claude login expired and the token refresh was rejected (${refreshFail.error}) — Re-login from Settings`);
    }
    let r;
    try { r = await oauth.refresh(creds.credentials); }
    catch (e) {
      refreshFail = { at: Date.now(), error: e.message, expiresAt: exp };
      console.error(`[creds] refresh failed: ${e.message}`);
      if (e.rejected || left < 0) throw needLogin(`Claude login expired and the token refresh was rejected (${e.message}) — Re-login from Settings`);
      throw e; // transient (network) with a still-valid access token: caller may proceed
    }
    await store.setClaudeCredentials(r.credentials, creds.account);
    refreshFail = null;
    console.log(`[creds] refreshed via ${r.via}; access token now valid until ${new Date(r.expiresAt).toISOString()}`);
    return { refreshed: true, expiresAt: r.expiresAt };
  })();
  try { return await refreshLock; } finally { refreshLock = null; }
}
function credsStatus(credentials) {
  const exp = oauth.expiresAt(credentials);
  const stale = !!refreshFail && refreshFail.expiresAt === exp && exp < Date.now();
  return { expiresAt: exp || null, expired: !!exp && exp < Date.now(), stale, error: stale ? refreshFail.error : null };
}

// ---- live session registry (inside each machine) ---------------------------
// claude keeps ~/.claude/sessions/<pid>.json with the live display name and
// busy/idle status, and appends {"type":"ai-title","aiTitle":…} records to the session's
// transcript when the Claude app titles the conversation. Read both via one Fly exec so
// the dashboard shows the same title as the app. Cached briefly; failures fall back to metadata.
// __BG__: background tool jobs are child shells (`bash -c source …shell-snapshots…`) of the
// claude pid — a session reporting "idle" with such children still has work running.
const REG_CMD = 'for f in /home/claude/.claude/sessions/*.json; do cat "$f" 2>/dev/null; echo; done; echo __TITLES__; '
  + 'for f in /home/claude/.claude/projects/*/*.jsonl; do t=$(grep -h \'"type":"ai-title"\' "$f" 2>/dev/null | tail -1); [ -n "$t" ] && echo "$t"; done; '
  + 'echo __BG__; for f in /home/claude/.claude/sessions/*.json; do p=$(grep -o \'"pid":[0-9]*\' "$f" | head -1 | cut -d: -f2); [ -n "$p" ] && echo "$p $(pgrep -c -P "$p" -f shell-snapshots 2>/dev/null || echo 0)"; done; true';
const regCache = new Map();
async function readRegistry(machineId) {
  const c = regCache.get(machineId);
  if (c && Date.now() - c.at < 8000) return c.data;
  let data = null;
  try {
    const r = await Promise.race([
      fly.exec(machineId, ["bash", "-lc", REG_CMD], 10),
      new Promise((_, rej) => setTimeout(() => rej(new Error("exec timeout")), 12000)),
    ]);
    const [regPart, rest = ""] = String(r.stdout || "").split("__TITLES__");
    const [titlePart, bgPart = ""] = rest.split("__BG__");
    const parse = (s) => s.split("\n").filter((l) => l.trim().startsWith("{"))
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const entries = parse(regPart).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    const titles = Object.fromEntries(parse(titlePart).filter((t) => t.type === "ai-title" && t.aiTitle).map((t) => [t.sessionId, t.aiTitle]));
    const bg = Object.fromEntries(bgPart.split("\n").map((l) => l.trim().split(/\s+/)).filter((a) => a.length === 2).map(([p, n]) => [p, parseInt(n, 10) || 0]));
    const host = entries.find((e) => e.bridgeSessionId) || entries[0] || null;
    if (host) {
      data = {
        liveName: host.name || "",
        nameSource: host.nameSource || "",
        aiTitle: titles[host.sessionId] || "",
        status: host.status || "",
        bgTasks: bg[String(host.pid)] || 0,
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
          size: m.config?.metadata?.size || "",
          model: m.config?.metadata?.model || "",
          guest: m.config?.guest ? `${m.config.guest.cpus}×${m.config.guest.cpu_kind} · ${Math.round((m.config.guest.memory_mb || 0) / 1024)} GB` : "",
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
    try { const c = JSON.parse(creds.credentials || "{}").claudeAiOauth || {}; credsInfo = { expiresAt: c.expiresAt || null, subscriptionType: c.subscriptionType || "", scopes: c.scopes || [], ...credsStatus(creds.credentials) }; } catch {}
    res.json({
      version: VERSION,
      environments,
      repos: cfg.repos || [],
      sessions,
      sessionImage: cfg.sessionImage || null,
      flyApp: process.env.FLY_APP || "de0ch-claude-sessions",
      flyError,
      hasCreds: !!creds.credentials,
      creds: credsInfo,
      auth: await authclient.status(),
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

// ---- Claude credentials API ----------------------------------------------------
// Write-back from sessions (and any tool with the Access service token): store a newer
// credentials.json. Only a pair with a LATER expiresAt than the stored one is accepted, so a
// stale copy can never overwrite a fresh one. Token values are never echoed back.
app.post("/api/credentials", async (req, res) => {
  try {
    const { credentials, account } = req.body || {};
    const c = typeof credentials === "string" ? credentials : JSON.stringify(credentials || {});
    let o; try { o = JSON.parse(c).claudeAiOauth; } catch {}
    if (!o || !o.accessToken || !o.refreshToken || !o.expiresAt) return res.status(400).json({ error: "credentials must be a ~/.claude/.credentials.json object with claudeAiOauth.{accessToken,refreshToken,expiresAt}" });
    const cur = await store.getClaudeCredentials();
    const curExp = oauth.expiresAt(cur.credentials);
    if (Number(o.expiresAt) <= curExp) return res.json({ stored: false, reason: "not newer than the stored credentials", expiresAt: curExp });
    const acct = account ? (typeof account === "string" ? account : JSON.stringify(account)) : cur.account;
    await store.setClaudeCredentials(c, acct);
    refreshFail = null;
    console.log(`[creds] stored newer credentials (valid until ${new Date(Number(o.expiresAt)).toISOString()})`);
    res.json({ stored: true, expiresAt: Number(o.expiresAt) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Refresh the stored pair now (Settings -> Refresh token). 409 + needLogin when rejected.
app.post("/api/credentials/refresh", async (req, res) => {
  try { res.json({ ok: true, ...(await ensureFreshCredentials({ force: true })) }); }
  catch (e) { res.status(e.needLogin ? 409 : 502).json({ error: e.message, needLogin: !!e.needLogin }); }
});

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
// Your GitHub repos, for the dashboard's picker (dropdown + search). Metadata only.
app.get("/api/github/repos", async (req, res) => {
  try {
    const r = await github.list({ refresh: req.query.refresh === "1" });
    res.json({ ...r, configured: !!process.env.GITHUB_TOKEN });
  } catch (e) { res.status(process.env.GITHUB_TOKEN ? 502 : 503).json({ error: e.message, configured: !!process.env.GITHUB_TOKEN }); }
});
app.delete("/api/repos/:name", async (req, res) => {
  try {
    const repos = ((await store.get()).repos || []).filter((r) => r.name !== req.params.name);
    await store.setRepos(repos);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Claude auth (re-login through the real CLI, in the auth broker) ------------
// The broker (auth-broker.js, its own Deployment) holds the `claude auth login` PTY; the
// portal only relays and stores the resulting pair, so a portal rollout can't lose a login.
app.post("/api/auth/start", async (req, res) => {
  try { res.json(await authclient.start(await store.getClaudeCredentials())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/auth/code", async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "code required" });
    const r = await authclient.submit(code);
    if (!r.credentials) throw new Error("auth broker returned no credentials");
    await store.setClaudeCredentials(r.credentials, r.account || "{}");
    res.json({ ok: true, output: r.output });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/auth/status", async (req, res) => res.json(await authclient.status()));

// ---- sessions -------------------------------------------------------------
// Machine size presets (Fly on-demand prices, 2026-09): the dashboard offers these; anything
// else in `guest` is rejected so a typo can't provision a 128 GB machine.
const SIZES = {
  small:  { cpu_kind: "shared",      cpus: 2, memory_mb: 2048,  label: "2 shared vCPU · 2 GB · ~$0.016/h · ~$11.52/mo" },
  medium: { cpu_kind: "shared",      cpus: 4, memory_mb: 4096,  label: "4 shared vCPU · 4 GB · ~$0.033/h · ~$23.76/mo" },
  large:  { cpu_kind: "shared",      cpus: 8, memory_mb: 8192,  label: "8 shared vCPU · 8 GB · ~$0.066/h · ~$47.52/mo" },
  xlarge: { cpu_kind: "shared",      cpus: 8, memory_mb: 16384, label: "8 shared vCPU · 16 GB · ~$0.12/h · ~$86.40/mo" },
  perf:   { cpu_kind: "performance", cpus: 2, memory_mb: 4096,  label: "2 dedicated vCPU · 4 GB · ~$0.09/h · ~$64.80/mo" },
};
const DEFAULT_SIZE = "medium";
app.get("/api/sizes", (req, res) => res.json({ sizes: SIZES, default: DEFAULT_SIZE }));

// Model presets the dashboard offers for a new session (passed to the session image as
// SESSION_MODEL -> `claude --model <id>`); anything else is rejected so a typo can't
// silently pick a wrong/unavailable model.
const MODELS = {
  "claude-opus-4-8":  { label: "Opus 4.8 — most capable" },
  "claude-fable-5-1": { label: "Fable 5.1 — fast" },
};
const DEFAULT_MODEL = "claude-opus-4-8";
app.get("/api/models", (req, res) => res.json({ models: MODELS, default: DEFAULT_MODEL }));

app.post("/api/sessions", async (req, res) => {
  try {
    if (!process.env.FLY_API_TOKEN) return res.status(400).json({ error: "FLY_API_TOKEN not set on the portal" });
    const cfg = await store.get();
    if (!cfg.sessionImage) return res.status(400).json({ error: "no session image yet — rebuild it from Settings" });
    // make sure the pair we inject actually works: refresh if expired/expiring, else 409 -> Re-login
    try { await ensureFreshCredentials(); }
    catch (e) { if (e.needLogin) return res.status(409).json({ error: e.message, needLogin: true }); console.error(`[creds] ${e.message}`); }
    const creds = await store.getClaudeCredentials();
    if (!creds.credentials) return res.status(409).json({ error: "no Claude credentials — Re-login from Settings", needLogin: true });
    const { environment, repos = [], label, permissionMode, size, model, prompt } = req.body || {};
    const env = cfg.environments[environment];
    if (environment && !env) return res.status(400).json({ error: `unknown environment '${environment}'` });
    const sizeKey = size && SIZES[size] ? size : DEFAULT_SIZE;
    const { label: _sizeLabel, ...guest } = SIZES[sizeKey];
    const modelId = model && MODELS[model] ? model : DEFAULT_MODEL;

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
    // Optional first prompt: pasted into the remote-control host's input once it is up (the
    // supervisor in the session image does it — see session-supervisor.sh), so the session
    // starts working right away instead of waiting for the first message from the app. Any
    // text, newlines included; capped so it fits comfortably in the machine env.
    const firstPrompt = String(prompt || "").replace(/\r\n?/g, "\n").trim().slice(0, 16000);

    const machineEnv = {
      CLAUDE_CREDENTIALS: creds.credentials,
      CLAUDE_ACCOUNT: creds.account || "{}",
      SESSION_SECRETS_JSON: JSON.stringify(env ? env.secrets || {} : {}),
      SESSION_REPOS: repoUrls.join(","),
      SESSION_LABEL: userLabel, // blank => the Claude session names itself
      SESSION_PERMISSION_MODE: permMode,
      SESSION_MODEL: modelId,
      SESSION_PROMPT: firstPrompt, // blank => nothing is typed; the app sends the first message
      PORTAL_URL: PUBLIC_URL, // the session pushes refreshed Claude credentials back here
    };
    const name = `s-${slug(userLabel || base)}-${rand()}`;
    const machine = await fly.createMachine({
      name,
      image: cfg.sessionImage,
      env: machineEnv,
      guest,
      metadata: {
        role: "claude-session",
        environment: environment || "",
        repos: repoUrls.join(" "),
        label: userLabel,
        permissionMode: permMode,
        size: sizeKey,
        model: modelId,
        hasPrompt: firstPrompt ? "1" : "",
      },
    });
    res.json({ ok: true, id: machine.id, name, label: userLabel, state: machine.state, size: sizeKey, model: modelId, hasPrompt: !!firstPrompt });
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
// Refresh login inside a RUNNING session: write the portal's (freshly refreshed) credentials
// over the session's ~/.claude/.credentials.json, then type a prompt (default "continue") into
// its terminal so the stuck claude ("Login expired · Please run /login") picks the new pair up
// and carries on. This is the fix when another session rotated the shared refresh token first.
// Body: {text?: string|false} — the prompt to send; false = write the file only.
app.post("/api/sessions/:id/relogin", async (req, res) => {
  try {
    const id = req.params.id;
    const m = await fly.getMachine(id);
    if (m.state !== "started") return res.status(409).json({ error: `session is ${m.state}` });
    try { await ensureFreshCredentials(); }
    catch (e) { if (e.needLogin) return res.status(409).json({ error: e.message, needLogin: true }); console.error(`[creds] ${e.message}`); }
    const creds = await store.getClaudeCredentials();
    if (!creds.credentials) return res.status(409).json({ error: "no Claude credentials — Re-login from Settings", needLogin: true });
    // atomic replace, 0600, owned by claude; the file content travels as an argv item (never a shell string)
    const script = 'umask 077; d="$HOME/.claude"; mkdir -p "$d"; printf %s "$1" > "$d/.credentials.json.tmp" && mv -f "$d/.credentials.json.tmp" "$d/.credentials.json" && echo written';
    const r = await fly.exec(id, ["/usr/bin/sudo", "-u", "claude", "-H", "/bin/bash", "-c", script, "_", creds.credentials], 15);
    if (!/written/.test(String(r.stdout || ""))) throw new Error("could not write the credentials file: " + String(r.stderr || r.stdout || "").slice(0, 200));
    const text = req.body && req.body.text === false ? null : String((req.body && req.body.text) || "continue").slice(0, 200);
    let prompted = false;
    if (text) { await tty.input(id, { text, keys: ["Enter"] }); prompted = true; }
    console.log(`[creds] wrote credentials into session ${id}${prompted ? ` and sent "${text}"` : ""}`);
    res.json({ ok: true, expiresAt: oauth.expiresAt(creds.credentials), prompted, text: prompted ? text : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
// Destroy = archive first (transcripts + ~/artifacts -> Storage Box, done by the portal, no AI),
// then delete the machine. If archiving fails the machine is kept unless ?force=1.
app.delete("/api/sessions/:id", async (req, res) => {
  const id = req.params.id, force = req.query.force === "1";
  let archived = null;
  try {
    const m = await fly.getMachine(id);
    if (m.state === "started") {
      const reg = await readRegistry(id);
      const md = m.config?.metadata || {};
      const title = (reg && reg.nameSource && reg.nameSource !== "derived" && reg.liveName) || (reg && reg.aiTitle) || md.label || (reg && reg.liveName) || m.name;
      try {
        archived = await archive.run(id, { id, machineName: m.name, title, environment: md.environment || "", repos: md.repos || "",
          permissionMode: md.permissionMode || "", created: m.created_at, bridgeSessionId: (reg && reg.bridgeSessionId) || "" });
      } catch (e) {
        if (!force) return res.status(409).json({ error: e.message, archiveFailed: true });
        archived = { error: e.message };
      }
    }
    res.json({ ...(await fly.destroyMachine(id)), archived });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- redroid cloud-Android box (a Hetzner server, managed via HETZNER_API in the ----
// default env). The only lifecycle action is Release (delete) — Hetzner bills a powered-off
// server the same as a running one, so there is deliberately no Stop. The debug view
// (screenshot + health) is READ-ONLY, over SSH with REDROID_SSH_KEY.
async function hzToken() {
  const t = await redroid.token();
  if (!t) { const e = new Error("HETZNER_API not set in the default environment"); e.code = 400; throw e; }
  return t;
}
app.get("/api/redroid/state", async (req, res) => {
  try {
    const token = await hzToken();
    const server = await hetzner.find(token);
    res.json({ configured: true, server });
  } catch (e) { res.status(e.code === 400 ? 200 : 500).json({ configured: false, server: null, error: e.message }); }
});
app.delete("/api/redroid", async (req, res) => {
  try { const token = await hzToken(); const s = await hetzner.find(token); if (!s) throw new Error("box not found");
    res.json(await hetzner.del(s.id, token)); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/redroid/debug", async (req, res) => {
  try { const token = await hzToken(); const s = await hetzner.find(token);
    if (!s) return res.status(404).json({ error: "box not found" });
    if (s.status !== "running") return res.json({ status: s.status, health: null, note: `box is ${s.status}` });
    res.json({ status: s.status, health: await redroid.health(s.ip) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/redroid/screen.png", async (req, res) => {
  try { const token = await hzToken(); const s = await hetzner.find(token);
    if (!s || s.status !== "running") return res.status(409).end();
    const png = await redroid.screenshot(s.ip);
    res.set("Content-Type", "image/png").set("Cache-Control", "no-store").send(png);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, HOST, () => {
  console.log(`[portal] v${VERSION} listening on ${HOST}:${PORT}`);
  store.get().then((c) => console.log(`[portal] cluster ok: ${Object.keys(c.environments).length} environment(s), ${(c.repos || []).length} repo(s), image ${c.sessionImage || "none"}`))
    .catch((e) => console.error("[portal] cluster read failed (will retry on requests):", e.message));
});
