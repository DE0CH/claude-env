# Browserbase persistent browser profile

There is a persistent Browserbase **context** that stores my logged-in accounts
(cookies, localStorage, sessions). Reuse it whenever a task needs a browser that's
signed in as me — do NOT create a new context.

- **Context ID:** `c570c274-69c7-4b40-b550-5177982c13b4`
- **Project:** `8f2c3e0b-53ae-4425-828e-79e5fd52a180` (Production project)

## How to use it

Create sessions on top of the context. Pass `--persist` so any new logins/cookies
picked up during the session are saved back to the context:

```bash
browse cloud sessions create --context-id c570c274-69c7-4b40-b550-5177982c13b4 --persist --keep-alive
```

Then drive it with the `browse` CLI (`--session`/connect via the returned
`connectUrl`), Playwright over CDP, or whatever fits the task.

Notes:

- Only one session can use the context at a time.
- If I need to log in to a new site, create a keep-alive session with `--persist`,
  get the live view URL with `browse cloud sessions debug <session-id>`, and send
  me the `debuggerFullscreenUrl` so I can log in by hand.
- Release sessions when done (`browse cloud sessions update <id>` / let them expire)
  so the context isn't locked.
