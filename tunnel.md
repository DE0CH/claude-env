# Local content + private-drop tunnel (cf-tunnel)

Purpose: two things, usually together.

1. **Content out** — Deyao asks for an HTML explanation/report/demo; build it as
   local files, serve them, and hand him a URL.
2. **Private data in** — Deyao needs to give me data that must NOT end up in the
   chat transcript (keys, tokens, personal data). He submits it through a web
   form; it lands on the runner's local disk where I can use it without ever
   printing it.

The public URL is provided by `cf-tunnel/` — a Cloudflare Worker fronted by
Cloudflare Access — so it works from Claude-on-the-web containers (where the
egress gateway blocks cloudflared-style connectors) and is private.

## The local content server

`scripts/content-server.py` (stdlib only, binds 127.0.0.1):

- serves `~/tunnel-share` (override `--dir`) — put the HTML content there
- `GET /drop` is a form (label + textarea + file upload); submissions are
  written to `~/drop/` (override `--drop`) as `YYYYMMDD-HHMMSS-<label>-<rand>`
  files, mode 0600, outside any repo
- it prints only saved *filenames*, never contents
- optional `--token <t>` adds an unguessable path prefix; with cf-tunnel the
  Cloudflare Access layer already gates every request, so a token isn't needed

### Handling dropped data — transcript hygiene

The whole point is that dropped data never appears in the transcript:

- **Never** `cat`/`head`/print a drop file or echo its value.
- Refer to drops by filename; check arrival with `ls ~/drop`.
- Use values by file reference: `export API_KEY=$(cat ~/drop/<file>)` inside the
  command that needs it, `curl -H @-`, `--data @file`, etc. — fine as long as
  the command's *output* doesn't echo the secret.
- If unsure a command will echo it back, redirect output to a file and inspect
  with grep for what you need rather than dumping it.
- Drops persist in `~/drop` — delete them when the task is done.

## cf-tunnel: a private, Access-gated tunnel that works from web containers

`cf-tunnel/` is a Cloudflare Worker that tunnels into the container. cloudflared
cannot connect from a Claude-on-the-web container (its edge is port 7844, which
the Anthropic egress gateway blocks); the gateway only relays HTTP(S)/WebSocket
on 443, so the Worker uses a WebSocket-on-443 transport instead (verified with a
full WS data roundtrip).

How it works: a Worker + Durable Object (`cf-tunnel/worker.js`) holds a
WebSocket opened *outbound* by a container agent (`cf-tunnel/agent.js`); every
HTTP request to the Worker is forwarded over that socket to the local
`content-server.py` and the response streamed back. **Cloudflare Access** sits
in front of the public hostname `tunnel.deyaochen.com`, so only Deyao's email
gets in via the browser; the agent authenticates with an Access **service
token** (no login).

### Secrets live in the environment, not files

The container is ephemeral: a new session finds nothing that isn't in the git
repo, so credentials come from **environment variables** (set once in the CCR
environment config, like `LOBSTER_TOKEN`):

- `CLOUDFLARE_API` — the Cloudflare API token (used only to run `deploy.sh`).
- `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` — the Access service token
  the agent uses every session. `deploy.sh` mints these and tells you to add
  them to the environment config.

### One-time deploy (already done; re-run only to re-provision)

`CLOUDFLARE_API` must be a token with: Account Workers Scripts **Edit**,
Access: Apps and Policies **Edit**, Access: Service Tokens **Edit**, Account
Settings **Read**; Zone `deyaochen.com` DNS **Edit**, Workers Routes **Edit**,
Zone **Read**. Then:

```bash
cd cf-tunnel && ./deploy.sh
```

`deploy.sh` reads `CLOUDFLARE_API` (falls back to `~/drop/cftoken`), deploys the
Worker, points `tunnel.deyaochen.com` at it (proxied DNS record + Worker route),
creates the Access app with a policy for Deyao's email and one for the agent's
service token, mints the service token, and writes its creds to
`~/drop/service-token` (0600, secret kept out of stdout). Add the two printed
`CF_ACCESS_*` vars to the environment config. Idempotent on re-run. Account id
`ee3b4deef856baf11e1a67b242438325`, zone id
`f51ca95ee5e6c664372000f887c96a92` are baked in.

### Each session (serve content through the tunnel)

The agent reads `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` from the
environment (and defaults `wss://tunnel.deyaochen.com/__agent` +
`http://127.0.0.1:8899`), so bring-up is just:

```bash
# content in ~/tunnel-share, drops land in ~/drop
python3 scripts/content-server.py --port 8899 &
# agent — no file needed; creds come from the environment
node cf-tunnel/agent.js &
# the private URL is always https://tunnel.deyaochen.com/
# Deyao logs in via Cloudflare Access once per device; discord him the link.
```

(If the `CF_ACCESS_*` vars aren't in the environment yet — e.g. before they've
been added to the config — source `~/drop/service-token` from the last deploy,
or re-run `deploy.sh`.)

Deyao logs in the first time on each device via Cloudflare Access: visiting
`https://tunnel.deyaochen.com/` redirects to a one-time-PIN prompt, the PIN goes
to chendeyao000@gmail.com (the only allowed identity), and the session lasts
24h. Unauthenticated requests get a 302 to the login — verified. The container
agent skips all this with its Access service token.

The `content-server.py` and `agent.js` processes live in the ephemeral
container, so they must be restarted each session (the deploy — Worker, route,
Access — is one-time and persists on Cloudflare). The Worker returns 503 when
the agent isn't connected.

### Stale agent from a previous session (verified 2026-08-13)

Only one agent can hold the tunnel: when a new agent connects, the Worker
closes the old socket with `1012 replaced`. But container reclaim is lazy — a
finished session's container (and its `agent.js`) can stay alive for hours, and
since both agents auto-reconnect they fight forever: the agent log ping-pongs
`connected` / `closed (1012 replaced)` every few seconds and the public URL
alternates between the old and new containers' content. The agent prints a
hint after 3 such closes.

Fix: find the old session with `list_sessions` (claude-code-remote MCP) and
`archive_session` it — that releases its container (reversible via
`unarchive_session`). Reclaim takes a few minutes and the Worker may report
`{"agent":true}` on a half-open socket from the dead container meanwhile
(requests then return "tunnel agent timed out"); just (re)start the local
agent — it replaces the dead socket and everything settles.

### Gotchas learned building this (don't re-derive)

- The Workers Custom Domains API (`PUT /accounts/…/workers/domains`) returns a
  10000 auth error even with Workers Scripts:Edit — `deploy.sh` uses a proxied
  DNS record + a Worker route instead (needs DNS:Edit + Workers Routes:Edit).
- An Access service-token policy needs the token's **UUID** (`.result.id`),
  NOT its `client_id`, in `include[].service_token.token_id` — else you get
  `invalid 'include' configuration` (12130).
- Cloudflare API mutations from the logged-in dashboard are CSRF-blocked (403),
  and the token-permission dropdowns are react-select widgets painful to drive
  via the accessibility tree — so create the API token in a real browser and
  drop it, rather than automating the dashboard.
- Background processes started with `&` inside a single Claude Code Bash call do
  not survive to the next call; run them as detached/background tasks.

## Fallbacks (no tunnel)

- **Content out**: publish an Artifact (private claude.ai page) or send the HTML
  file directly in chat — both first-class, no tunnel needed.
- **Private data in**: piping-server relay (verified working):
  1. I run `curl -s https://ppng.io/<random-long-path> -o ~/drop/<name>`
     (blocks until data arrives; contents go straight to disk, not transcript).
  2. Discord Deyao the path. He opens https://ppng.io in a browser, enters the
     same path, pastes text or picks a file, hits Send — or from a terminal:
     `curl -T file https://ppng.io/<random-long-path>`.
  3. Same transcript hygiene rules as above. ppng.io is a third-party relay
     (streaming, not stored) — prefer it only for medium-sensitivity data.
