# Browserbase sessions

> **No persistent logged-in ("privileged") context any more (Deyao, 2026-09-05).**
> There is no longer a shared Browserbase context that stays signed in as me across
> tasks. Do NOT assume any site is already logged in. When a task needs a signed-in
> browser, create a fresh context for that task, hand me the live view to log in by
> hand (see below), and `--persist` so that task's cookies survive within the task.

## Session timeouts (lessons from 2026-08 Booking.com upgrade task)

- Timeout policy (per Deyao, 2026-08): keep `timeout: 3600` for quick scrape/fetch
  tasks, but use `timeout: 21600` (6 h — plan maximum, verified empirically) whenever
  the task is **interactive**: live-chat waits, OTP round-trips, or any
  human-in-the-loop delay. Decide at creation; it cannot be changed later.
- A running session's timeout **cannot be extended in place** — the sessions update
  API only accepts `status: REQUEST_RELEASE`. Plan the timeout at creation.
- **For flows gated by email-OTP verification:** back the session with a
  persistent context you create for that task + `persist: true`. The verification
  cookie then survives browser death, and a replacement session resumes verified —
  without burning another OTP from a human.
- Emergency fallback if a session is about to expire without a context: export
  cookies/localStorage over CDP (`Network.getAllCookies`) and re-import into the
  replacement session.

## How to use it

Create a session (make your own context when you need cookies to persist within the
task). Pass `--persist` so logins/cookies picked up during the session are saved back
to that context:

```bash
browse cloud sessions create --persist --keep-alive --timeout 3600
```

Always pass `--timeout 3600` (1h) — the default ~5-minute timeout kills the session
(and its page state) while waiting on anything slow, like an OTP reply.

Then drive it with the `browse` CLI (`--session`/connect via the returned
`connectUrl`), Playwright over CDP, or whatever fits the task.

Notes:

- Only one session can use a given context at a time.
- If I need to log in to a site, create a keep-alive session with `--persist`,
  get the live view URL with `browse cloud sessions debug <session-id>`, and send
  me the `debuggerFullscreenUrl` so I can log in by hand.
- Release sessions when done (`browse cloud sessions update <id>` / let them expire)
  so the context isn't locked.

## Account / usage check (2026-09-15)

`GET https://api.browserbase.com/v1/projects` (header `X-BB-API-Key: $BROWSERBASE_API_KEY`) lists the
project (id `8f2c3e0b-53ae-4425-828e-79e5fd52a180`, "Production project", concurrency 25);
`GET /v1/projects/<id>/usage` returns `{browserMinutes, proxyBytes}` for the billing period. The plan
tier / remaining quota is NOT exposed by the API — the only test is creating a session (a 402 means
recharge/upgrade; ping Deyao per the Tools policy). Session creation from a pod:
`POST /v1/sessions {"projectId":…, "timeout":900, "proxies":[{"type":"browserbase","geolocation":{"country":"GB"}}],
"browserSettings":{"solveCaptchas":true}}` → `connectUrl` for Playwright `connect_over_cdp`; release with
`POST /v1/sessions/<id> {"projectId":…,"status":"REQUEST_RELEASE"}`. Passed Cathay Pacific's Akamai wall
that blocks every pod-local browser (lessons/42).
