// Session records on the Hetzner Storage Box (WebDAV) — no AI involved.
//
// Two jobs:
//  1. run(): archive a session BEFORE it is destroyed. Runs a self-contained bash uploader
//     inside the machine via Fly exec (the session already has STORAGEBOX_HOST/USER/PASSWORD in
//     ~/.secrets and open egress), so nothing streams through the portal. Uploads:
//       transcript-<sessionId>.jsonl   every ~/.claude/projects/*/*.jsonl
//       artifacts/**                   everything under ~/artifacts (files or symlinks) — the mark
//       session.json                   id, title, environment, repos, created/destroyed timestamps
//     into  claude-records/<yyyy-mm-dd> <title>/  (the naming convention from CLAUDE.md).
//  2. snapshot(): the PAUSE snapshot. Fly `stop` resets a machine's ephemeral rootfs on the next
//     start, so pausing would lose the conversation. Before stopping, the same in-machine
//     uploader puts the transcript(s) + ~/.claude.json into  claude-records/.paused/<machineId>/
//     (plus manifest.txt listing the transcripts); on Start the session image's entrypoint pulls
//     them back (it knows FLY_MACHINE_ID and has the Storage Box creds) and `--resume`s.
//     finalizePaused()/clearPaused() tidy that folder up when the session is destroyed: a
//     paused (stopped) machine can't be exec'd, so its snapshot IS the archive and is moved into
//     the normal claude-records dir; a running machine archives from disk and the stale snapshot
//     is deleted. Those two run from the portal itself over WebDAV, using the session
//     environment's Storage Box secrets.
const fly = require("./fly");

function safeTitle(s, fallback) {
  const t = String(s || "").replace(/[\/\\:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return t || fallback;
}
function dirName(meta) {
  const d = (meta.created ? new Date(meta.created) : new Date()).toISOString().slice(0, 10);
  return `claude-records/${d} ${safeTitle(meta.title, meta.machineName || meta.id)}`;
}
const pausedDir = (machineId) => `claude-records/.paused/${machineId}`;

// bash uploader, shared by run() and snapshot(): MKCOL each path segment (405 = exists), PUT
// with 3 retries, one "ok|FAIL <rel>" line per file, then a SUMMARY line. The caller sets DIR and
// $MODE (archive|snapshot) plus META_JSON for archive.
const SCRIPT = `
set -u
set -a; . "$HOME/.secrets" 2>/dev/null; set +a
if [ -z "\${STORAGEBOX_HOST:-}" ] || [ -z "\${STORAGEBOX_USER:-}" ] || [ -z "\${STORAGEBOX_PASSWORD:-}" ]; then
  echo "FATAL no STORAGEBOX_HOST/USER/PASSWORD in this session's environment"; exit 2; fi
BASE="https://$STORAGEBOX_HOST/"
enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }
mkcols() { local p="" seg; IFS=/ read -ra parts <<<"$1"
  for seg in "\${parts[@]}"; do [ -n "$seg" ] || continue; p="$p$seg/"
    curl -sS -o /dev/null -m 60 -u "$STORAGEBOX_USER:$STORAGEBOX_PASSWORD" -X MKCOL "$BASE$(enc "$p")" || true; done; }
put() { local f="$1" rel="$2" code="" i
  case "$rel" in */*) mkcols "$DIR/$(dirname "$rel")";; esac
  for i in 1 2 3; do
    code=$(curl -sS -o /dev/null -w '%{http_code}' -m 500 -u "$STORAGEBOX_USER:$STORAGEBOX_PASSWORD" -T "$f" "$BASE$(enc "$DIR/$rel")" 2>/dev/null)
    case "$code" in 2*) echo "ok $rel"; return 0;; esac; sleep 3; done
  echo "FAIL $rel http=$code"; return 1; }
mkcols "$DIR"
n=0; bad=0
if [ "$MODE" = snapshot ]; then
  # pause snapshot: transcripts under their own names (+ manifest) and ~/.claude.json, so the
  # entrypoint can drop them straight back where claude looks (see session-image/entrypoint.sh)
  : > /tmp/manifest.txt
  for f in "$HOME"/.claude/projects/*/*.jsonl; do [ -f "$f" ] || continue; n=$((n+1)); put "$f" "$(basename "$f")" || bad=$((bad+1)); basename "$f" >> /tmp/manifest.txt; done
  [ -f "$HOME/.claude.json" ] && { n=$((n+1)); put "$HOME/.claude.json" claude.json || bad=$((bad+1)); }
  n=$((n+1)); put /tmp/manifest.txt manifest.txt || bad=$((bad+1))
else
  for f in "$HOME"/.claude/projects/*/*.jsonl; do [ -f "$f" ] || continue; n=$((n+1)); put "$f" "transcript-$(basename "$f")" || bad=$((bad+1)); done
  if [ -d "$HOME/artifacts" ]; then
    while IFS= read -r -d '' f; do n=$((n+1)); put "$HOME/artifacts/\${f#./}" "artifacts/\${f#./}" || bad=$((bad+1)); done < <(cd "$HOME/artifacts" && find -L . -type f -print0)
  fi
  printf '%s' "$META_JSON" > /tmp/session.json; n=$((n+1)); put /tmp/session.json session.json || bad=$((bad+1))
fi
echo "SUMMARY files=$n failed=$bad dir=$DIR"
[ "$bad" = 0 ]
`;

async function execUploader(machineId, dir, mode, metaJson) {
  const cmd = `export DIR=${JSON.stringify(dir)} MODE=${mode} META_JSON=${JSON.stringify(metaJson || "")}; ${SCRIPT}`;
  const r = await fly.exec(machineId, ["/usr/bin/sudo", "-u", "claude", "-H", "/bin/bash", "-lc", cmd], 600);
  const out = String(r.stdout || "");
  const summary = (out.match(/SUMMARY files=(\d+) failed=(\d+)/) || []);
  const files = out.split("\n").filter((l) => l.startsWith("ok ")).map((l) => l.slice(3));
  const failed = out.split("\n").filter((l) => l.startsWith("FAIL ") || l.startsWith("FATAL"));
  if (r.exit_code !== 0 || !summary.length || failed.length) {
    throw new Error(`${mode} to Storage Box failed: ${(failed[0] || String(r.stderr || "").slice(0, 200) || `exit ${r.exit_code}`)}`);
  }
  return { dir, files: files.length, uploaded: files };
}

async function run(machineId, meta) {
  const dir = dirName(meta);
  const metaJson = JSON.stringify({ ...meta, archiveDir: dir, destroyedAt: new Date().toISOString() });
  return execUploader(machineId, dir, "archive", metaJson);
}

// Pause snapshot (machine must be running). Overwrites the previous snapshot for this machine.
async function snapshot(machineId) {
  return execUploader(machineId, pausedDir(machineId), "snapshot");
}

// ---- WebDAV from the portal (for a paused machine, which can't be exec'd) -------------------
function dav(secrets) {
  const { STORAGEBOX_HOST: host, STORAGEBOX_USER: user, STORAGEBOX_PASSWORD: pass } = secrets || {};
  if (!host || !user || !pass) throw new Error("no STORAGEBOX_HOST/USER/PASSWORD in the session's environment");
  const base = `https://${host}/`;
  const url = (p) => base + p.split("/").map(encodeURIComponent).join("/");
  const headers = (extra) => ({ Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"), ...(extra || {}) });
  const req = async (method, p, extra, body) => {
    const r = await fetch(url(p), { method, headers: headers(extra), body });
    return r;
  };
  return {
    async mkcols(p) { let cur = ""; for (const seg of p.split("/").filter(Boolean)) { cur += seg + "/"; await req("MKCOL", cur); } },
    async get(p) { const r = await req("GET", p); return r.ok ? await r.text() : null; },
    async put(p, body) { const r = await req("PUT", p, { "Content-Type": "application/json" }, body); if (!r.ok) throw new Error(`PUT ${p} -> ${r.status}`); },
    async move(from, to) { const r = await req("MOVE", from, { Destination: url(to), Overwrite: "T" }); if (!r.ok && r.status !== 404) throw new Error(`MOVE ${from} -> ${r.status}`); return r.ok; },
    async del(p) { const r = await req("DELETE", p + "/"); return r.ok || r.status === 404; },
  };
}

// Destroying a PAUSED machine: its pause snapshot is the only record. Move the transcripts into
// the normal archive dir (named transcript-<id>.jsonl like run() would), write session.json,
// and remove the .paused folder. Returns the same shape as run(); null if there was no snapshot.
async function finalizePaused(secrets, meta) {
  const d = dav(secrets), src = pausedDir(meta.id), dir = dirName(meta);
  const manifest = await d.get(`${src}/manifest.txt`);
  if (manifest == null) return null;
  const names = manifest.split("\n").map((s) => s.trim()).filter(Boolean);
  await d.mkcols(dir);
  const uploaded = [];
  for (const n of names) if (await d.move(`${src}/${n}`, `${dir}/transcript-${n}`)) uploaded.push(`transcript-${n}`);
  const metaJson = JSON.stringify({ ...meta, archiveDir: dir, destroyedAt: new Date().toISOString(), fromPauseSnapshot: true });
  await d.put(`${dir}/session.json`, metaJson); uploaded.push("session.json");
  await d.del(src);
  return { dir, files: uploaded.length, uploaded };
}
// Destroying a RUNNING machine (archived from disk): drop any stale pause snapshot. Best effort.
async function clearPaused(secrets, machineId) {
  try { await dav(secrets).del(pausedDir(machineId)); } catch { /* best effort */ }
}

module.exports = { run, snapshot, finalizePaused, clearPaused, dirName, pausedDir };
