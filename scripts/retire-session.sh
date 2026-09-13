#!/usr/bin/env bash
# Retire THIS self-hosted session: verify every repo is committed+pushed and the record exists,
# then ask the portal to archive (transcripts + ~/artifacts -> Storage Box) and destroy this
# Fly machine. Skill: .claude/skills/retire-session/SKILL.md
#
#   scripts/retire-session.sh --check   # pre-flight only (what would block retirement)
#   scripts/retire-session.sh           # pre-flight, then fire the destroy (detached) and exit
#
# Only meaningful inside a portal-started session (Fly machine, runtime 3). The DELETE is fired
# with nohup because the machine — and this shell — disappear while the request is in flight.
set -u
PORTAL="${PORTAL_URL:-https://tunnel.deyaochen.com/t/portal}"; PORTAL="${PORTAL%/}"
ID="${FLY_MACHINE_ID:-$(hostname)}"
CHECK_ONLY=0; [ "${1:-}" = "--check" ] && CHECK_ONLY=1
fail() { echo "BLOCKED: $*" >&2; exit 1; }

[ -n "${FLY_MACHINE_ID:-}" ] || fail "not a self-hosted session (no FLY_MACHINE_ID) — on the Mac / a web pod upload records yourself (scripts/storagebox-upload.sh) instead"
[ -n "${CF_ACCESS_CLIENT_ID:-}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ] || fail "CF_ACCESS_CLIENT_ID/SECRET missing — the portal can't be reached from here"
H=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")

# 1. local git check: every repo under ~/workspace committed, on a branch with an upstream, pushed
blocked=0
for d in "$HOME"/workspace/*/; do
  d="${d%/}"; [ -d "$d/.git" ] || continue; name=$(basename "$d")
  git -C "$d" fetch -q 2>/dev/null || true
  dirty=$(git -C "$d" status --porcelain 2>/dev/null | wc -l)
  if git -C "$d" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then ahead=$(git -C "$d" rev-list '@{u}..HEAD' --count 2>/dev/null || echo 0); else ahead=-1; fi
  st="ok"
  [ "$dirty" -gt 0 ] && { st="$dirty uncommitted change(s)"; blocked=1; }
  [ "$ahead" -gt 0 ] && { st="$st, $ahead unpushed commit(s)"; blocked=1; }
  [ "$ahead" -lt 0 ] && { st="$st, branch has no upstream (push it: git push -u origin HEAD:main)"; blocked=1; }
  echo "repo $name: ${st#ok, }"
done
[ "$blocked" = 0 ] || fail "commit and push first (see above)"

# 2. the record the archive should carry
[ -s "$HOME/artifacts/record.md" ] || fail "~/artifacts/record.md missing — write the task record first (chronicle, result, support transcripts)"
echo "artifacts: $(find "$HOME/artifacts" -mindepth 1 | wc -l) entries under ~/artifacts (record.md present)"

# 3. the portal's own pre-destroy check for this machine (same one the dashboard runs)
ch=$(curl -sS -m 40 "${H[@]}" "$PORTAL/api/sessions/$ID/changes") || fail "portal unreachable"
echo "portal pre-destroy check: $ch"
python3 - "$ch" <<'PY' || fail "the portal still sees unpushed/uncommitted work"
import json,sys; c=json.loads(sys.argv[1])
bad=[r for r in c.get("repos",[]) if r.get("uncommitted",0) or r.get("unpushed",0)]
sys.exit(1 if bad else 0)
PY
[ "$CHECK_ONLY" = 1 ] && { echo "pre-flight OK — this session ($ID) can be retired"; exit 0; }

# 4. fire the destroy detached: the portal archives first (~10-60 s), then deletes the machine.
log=/tmp/retire-session.log
nohup curl -sS -m 900 "${H[@]}" -X DELETE "$PORTAL/api/sessions/$ID" >"$log" 2>&1 </dev/null &
disown
echo "destroy requested for session $ID — the portal is archiving to the Storage Box and will delete this machine shortly. Nothing more to do here."
