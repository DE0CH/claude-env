# Portal API

Base URL: `https://tunnel.deyaochen.com/t/portal` (Cloudflare Access in front). The dashboard
(`portal/public/index.html`) is a static page that uses nothing but these endpoints.

**Auth.** Cloudflare Access gates the hostname. From a browser: your Google login. From a
program: the Access service token — send both headers on every request:

```
CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID
CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET
```

Both values are in the `default` environment's secrets (so every session has them in its
environment) and in Deyao's password manager. The portal additionally rejects any request whose
`Cf-Access-Authenticated-User-Email` (set by Access for browser logins) isn't the allowed email.

```bash
H=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")
curl -sS "${H[@]}" https://tunnel.deyaochen.com/t/portal/api/state
```

All bodies are JSON; errors are `{"error": "..."}` with a 4xx/5xx status.

## State

| method | path | notes |
|---|---|---|
| GET | `/api/health` | `{ok, version}` — no cluster/Fly calls |
| GET | `/api/state` | everything the dashboard shows: `environments` (key NAMES only, never values), `repos`, `sessions` (Fly machine + live claude status/title), `sessionImage`, `imageBuild`, `hasCreds`, `creds` (`expiresAt`, `expired`, `stale`, `error`, `subscriptionType`), `auth` |
| GET | `/api/sizes` | machine sizes (`{sizes:{small,medium,…}, default}`) |

## Sessions (Fly Machines running `claude --remote-control`)

| method | path | body / notes |
|---|---|---|
| POST | `/api/sessions` | `{environment, repos:[name…], label?, permissionMode: "auto"\|"bypass", size?, prompt?}` → `{ok,id,name,label,state,size,hasPrompt}`. `prompt` (optional, multi-line ok, ≤16000 chars) is pasted into the session as its first message once `claude` is up, so it starts working without waiting for the app. Refreshes the stored Claude credentials first; **409 `{needLogin:true}`** when the login is dead (Re-login in Settings) |
| GET | `/api/sessions/:id/changes` | pre-destroy check: uncommitted/unpushed work per repo inside the session |
| DELETE | `/api/sessions/:id` | archives transcripts + `~/artifacts` to the Storage Box, then deletes the machine (`?force=1` = destroy even if the archive failed) |
| POST | `/api/sessions/:id/relogin` | fix a session stuck on "Login expired · Please run /login": refreshes the stored pair if needed, writes it over the session's `~/.claude/.credentials.json`, then types `continue` + Enter into its terminal. Body `{text?}` overrides the prompt (`false` = write only). **409 `{needLogin:true}`** when the stored login itself is dead |
| POST | `/api/sessions/:id/stop`, `/start` | stop / start the Fly machine |
| GET | `/api/sessions/:id/tty` | SSE stream of the session's tmux screen (`event: frame`) |
| GET | `/api/sessions/:id/tty/frame` | one snapshot `{screen,x,y,cols,rows}` |
| POST | `/api/sessions/:id/tty/input` | `{text}` or `{key}` (Enter, Escape, Tab, Up, C-c, …) |
| POST | `/api/sessions/:id/tty/resize` | `{cols, rows}` |

## Environments (named secret sets, SOPS-encrypted in git)

| method | path | body / notes |
|---|---|---|
| POST | `/api/environments` | `{name, secrets:{KEY:"value", KEY2:""}}` — merge; empty string deletes a key. Commits `env-<name>.sops.yaml` and applies |
| DELETE | `/api/environments/:name` | |

## Repos

| method | path | body / notes |
|---|---|---|
| POST | `/api/repos` | `{url, name?}` |
| DELETE | `/api/repos/:name` | |
| GET | `/api/github/repos` | every repo the portal's `GITHUB_TOKEN` can see (picker source); 5-min cache, `?refresh=1` |

## Claude credentials

| method | path | body / notes |
|---|---|---|
| POST | `/api/credentials` | `{credentials: <contents of ~/.claude/.credentials.json>, account?: <{oauthAccount,userID}>}` — stored only if its `expiresAt` is later than the stored pair's (`{stored:true\|false}`). Sessions call this automatically (`push-claude-credentials`) |
| POST | `/api/credentials/refresh` | refresh the stored pair now via the OAuth refresh token → `{ok, refreshed, expiresAt}`; **409 `{needLogin:true}`** if rejected |
| POST | `/api/auth/start` | begin Re-login: runs `claude auth login` on the controller → `{url}` |
| POST | `/api/auth/code` | `{code}` pasted from the browser → stores the new credentials |
| GET | `/api/auth/status` | `{inProgress, url, startedAt}` |

## Session image

| method | path | notes |
|---|---|---|
| POST | `/api/image/rebuild` | build `selfhost/session-image` on Fly's remote builder (from the portal's own checkout of `main`) |
| GET | `/api/image/build` | `{running, ok, image, startedAt, log}`; `ok:null,image:null` = job record lost (portal pod restarted mid-build) |
