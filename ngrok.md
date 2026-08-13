# ngrok + local content workflow

Purpose: two things, usually together.

1. **Content out** — Deyao asks for an HTML explanation/report/demo; build it as
   local files, serve them, and hand him a URL.
2. **Private data in** — Deyao needs to give me data that must NOT end up in the
   chat transcript (keys, tokens, personal data). He submits it through a web
   form; it lands on the runner's local disk where I can use it without ever
   printing it.

## Setup

- The ngrok authtoken is in the env var `NGORK_API` (note the typo: NG**OR**K).
  `setup.sh` installs ngrok and runs `ngrok config add-authtoken "$NGORK_API"`.
- Free plan: random `*.ngrok-free.app` URL each run, one agent session at a
  time, and visitors see a one-click "Visit Site" interstitial in the browser
  (programmatic clients skip it with the header `ngrok-skip-browser-warning: 1`).

## The workflow (Mac or normal pods)

```bash
# 1. put content in ~/ngrok-share (index.html etc.)
mkdir -p ~/ngrok-share

# 2. start the local server with a random URL token
TOKEN=$(openssl rand -hex 8)
python3 scripts/content-server.py --port 8899 --token "$TOKEN" &

# 3. tunnel it
ngrok http 8899 &
sleep 3
URL=$(curl -s http://127.0.0.1:4040/api/tunnels | jq -r '.tunnels[0].public_url')

# 4. discord Deyao the links (lobster.md)
#    content:  $URL/$TOKEN/
#    drop form: $URL/$TOKEN/drop
```

`scripts/content-server.py` (stdlib only, binds 127.0.0.1):

- serves `~/ngrok-share` (override `--dir`) — put the HTML content there
- `GET /<token>/drop` is a form (label + textarea + file upload);
  submissions are written to `~/drop/` (override `--drop`) as
  `YYYYMMDD-HHMMSS-<label>-<rand>` files, mode 0600, outside any repo
- it prints only saved *filenames*, never contents
- the `--token` path prefix keeps the tunnel URL unguessable even while the
  ngrok URL is known; everything else 404s

When done: kill both processes (free plan allows only one agent session, so a
leftover ngrok blocks the next run).

### Handling dropped data — transcript hygiene

The whole point is that dropped data never appears in the transcript:

- **Never** `cat`/`head`/print a drop file or echo its value.
- Refer to drops by filename; check arrival with `ls ~/drop`.
- Use values by file reference: `export API_KEY=$(cat ~/drop/<file>)` inside the
  command that needs it, `curl -H @-`, `--data @file`, etc. — fine as long as
  the command's *output* doesn't echo the secret.
- If unsure a command will echo it back, redirect output to a file and inspect
  with grep for what you need rather than dumping it.
- On the Mac, drops persist in `~/drop` — delete them when the task is done.

## Claude-on-the-web containers: ngrok does NOT work (verified 2026-08)

The Anthropic egress gateway MITMs all outbound TLS (even with proxy env vars
unset — interception is transparent) and only relays **HTTP(S)/WebSocket on
port 443**. Consequences, all tested — don't burn time retrying:

- **ngrok agent**: with `HTTPS_PROXY` set → `ERR_NGROK_9009` (agent-behind-proxy
  is a paid feature); without it → the gateway accepts the TLS but kills the
  session because ngrok's muxado protocol isn't HTTP. Dead on any plan.
- **cloudflared quick tunnel**: dials port 7844 (QUIC and TCP) — blocked.
- **tunnelmole**: WSS on port 8083 — non-443 CONNECTs get reset.
- **devtunnel (Microsoft)**: partially blocked (403s from the gateway).

Fallbacks that DO work from the container:

- **Content out**: publish an Artifact (private claude.ai page) or send the
  HTML file directly in chat — both first-class, no tunnel needed.
- **Private data in**: piping-server relay (verified working):
  1. I run `curl -s https://ppng.io/<random-long-path> -o ~/drop/<name>`
     (blocks until data arrives; contents go straight to disk, not transcript).
  2. Discord Deyao the path. He opens https://ppng.io in a browser, enters the
     same path, pastes text or picks a file, hits Send — or from a terminal:
     `curl -T file https://ppng.io/<random-long-path>`.
  3. Same transcript hygiene rules as above. Note ppng.io is a third-party
     relay (streaming, not stored, but still: prefer it for medium-sensitivity
     data; for highly sensitive secrets prefer a Mac session with ngrok).

## GitHub workspace pods

Normal pods have unrestricted egress — the full ngrok workflow should work
there as-is (`setup.sh` installs ngrok). If a pod turns out to be egress-
filtered like the Claude container, fall back per the section above.
