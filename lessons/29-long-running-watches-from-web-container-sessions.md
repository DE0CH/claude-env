## Long-running watches from web-container sessions (2026-08-21, 3HK queue chase)

- **Background Monitors/processes die when the container idles out, and their
  completion/timeout events do NOT re-wake a reclaimed container** — only server-side
  triggers (send_later / Routines) revive the session. A queue watch that must survive
  hours therefore needs a send_later heartbeat chain (~25 min) armed at all times
  alongside the in-container watcher; on each firing, verify the watcher is alive and
  re-arm. Skipping the deadman cost a 3h coverage gap over the lunch window (again).
- **The DIY portal remember-me cookie lasts ~24h, full stop** (revised 2026-08-22):
  the earlier clean-release-vs-timeout theory was disproven — a cleanly released
  session's cookie also died once ~28h had passed since the OTP login. Auto-login
  works within the same ~day of an OTP; after that, budget one fresh SMS OTP per day
  for any multi-day portal watch.
- 3HK 轉人工 queue observations so far: Wed ~13:05 HKT one pickup (missed, 2-3 min
  patience then auto-close); Wed afternoon/evening and Thu 07:40-10:48 HKT continuously
  "agents occupied" through hundreds of asks. The queue is near-unservable; treat any
  pickup as a one-shot event that the auto-reply watcher must catch.
