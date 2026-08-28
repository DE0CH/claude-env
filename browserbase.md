# Browserbase persistent browser profile

## Session timeouts (lessons from 2026-08 Booking.com upgrade task)

- Timeout policy (per Deyao, 2026-08): keep `timeout: 3600` for quick scrape/fetch
  tasks, but use `timeout: 21600` (6 h — plan maximum, verified empirically) whenever
  the task is **interactive**: live-chat waits, OTP round-trips, or any
  human-in-the-loop delay. Decide at creation; it cannot be changed later.
- A running session's timeout **cannot be extended in place** — the sessions update
  API only accepts `status: REQUEST_RELEASE`. Plan the timeout at creation.
- **For flows gated by email-OTP verification (e.g. Booking.com booking access):
  always back the session with a persistent context + `persist: true`.** The
  verification cookie then survives browser death, and a replacement session resumes
  verified — without burning another OTP from a human. Task context for Booking.com:
  `9e119381-3407-4cf8-9d1a-fe4236d0d005` (created 2026-08-17; reuse for Booking.com
  tasks, do not use the personal logged-in contexts for this).
- Emergency fallback if a session is about to expire without a context: export
  cookies/localStorage over CDP (`Network.getAllCookies`) and re-import into the
  replacement session.

There is a persistent Browserbase **context** that stores my logged-in accounts
(cookies, localStorage, sessions). Reuse it whenever a task needs a browser that's
signed in as me — do NOT create a new context.

- **Context ID:** `c570c274-69c7-4b40-b550-5177982c13b4`
- **Project:** `8f2c3e0b-53ae-4425-828e-79e5fd52a180` (Production project)
- **Known logged-in accounts:** YouTube/Google. In a context-backed session youtube.com
  shows `LOGGED_IN: true` and bot-walled videos are playable.

## How to use it

Create sessions on top of the context. Pass `--persist` so any new logins/cookies
picked up during the session are saved back to the context:

```bash
browse cloud sessions create --context-id c570c274-69c7-4b40-b550-5177982c13b4 --persist --keep-alive --timeout 3600
```

Always pass `--timeout 3600` (1h) — the default ~5-minute timeout kills the session
(and its page state) while waiting on anything slow, like an OTP reply.

Then drive it with the `browse` CLI (`--session`/connect via the returned
`connectUrl`), Playwright over CDP, or whatever fits the task.

Notes:

- Only one session can use the context at a time.
- If I need to log in to a new site, create a keep-alive session with `--persist`,
  get the live view URL with `browse cloud sessions debug <session-id>`, and send
  me the `debuggerFullscreenUrl` so I can log in by hand.
- Release sessions when done (`browse cloud sessions update <id>` / let them expire)
  so the context isn't locked.
