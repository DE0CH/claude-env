// Archive a session's records to the Hetzner Storage Box BEFORE it is destroyed — no AI
// involved. Runs a self-contained bash uploader inside the machine via Fly exec (the session
// already has STORAGEBOX_HOST/USER/PASSWORD in ~/.secrets and open egress), so nothing streams
// through the portal. Uploads:
//   transcript-<sessionId>.jsonl   every ~/.claude/projects/**/*.jsonl
//   artifacts/**                   everything under ~/artifacts (files or symlinks) — the mark
//   session.json                   id, title, environment, repos, created/destroyed timestamps
// into  claude-records/<yyyy-mm-dd> <title>/  (the naming convention from CLAUDE.md).
const fly = require("./fly");

function safeTitle(s, fallback) {
  const t = String(s || "").replace(/[\/\\:*?"<>|\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return t || fallback;
}
function dirName(meta) {
  const d = (meta.created ? new Date(meta.created) : new Date()).toISOString().slice(0, 10);
  return `claude-records/${d} ${safeTitle(meta.title, meta.machineName || meta.id)}`;
}

// bash: MKCOL each path segment (405 = exists), PUT with 3 retries, one "ok|FAIL <rel>" line per file
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
for f in "$HOME"/.claude/projects/*/*.jsonl; do [ -f "$f" ] || continue; n=$((n+1)); put "$f" "transcript-$(basename "$f")" || bad=$((bad+1)); done
if [ -d "$HOME/artifacts" ]; then
  while IFS= read -r -d '' f; do n=$((n+1)); put "$HOME/artifacts/\${f#./}" "artifacts/\${f#./}" || bad=$((bad+1)); done < <(cd "$HOME/artifacts" && find -L . -type f -print0)
fi
printf '%s' "$META_JSON" > /tmp/session.json; n=$((n+1)); put /tmp/session.json session.json || bad=$((bad+1))
echo "SUMMARY files=$n failed=$bad dir=$DIR"
[ "$bad" = 0 ]
`;

async function run(machineId, meta) {
  const dir = dirName(meta);
  const metaJson = JSON.stringify({ ...meta, archiveDir: dir, destroyedAt: new Date().toISOString() });
  const cmd = `export DIR=${JSON.stringify(dir)} META_JSON=${JSON.stringify(metaJson)}; ${SCRIPT}`;
  const r = await fly.exec(machineId, ["/usr/bin/sudo", "-u", "claude", "-H", "/bin/bash", "-lc", cmd], 600);
  const out = String(r.stdout || "");
  const summary = (out.match(/SUMMARY files=(\d+) failed=(\d+)/) || []);
  const files = out.split("\n").filter((l) => l.startsWith("ok ")).map((l) => l.slice(3));
  const failed = out.split("\n").filter((l) => l.startsWith("FAIL ") || l.startsWith("FATAL"));
  if (r.exit_code !== 0 || !summary.length || failed.length) {
    throw new Error(`archive to Storage Box failed: ${(failed[0] || String(r.stderr || "").slice(0, 200) || `exit ${r.exit_code}`)}`);
  }
  return { dir, files: files.length, uploaded: files };
}

module.exports = { run, dirName };
