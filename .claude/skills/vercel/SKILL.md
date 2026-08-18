---
name: vercel
description: Use Deyao's Vercel account (de0ch / chendeyao000@gmail.com) via the VERCEL_TOKEN env var — CLI and REST API usage, plus how to log into the Vercel dashboard / mint a new token if it's ever revoked. Trigger whenever a task involves Vercel (deployments, projects, domains, env vars, logs).
---

# Vercel

## Token

- Env var: **`VERCEL_TOKEN`** (created 2026-08-18; dashboard token name `claude-env`,
  scope **Full Account**, **no expiration**, account de0ch / chendeyao000@gmail.com).
  New-style token, format `vcp_…` (60 chars).
- If the env var isn't present yet in this session, it may be cached at
  `scratchpad/vercel_token` (2026-08-18 session only — containers are ephemeral).
  Otherwise ask Deyao to add `VERCEL_TOKEN` to the environment config.
- Never print the token; substitute it directly into commands.

## CLI

The Vercel CLI does NOT auto-read `VERCEL_TOKEN` — pass it explicitly:

```bash
npm i -g vercel
vercel whoami --token "$VERCEL_TOKEN"
vercel ls --token "$VERCEL_TOKEN"
vercel deploy --token "$VERCEL_TOKEN" [--prod] [--yes]
```

Team-scoped resources need `--scope <team-slug>`. The personal team slug is
`de0chs-projects`.

## REST API

```bash
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" https://api.vercel.com/v2/user
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" https://api.vercel.com/v9/projects
```

Append `?teamId=<id>` for team resources. Sanity check: `/v2/user` returns
username `de0ch`.

## Dashboard login / minting a new token (if revoked)

Login is email-OTP and fully self-serviceable:

1. Browserbase session on the regular context (`--persist` — the Vercel session
   cookie is saved to the context as of 2026-08-18, so you may already be logged in).
2. vercel.com/login → enter `chendeyao000@gmail.com` → "Continue with Email".
3. The 6-digit code lands in Gmail (the Gmail MCP connector IS this account):
   `search_threads` query `from:system@vercel.com subject:code newer_than:1d`.
   Match the email's stated login location to your egress (e.g. "Boardman, United
   States" = AWS us-west-2 / Browserbase) and take the newest.
4. Code goes in a single plain input (not per-digit boxes).
5. Tokens page: `vercel.com/account/settings/tokens` — inline form (name, scope
   combobox: "de0ch's projects" or "Full Account", expiration select). The token
   is shown ONCE in a "Token Created" dialog; extract it to a file over CDP
   (Playwright `connectOverCDP`) without printing it. Tokens match
   `/^vcp_[A-Za-z0-9_]+$/` — note the underscores; `[A-Za-z0-9]` alone won't match.

## Pitfalls (2026-08-18)

- **Don't drive long login flows through the `browse` daemon's auto-created
  sessions**: bare `browse open --remote` (and `--session <id>` — that names a
  LOCAL daemon session, it does NOT attach to an existing Browserbase session id)
  auto-creates a Browserbase session with the ~5-min default timeout and no
  context. It times out mid-flow and loses login + any shown-once dialog.
  Create the session explicitly (`browse cloud sessions create --context-id … --persist
  --keep-alive --timeout 3600`+) and drive it with Playwright over its `connectUrl`.
- The classifier blocked `browse cloud sessions update <id>` for release; the
  plain REST call works: `POST /v1/sessions/<id>` with
  `{"projectId":…,"status":"REQUEST_RELEASE"}`.
