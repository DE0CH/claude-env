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
const notify = require("./lib/notify");

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
  + 'echo __BG__; for f in /home/claude/.claude/sessions/*.json; do p=$(grep -o \'"pid":[0-9]*\' "$f" | head -1 | cut -d: -f2); [ -n "$p" ] && echo "$p $(pgrep -c -P "$p" -f shell-snapshots 2>/dev/null || echo 0)"; done; '
  // __ONESHOT__: the supervisor writes ~/.claude/.one-shot-done when a one-shot session's prompt
  // is finished and claude has exited (session-supervisor.sh); the one-shot loop below acts on it.
  + 'echo __ONESHOT__; cat /home/claude/.claude/.one-shot-done 2>/dev/null; true';
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
    const [titlePart, rest2 = ""] = rest.split("__BG__");
    const [bgPart, oneShotPart = ""] = rest2.split("__ONESHOT__");
    const oneShotDone = /^done\b/m.test(oneShotPart.trim());
    const parse = (s) => s.split("\n").filter((l) => l.trim().startsWith("{"))
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const entries = parse(regPart).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    const titles = Object.fromEntries(parse(titlePart).filter((t) => t.type === "ai-title" && t.aiTitle).map((t) => [t.sessionId, t.aiTitle]));
    const bg = Object.fromEntries(bgPart.split("\n").map((l) => l.trim().split(/\s+/)).filter((a) => a.length === 2).map(([p, n]) => [p, parseInt(n, 10) || 0]));
    const host = entries.find((e) => e.bridgeSessionId) || entries[0] || null;
    // a finished one-shot has no registry entry any more (claude exited) — still report it
    if (!host && oneShotDone) data = { oneShotDone: true, status: "", sessionsInside: 0 };
    if (host) {
      data = {
        liveName: host.name || "",
        nameSource: host.nameSource || "",
        aiTitle: titles[host.sessionId] || "",
        status: host.status || "",
        bgTasks: bg[String(host.pid)] || 0,
        bridgeSessionId: host.bridgeSessionId || "",
        sessionsInside: entries.length,
        oneShotDone,
      };
    }
  } catch (e) { data = null; }
  regCache.set(machineId, { at: Date.now(), data });
  return data;
}

// ---- pausing a session ----------------------------------------------------
// Pause = snapshot, then Fly stop. A stopped machine's ephemeral rootfs is RESET on the next
// Start (verified: after a stop/start every transcript was gone), so stopping alone would lose
// the conversation and claude would come up as a brand-new session (a new entry in the Claude
// app, back at the first prompt). So before stopping, the transcript(s) + ~/.claude.json +
// ~/workspace and ~/artifacts (as tarballs) are uploaded to claude-records/.paused/<machineId>/
// on the Storage Box (archive.snapshot, run inside the machine); on Start the session image's
// entrypoint pulls them back and the supervisor `claude --resume`s the conversation with the
// working tree as it was. If the snapshot fails the machine is left running — pausing without
// it would destroy the session's state.
async function pauseMachine(id) {
  const snap = await archive.snapshot(id);
  const r = await fly.stopMachine(id);
  return { ...r, snapshot: snap };
}

// ---- starting (waking) a session -------------------------------------------
// Every Start goes through here, because a machine's env is fixed at creation: woken as-is, a
// paused session comes back with the OAuth pair it was CREATED with, which is dead by then
// (claude rotates the refresh token on every refresh, and the shared pair gets refreshed by the
// portal / other sessions meanwhile). Claude then fails to refresh, wipes the pair, and the
// resumed session sits at "Not logged in" with Remote Control off (`--rc flag ignored`) — seen
// 2026-09-15 on a session woken ~9h after its auto-pause. So: refresh the stored pair if it
// needs it (409 needLogin, like session creation), write it — plus any env/metadata patch —
// into the stopped machine's config with skip_launch, then start. Fly applies a config change to
// a RUNNING machine by restarting it (rootfs reset), so a running machine is snapshotted +
// stopped first (pauseMachine; throws if the snapshot fails, leaving it untouched).
async function wakeMachine(id, { env = {}, metadata = {} } = {}) {
  try { await ensureFreshCredentials(); }
  catch (e) { if (e.needLogin) throw e; console.error(`[creds] ${e.message}`); }
  const creds = await store.getClaudeCredentials();
  if (!creds.credentials) throw needLogin("no Claude credentials — Re-login from Settings");
  const m = await fly.getMachine(id);
  const cur = m.config || {};
  let snapshot = null;
  if (m.state === "started") ({ snapshot } = await pauseMachine(id)); // snapshot + stop; throws if snapshot fails
  const config = {
    ...cur,
    env: { ...(cur.env || {}), CLAUDE_CREDENTIALS: creds.credentials, CLAUDE_ACCOUNT: creds.account || "{}", ...env },
    metadata: { ...(cur.metadata || {}), ...metadata },
  };
  await fly.updateMachine(id, config, { skipLaunch: true });
  // Only tolerate the 412 Fly gives while it is still replacing the machine itself (the replace
  // starts it) — anything else is a real start failure.
  try { await fly.startMachine(id); }
  catch (e) { if (!/refusing to start|getting replaced/i.test(e.message)) throw e; }
  return { ok: true, snapshot };
}

// ---- switching a session's permission mode --------------------------------
// "auto" (classifier auto-approve) <-> "bypass" (--dangerously-skip-permissions). The mode is a
// machine env var (SESSION_PERMISSION_MODE) the supervisor reads at claude launch, so changing it
// is a wake with an env + metadata patch (snapshot + stop + config update + start, see
// wakeMachine). The entrypoint restores the snapshot and the supervisor `claude --resume`s in
// the new mode (the session image pre-accepts the bypass dialog, so a bypass restart doesn't
// hang on "booting").
async function setPermissionMode(id, mode) {
  const m = await fly.getMachine(id);
  if ((m.config?.metadata?.permissionMode || "") === mode) return { ok: true, permissionMode: mode, unchanged: true };
  const r = await wakeMachine(id, { env: { SESSION_PERMISSION_MODE: mode }, metadata: { permissionMode: mode } });
  return { ...r, permissionMode: mode };
}

// ---- auto-pause idle sessions ---------------------------------------------
// A started session idle for IDLE_PAUSE_MS (claude status exactly "idle", no background jobs)
// is paused (snapshot + stop, see pauseMachine) to save Fly compute; Start resumes the same
// conversation. Opt out per session via metadata autoPause=off (dashboard toggle). idleSince
// tracks when a machine first looked idle; it is reset the moment it is busy/waiting/unreachable,
// so only a sustained idle actually pauses. A failed snapshot just logs; the next tick retries.
const IDLE_PAUSE_MS = 60 * 60 * 1000;
const AUTOPAUSE_TICK_MS = 2 * 60 * 1000;
const idleSince = new Map(); // machineId -> ms it first looked idle
function idleEligible(reg) { return !!(reg && reg.status === "idle" && !reg.bgTasks); }
async function autoPauseTick() {
  if (!process.env.FLY_API_TOKEN) return;
  let machines;
  try { machines = await fly.listMachines(); } catch { return; }
  const alive = new Set();
  for (const m of machines) {
    if (m.state !== "started") { idleSince.delete(m.id); continue; }
    alive.add(m.id);
    if ((m.config?.metadata?.autoPause || "on") === "off") { idleSince.delete(m.id); continue; }
    let reg = null;
    try { reg = await readRegistry(m.id); } catch { reg = null; }
    if (!idleEligible(reg)) { idleSince.delete(m.id); continue; } // booting/busy/needs-you/unreachable
    if (!idleSince.has(m.id)) idleSince.set(m.id, Date.now());
    if (Date.now() - idleSince.get(m.id) >= IDLE_PAUSE_MS) {
      try { await pauseMachine(m.id); idleSince.delete(m.id); console.log(`[autopause] paused idle session ${m.id} (${m.name})`); }
      catch (e) { console.error(`[autopause] pause ${m.id} failed: ${e.message}`); }
    }
  }
  for (const id of [...idleSince.keys()]) if (!alive.has(id)) idleSince.delete(id); // forget gone machines
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
          autoPause: m.config?.metadata?.autoPause || "on", // default on (also covers pre-feature sessions)
          oneShot: m.config?.metadata?.oneShot === "1",
          guest: m.config?.guest ? `${m.config.guest.cpus}×${m.config.guest.cpu_kind} · ${Math.round((m.config.guest.memory_mb || 0) / 1024)} GB` : "",
        }));
        // stable order: newest first, id as tie-break (Fly's list order is not deterministic)
        sessions.sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")) || a.id.localeCompare(b.id));
        // enrich running machines with the live name/status from inside
        await Promise.all(sessions.map(async (s) => {
          if (s.state !== "started") return;
          const reg = await readRegistry(s.id);
          if (reg) Object.assign(s, reg);
          // how long until auto-pause, if the loop is already counting this one down
          if (s.autoPause !== "off" && idleEligible(reg) && idleSince.has(s.id)) {
            s.pauseInMs = Math.max(0, idleSince.get(s.id) + IDLE_PAUSE_MS - Date.now());
          }
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
  "claude-opus-4-8":  { label: "Opus 4.8 — faster, cheaper" },
  "claude-fable-5-1": { label: "Fable 5.1 — most capable" },
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
    const { environment, repos = [], label, permissionMode, size, model, prompt, autoPause, oneShot } = req.body || {};
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
    // Auto-pause when idle (default on): stop the machine after ~1h idle to save compute; it
    // resumes the same conversation on Start. Stored in metadata; the auto-pause loop reads it.
    const autoPauseVal = autoPause === false || oneShot === true ? "off" : "on";

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
    // One-shot: the prompt is the whole job. The supervisor exits claude once it is done and the
    // portal's one-shot loop archives + destroys the machine (force — see oneShotTick). Auto-pause
    // is pointless for it (a finished one-shot is gone within a minute), so it's off.
    const isOneShot = oneShot === true;
    if (isOneShot && !firstPrompt) return res.status(400).json({ error: "a one-shot session needs a prompt" });

    const machineEnv = {
      CLAUDE_CREDENTIALS: creds.credentials,
      CLAUDE_ACCOUNT: creds.account || "{}",
      SESSION_SECRETS_JSON: JSON.stringify(env ? env.secrets || {} : {}),
      SESSION_REPOS: repoUrls.join(","),
      SESSION_LABEL: userLabel, // blank => the Claude session names itself
      SESSION_PERMISSION_MODE: permMode,
      SESSION_MODEL: modelId,
      SESSION_PROMPT: firstPrompt, // blank => nothing is typed; the app sends the first message
      SESSION_ONE_SHOT: isOneShot ? "1" : "",
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
        autoPause: autoPauseVal,
        hasPrompt: firstPrompt ? "1" : "",
        oneShot: isOneShot ? "1" : "",
      },
    });
    res.json({ ok: true, id: machine.id, name, label: userLabel, state: machine.state, size: sizeKey, model: modelId, autoPause: autoPauseVal, hasPrompt: !!firstPrompt, oneShot: isOneShot });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Pre-destroy check: uncommitted / unpushed work in each repo inside the session.
async function repoChanges(id, machine) {
  try {
    const m = machine || await fly.getMachine(id);
    if (m.state !== "started") return { checked: false, reason: `session is ${m.state}`, repos: [] };
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
    return { checked: true, repos, status: (reg && reg.status) || "" };
  } catch (e) { return { checked: false, reason: e.message, repos: [] }; }
}
// one line per repo with unsaved work ("claude-env: 2 uncommitted file(s), 1 unpushed commit(s)"), [] if clean
function dirtyLines(changes) {
  return (changes.repos || []).filter((r) => r.uncommitted > 0 || r.unpushed > 0 || r.unpushed === -1).map((r) => {
    const parts = [];
    if (r.uncommitted > 0) parts.push(`${r.uncommitted} uncommitted file(s)`);
    if (r.unpushed > 0) parts.push(`${r.unpushed} unpushed commit(s)`); else if (r.unpushed === -1) parts.push("branch has no upstream (nothing pushed)");
    return `${r.name}: ${parts.join(", ")}`;
  });
}
app.get("/api/sessions/:id/changes", async (req, res) => { res.json(await repoChanges(req.params.id)); });
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

// "stop" here means PAUSE the session (the dashboard's Pause button): snapshot the transcript,
// then stop — see pauseMachine. A 500 here means the snapshot failed and the machine is still
// running (nothing was lost).
app.post("/api/sessions/:id/stop", async (req, res) => {
  try { res.json(await pauseMachine(req.params.id)); } catch (e) { res.status(500).json({ error: e.message }); }
});
// Start = wake with the CURRENT Claude credentials (see wakeMachine); 409 + needLogin when the
// stored pair is dead and only a Re-login can fix it.
app.post("/api/sessions/:id/start", async (req, res) => {
  try { res.json(await wakeMachine(req.params.id)); }
  catch (e) { res.status(e.needLogin ? 409 : 500).json({ error: e.message, needLogin: !!e.needLogin }); }
});
// Switch a session between "auto" and "bypass" (--dangerously-skip-permissions), restarting it
// on the same conversation (see setPermissionMode). A 500 means the pre-restart snapshot failed
// and the machine is untouched.
app.post("/api/sessions/:id/permission-mode", async (req, res) => {
  try {
    const mode = req.body && req.body.mode === "bypass" ? "bypass" : "auto";
    res.json(await setPermissionMode(req.params.id, mode));
  } catch (e) { res.status(e.needLogin ? 409 : 500).json({ error: e.message, needLogin: !!e.needLogin }); }
});
// Toggle auto-pause for one session (metadata autoPause=on|off). Default is on; turning it
// off keeps the machine running through idle periods. Resets the idle countdown either way.
app.post("/api/sessions/:id/autopause", async (req, res) => {
  try {
    const enabled = !(req.body && req.body.enabled === false);
    await fly.setMetadata(req.params.id, "autoPause", enabled ? "on" : "off");
    idleSince.delete(req.params.id);
    res.json({ ok: true, autoPause: enabled ? "on" : "off" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Destroy = archive first (transcripts + ~/artifacts -> Storage Box, done by the portal, no AI),
// then delete the machine. If archiving fails the machine is kept unless ?force=1.
// A running machine archives from its disk (and its stale pause snapshot, if any, is dropped);
// a PAUSED machine can't be exec'd and its rootfs is gone anyway, so its pause snapshot
// (claude-records/.paused/<id>/) IS the record and is moved into the normal archive dir.
// Archive + destroy. Throws an error with .archiveFailed=true (→ 409) when the archive failed and
// force is off; with force the machine goes anyway and `archived` carries the error. Returns
// {..., archived, title, envSecrets} so callers can report on it.
async function destroySession(id, { force = false } = {}) {
  let archived = null;
  const m = await fly.getMachine(id);
  const md = m.config?.metadata || {};
  const envSecrets = ((await store.get()).environments[md.environment] || {}).secrets || {};
  const common = { id, machineName: m.name, environment: md.environment || "", repos: md.repos || "", permissionMode: md.permissionMode || "",
    oneShot: md.oneShot === "1", created: m.created_at };
  let title = md.label || m.name;
  if (m.state === "started") {
    const reg = await readRegistry(id);
    title = (reg && reg.nameSource && reg.nameSource !== "derived" && reg.liveName) || (reg && reg.aiTitle) || md.label || (reg && reg.liveName) || m.name;
    try {
      archived = await archive.run(id, { ...common, title, bridgeSessionId: (reg && reg.bridgeSessionId) || "" });
      await archive.clearPaused(envSecrets, id);
    } catch (e) {
      if (!force) { e.archiveFailed = true; throw e; }
      archived = { error: e.message };
    }
  } else {
    try { archived = await archive.finalizePaused(envSecrets, { ...common, title }); }
    catch (e) {
      if (!force) { e.archiveFailed = true; throw e; }
      archived = { error: e.message };
    }
  }
  return { ...(await fly.destroyMachine(id)), archived, title, envSecrets };
}
app.delete("/api/sessions/:id", async (req, res) => {
  try {
    const { envSecrets: _s, ...r } = await destroySession(req.params.id, { force: req.query.force === "1" });
    res.json(r);
  } catch (e) { res.status(e.archiveFailed ? 409 : 500).json({ error: e.message, archiveFailed: !!e.archiveFailed }); }
});

// ---- one-shot sessions: archive + destroy when the prompt is done ----------------
// A one-shot session (metadata oneShot=1) runs its first prompt and nothing else: the supervisor
// inside the machine exits claude when the prompt's work is finished and writes
// ~/.claude/.one-shot-done (see session-supervisor.sh). This loop notices the marker through the
// registry exec and destroys the machine FORCEFULLY — archiving the transcript + ~/artifacts to
// the Storage Box first, but not stopping for uncommitted/unpushed work (the odds of losing
// something valuable from one prompt are low) nor for a failed archive. Whenever work WAS lost
// (dirty repos, or the archive failed) Deyao gets a Discord DM saying exactly what. Stateless
// apart from an in-flight guard, so a portal rollout just delays a destroy by a tick.
const ONESHOT_TICK_MS = 30 * 1000;
const oneShotBusy = new Set();
async function oneShotTick() {
  if (!process.env.FLY_API_TOKEN) return;
  let machines;
  try { machines = await fly.listMachines(); } catch { return; }
  for (const m of machines) {
    if (m.state !== "started" || m.config?.metadata?.oneShot !== "1" || oneShotBusy.has(m.id)) continue;
    let reg = null;
    try { reg = await readRegistry(m.id); } catch { reg = null; }
    if (!reg || !reg.oneShotDone) continue;
    oneShotBusy.add(m.id);
    finishOneShot(m).catch((e) => console.error(`[oneshot] ${m.id}: ${e.message}`)).finally(() => oneShotBusy.delete(m.id));
  }
}
async function finishOneShot(m) {
  const id = m.id;
  console.log(`[oneshot] ${id} (${m.name}) finished its prompt; archiving + destroying`);
  const changes = await repoChanges(id, m);
  const lost = dirtyLines(changes);
  const r = await destroySession(id, { force: true });
  const where = r.archived && r.archived.dir ? `${r.archived.dir} (${r.archived.files} file(s))` : "NOT archived";
  const archiveErr = r.archived && r.archived.error ? r.archived.error : null;
  console.log(`[oneshot] ${id} destroyed; records: ${archiveErr ? "FAILED: " + archiveErr : where}${lost.length ? "; unsaved work lost in " + lost.join("; ") : ""}`);
  if (lost.length || archiveErr || !changes.checked) {
    const lines = [`⚠️ One-shot session “${r.title}” was destroyed with work lost:`];
    for (const l of lost) lines.push(`• ${l}`);
    if (!changes.checked) lines.push(`• could not check the repos for unsaved work (${changes.reason || "unknown"})`);
    if (archiveErr) lines.push(`• archive to the Storage Box FAILED — transcript and ~/artifacts are gone: ${archiveErr}`);
    else lines.push(`Transcript + ~/artifacts were archived to ${where}.`);
    await notify.discord(lines.join("\n"), { token: r.envSecrets.LOBSTER_TOKEN });
  }
}

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
  // Auto-pause idle sessions (single portal replica, so one timer is enough).
  setInterval(() => autoPauseTick().catch((e) => console.error("[autopause]", e.message)), AUTOPAUSE_TICK_MS);
  // One-shot sessions: archive + destroy once their prompt is done (marker written by the supervisor).
  setInterval(() => oneShotTick().catch((e) => console.error("[oneshot]", e.message)), ONESHOT_TICK_MS);
});
