---
name: vercel
description: Use Deyao's Vercel account (de0ch / chendeyao000@gmail.com) via the VERCEL_TOKEN env var — CLI and REST API usage, showing HTML reports/demos to Deyao via a per-session de0ch-claude-… project (NEVER Claude Artifacts), plus how to log into the Vercel dashboard / mint a new token if it's ever revoked. Trigger whenever a task involves Vercel (deployments, projects, domains, env vars, logs) or needs to show Deyao any HTML page/report/demo.
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

## Showing content to Deyao — Vercel, NOT Claude Artifacts

Standing rule (Deyao, 2026-08-18): when a task needs to show an HTML page, report,
or demo, **never publish a Claude Artifact** — deploy it to Vercel and Discord the
URL. **Each session uses its own fresh project named `de0ch-claude-<short-session-id>`**
(first 8 chars of `CLAUDE_CODE_SESSION_ID`); don't reuse another session's project.

Proven flow (2026-08-18, project `de0ch-claude-9c79698b`):

```bash
SID="${CLAUDE_CODE_SESSION_ID%%-*}"          # first segment, e.g. 9c79698b
DIR="$SCRATCHPAD/de0ch-claude-$SID"          # dir name == project name
mkdir -p "$DIR"                              # put index.html (+assets) in it
cd "$DIR" && vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

- The CLI auto-creates the project from the **directory name** — no `vercel link`
  or API project-create needed. `--prod` matters: production deployments are
  public, while preview deployments sit behind Vercel Authentication by default.
- The stable URL is the auto-alias **`https://de0ch-claude-<sid>.vercel.app`**
  (printed as "Aliased"; the long `…-<hash>-de0chs-projects.vercel.app` URL is
  per-deployment). Verify with `curl -s -o /dev/null -w '%{http_code}'` = 200,
  then send Deyao the alias URL on Discord.
- Re-deploying the same directory updates the same project/alias — iterate freely
  within a session.
- These pages are **public** (unlisted but no auth). For sensitive content or
  private data drops (credentials, 2FA), keep using the cf-tunnel flow
  (Cloudflare Access-gated) per CLAUDE.md — Vercel is for showing, not for
  collecting secrets.

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

1. Open a browser you can drive over CDP — claude-in-chrome on the Mac, or a
   mobilerun cloud phone's Chrome (there is no shared logged-in context —
   assume you are logged out and log in fresh via email-OTP below).
2. vercel.com/login → enter `chendeyao000@gmail.com` → "Continue with Email".
3. The 6-digit code lands in Gmail (the Gmail MCP connector IS this account):
   `search_threads` query `from:system@vercel.com subject:code newer_than:1d`.
   Match the email's stated login location to your browser's egress IP (the
   proxy country on a mobilerun device, or the Mac's location) and take the newest.
4. Code goes in a single plain input (not per-digit boxes).
5. Tokens page: `vercel.com/account/settings/tokens` — inline form (name, scope
   combobox: "de0ch's projects" or "Full Account", expiration select). The token
   is shown ONCE in a "Token Created" dialog; extract it to a file over CDP
   (Playwright `connectOverCDP`) without printing it. Tokens match
   `/^vcp_[A-Za-z0-9_]+$/` — note the underscores; `[A-Za-z0-9]` alone won't match.

## Pitfalls (2026-08-18)

- **Don't drive the login flow through a short-lived browser**: the OTP
  round-trip and the shown-once "Token Created" dialog need one persistent page.
  Keep a single long-lived CDP connection (Playwright `connectOverCDP` to the
  device/Mac Chrome) for the whole flow, and extract the token in that same page.
