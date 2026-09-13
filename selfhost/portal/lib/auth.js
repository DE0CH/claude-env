// Re-login: drive the real `claude auth login --claudeai` in a PTY (correct-by-construction
// OAuth: URL, scopes and token endpoint come from the CLI itself). Flow:
//   start()   -> spawns the CLI, captures the authorize URL it prints, returns it
//   submit()  -> pastes the code the user copied from the browser, waits for exit,
//                reads the fresh ~/.claude/.credentials.json and stores it via the callback
const fs = require("fs");
const os = require("os");
const path = require("path");

let pty = null; try { pty = require("node-pty"); } catch { /* dev without native build */ }
const HOME = os.homedir();
const CREDS = path.join(HOME, ".claude", ".credentials.json");
const ACCOUNT = path.join(HOME, ".claude.json");
const URL_RE = /https:\/\/(?:claude\.com|claude\.ai|console\.anthropic\.com|platform\.claude\.com)\/[^\s\x07\x1b"'<>]+/;
const clean = (s) => s.replace(/\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");

let cur = null; // { proc, buf, url, done, code, startedAt }

// Seed the CLI's home so it never asks onboarding questions; keep the current creds around
// so `claude auth status` is meaningful.
function seedHome({ credentials, account }) {
  fs.mkdirSync(path.dirname(CREDS), { recursive: true, mode: 0o700 });
  if (credentials) fs.writeFileSync(CREDS, credentials, { mode: 0o600 });
  let d = {}; try { d = JSON.parse(account || "{}"); } catch {}
  Object.assign(d, { hasCompletedOnboarding: true, hasUsedRemoteControl: true, bypassPermissionsModeAccepted: true, autoUpdates: false });
  fs.writeFileSync(ACCOUNT, JSON.stringify(d));
}

function kill() { if (cur && !cur.done) { try { cur.proc.kill(); } catch {} } cur = null; }

async function start() {
  if (!pty) throw new Error("node-pty not available in this build");
  kill();
  const proc = pty.spawn("claude", ["auth", "login", "--claudeai"], {
    name: "xterm-256color", cols: 200, rows: 40, cwd: HOME,
    env: { ...process.env, HOME, CI: "1", TERM: "xterm-256color", BROWSER: "/bin/true" },
  });
  const st = { proc, buf: "", url: "", done: false, code: null, startedAt: Date.now() };
  cur = st;
  proc.onData((d) => {
    st.buf += d;
    if (!st.url) { const m = clean(st.buf).match(URL_RE); if (m) st.url = m[0]; }
    if (st.buf.length > 200000) st.buf = st.buf.slice(-100000);
  });
  proc.onExit(({ exitCode }) => { st.done = true; st.code = exitCode; });
  const t0 = Date.now();
  while (!st.url && !st.done && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 200));
  if (!st.url) { const tail = clean(st.buf).slice(-600); kill(); throw new Error("claude did not print a login URL" + (tail ? ": " + tail : "")); }
  return { url: st.url };
}

async function submit(code, onCredentials) {
  const st = cur;
  if (!st || st.done) throw new Error("no login in progress — press Re-login first");
  const before = (() => { try { return fs.statSync(CREDS).mtimeMs; } catch { return 0; } })();
  st.proc.write(String(code).trim() + "\r");
  const t0 = Date.now();
  while (!st.done && Date.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 300));
  const output = clean(st.buf).slice(-1500);
  if (!st.done) { kill(); throw new Error("timed out waiting for claude to finish login: " + output.slice(-300)); }
  const after = (() => { try { return fs.statSync(CREDS).mtimeMs; } catch { return 0; } })();
  if (st.code !== 0 || after <= before) { cur = null; throw new Error(`login failed (exit ${st.code}): ${output.slice(-400)}`); }
  const credentials = fs.readFileSync(CREDS, "utf8");
  let account = "{}";
  try { const d = JSON.parse(fs.readFileSync(ACCOUNT, "utf8")); const keep = {}; for (const k of ["oauthAccount", "userID"]) if (d[k] !== undefined) keep[k] = d[k]; account = JSON.stringify(keep); } catch {}
  cur = null;
  await onCredentials(credentials, account);
  return { ok: true, output: output.slice(-300) };
}

function status() {
  return cur ? { inProgress: !cur.done, url: cur.url, startedAt: cur.startedAt } : { inProgress: false };
}

module.exports = { seedHome, start, submit, status, kill };
