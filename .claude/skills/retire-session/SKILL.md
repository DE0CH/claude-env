---
name: retire-session
description: End the current self-hosted session cleanly — commit and push every repo, put the task record and artefacts under ~/artifacts, then call the portal to archive and destroy this Fly machine. Use when Deyao says /retire-session, "retire/close/destroy this session", "we're done here, clean up", or a task is finished and the session should go away. Self-hosted (portal-started) sessions only.
---

# /retire-session — clean up and destroy the current session

The portal's Destroy button, driven from inside the session. Order matters: everything you
want to survive must be in git or under `~/artifacts` **before** the destroy call — the
machine disappears while the request is in flight, so anything written after it may never
land.

**Do NOT Discord Deyao when retiring (Deyao, 2026-09-14).** No final summary DM, no
"records will land at…" ping — retiring is silent. The records go to the Storage Box and
the one-line chat reply in step 4 is all he needs.

## Steps

1. **Finish and push every repo** under `~/workspace` (CLAUDE.md Git rules: commit to `main`,
   no feature branches unless asked; on a non-fast-forward `git pull --rebase origin main` then
   `git push origin HEAD:main`). Nothing may stay uncommitted or unpushed — the script refuses
   otherwise. Dirty state you deliberately don't want to keep: `git checkout -- .`/`git clean`
   it away, don't leave it for the archive.
2. **Records under `~/artifacts/`** (the portal archives this dir + every transcript, no AI
   involved): `~/artifacts/record.md` (chronicle of actions with outcomes, result summary, any
   support-chat transcript in full), plus screenshots / generated files (copy or symlink).
   Anything that can't be copied — list its location/URL in `record.md`.
3. **Pre-flight, then destroy:**
   ```bash
   scripts/retire-session.sh --check   # lists what would block; fix and re-run
   scripts/retire-session.sh           # fires DELETE /api/sessions/<this machine> detached
   ```
   The script identifies the session by `FLY_MACHINE_ID`, re-runs the portal's own
   pre-destroy check (`GET /api/sessions/:id/changes`) and only then fires the DELETE with
   `nohup` (the shell dies with the machine). The portal uploads transcripts + `~/artifacts`
   to the Storage Box (~10–60 s) and deletes the machine; if the upload fails it keeps the
   machine and Deyao sees "destroy anyway" on the dashboard.
4. Reply with one line ("retiring — records go to claude-records/<date> <title>") and stop.
   Don't start new work, background tasks, or watchers after the call.

## Pitfalls

- Not a self-hosted session (Mac, Claude-on-the-web pod)? There is no portal machine to
  destroy: upload the records yourself with `scripts/storagebox-upload.sh` instead (CLAUDE.md
  "End-of-task records").
- Background tasks still running inside the session are killed with it — wait for or stop
  anything that still matters (and never leave a watcher expecting a wake-up).
- The transcript is archived as it is on disk at that moment, so write `record.md` before
  running the script, not after.
- `--check` output `branch has no upstream` = pushed to nothing; `git push -u origin HEAD:main`.
