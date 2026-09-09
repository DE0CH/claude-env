---
name: hetzner-exec-box
description: >
  A small persistent Hetzner box that runs arbitrary shell commands over an
  HTTPS REST API (POST /exec, structured JSON out), gated by a single API key.
  Use it to give a network-restricted environment (chiefly the Claude web/pod
  egress gateway, which only allows HTTPS/443) capabilities it lacks: outbound
  SSH to any host, arbitrary ports, a mutable Debian workspace with full tools.
  Trigger whenever a task needs to run commands / SSH / open ports from a real
  unrestricted machine, mentions "exec box" / hexec, or the box needs
  rebuilding, resizing, or its key rotated.
---

# Hetzner exec box (`hexec`)

A €5.49/mo Hetzner Cloud VM running **Flatcar Container Linux** (immutable /
stateless OS) that exposes a tiny **command-executor over HTTPS**. It exists to
lend an unrestricted Linux machine to environments whose network is boxed in.

## Why it exists

The **Claude web/pod** egress gateway only relays HTTP(S)/WSS on **443** — no
outbound SSH, no arbitrary ports (see `lessons/12`). The box has a normal,
unrestricted German egress and its API listens on **443**, so it's reachable
from there. `POST /exec` = a shell on a machine that can SSH anywhere, hit any
port, and run any tool.

## Current deployment (2026-09-09)

| Thing | Value |
|---|---|
| Endpoint | `https://hexec.deyaochen.com/exec` (health: `/health`) |
| IPv4 | `2.28.17.142` |
| Hetzner server id | `165310923` (name `hexec`, type **cx23**, fsn1) |
| OS | Flatcar stable (immutable); snapshot image id **`429946739`** |
| Auth | header **`X-API-Key: <key>`** — key is in `~/.secrets` / pod env as **`HEXEC_KEY`** (also DM'd via lobster). 256-bit hex. |
| DNS | Cloudflare zone `deyaochen.com` (`f51ca95ee5e6c664372000f887c96a92`), A record `hexec` → IP, **DNS-only / grey-cloud** (NOT the CF proxy, NOT Access) |
| Debug SSH | `ssh core@2.28.17.142`. Authorized `core` keys: Deyao's key + the jump server's `id_ed25519`. To change, edit `files/butane.yaml` under `passwd.users` and rebuild (or drop a file in `/home/core/.ssh/authorized_keys.d/` + `update-ssh-keys`). |

Env vars to set for consumers (Mac `~/.secrets` and the pod environment):

```
HEXEC_URL=https://hexec.deyaochen.com
HEXEC_KEY=<the 64-hex key>
```

## Calling it

```bash
# JSON form (preferred): cmd + optional cwd + optional timeout(s, default 900)
curl -s -H "X-API-Key: $HEXEC_KEY" -H 'Content-Type: application/json' \
  -d '{"cmd":"uname -a; whoami","cwd":"/root/work","timeout":120}' \
  "$HEXEC_URL/exec"
# -> {"exit":0,"stdout":"...","stderr":"..."}

# Raw form: any non-JSON body is treated as a bash script
curl -s -H "X-API-Key: $HEXEC_KEY" --data-binary @script.sh "$HEXEC_URL/exec"
```

- Commands run as **root** inside a long-lived **Debian** container (`--network
  host`), via `bash -lc`. Working dir defaults to `/root/work` (persisted on the
  host's `/var/lib/exec-work`).
- `apt-get install ...` at runtime works and **persists until the container is
  recreated** (a service restart / reboot recreates it clean — see statelessness
  below). Files under `/root/work` survive reboots; a full box rebuild resets
  everything.

## Usage policy — proxy/relay, NOT a compute box (Deyao, 2026-09-09)

`hexec` is a **lightweight proxy and control-plane relay**. Do **not** run real
compute on it (no browser automation, no heavy/long jobs, no big builds). Its
job is to lend the pod *network reach*, not CPU.

Decision order when the pod can't reach something (e.g. a SOCKS/HTTP proxy the
pod's 443-only egress can't dial):

1. **Chain/relay through `hexec`** into a form the pod *can* use over 443 — e.g.
   have `hexec` reach the upstream proxy and re-expose it, or forward a port,
   so the pod connects to `hexec` and the traffic is chained onward. Prefer this.
2. **If that isn't possible, allocate a *separate* Hetzner box** for the actual
   compute (e.g. run Playwright/Chromium there) and **drive that box via
   `hexec`** (`hexec` SSHes to it / sends commands). Keep the compute off
   `hexec`.

Rationale: `hexec` is a small, shared, always-on relay; keeping it stateless and
unloaded means it stays reliable and disposable.

## Architecture (what's on the box)

Flatcar host (immutable, no package manager) runs two containers via systemd
units baked in by **Ignition** (`files/butane.yaml` → ignition user_data):

1. **`workspace.service`** — `debian:stable`, host network, runs
   `files/workspace-init.sh` which installs a baseline toolset
   (python3, openssh-client, curl, git, jq, rsync, …) then runs
   `files/server.py`, the executor, on `127.0.0.1:8080`.
2. **`caddy.service`** — `caddy:2`, host network, `files/Caddyfile` (built from
   `Caddyfile.tmpl` with the key substituted). Terminates TLS on :443 (Let's
   Encrypt, HTTP-01 on :80), checks `X-API-Key` exactly, and reverse-proxies
   authorized requests to `127.0.0.1:8080`. Certs persist on `/var/lib/caddy`.

**Statelessness:** the OS is Flatcar (read-only, immutable). Both containers run
`--rm`, so every restart/reboot gives a clean workspace (re-pulls images,
re-installs the baseline). Only `/var/lib/exec-work` (`/root/work`) and the Caddy
cert store persist across reboots. A full rebuild from the snapshot resets the
entire box — that's the intended "disposable" model.

## Rebuild / recreate the box

Everything is scripted. From the **Mac** (needs `HETZNER_API`, `CLOUDFLARE_API`
in `~/.secrets`; `butane`, `jq`, `openssl`, `curl` installed):

```bash
.claude/skills/hetzner-exec-box/rebuild.sh
```

It: reuses/creates the key file, renders the Caddyfile, runs `butane` →
`ignition.json`, deletes any old `hexec` server, creates a fresh **cx23** from
snapshot **429946739** with the Ignition as user_data, upserts the DNS record,
then waits for `/health`.

### Rebuilding the Flatcar snapshot (only if the snapshot is gone / stale)

Build the snapshot with `hcloud-upload-image` from **any machine that can SSH
out** (it spins a temporary Hetzner rescue server and dd's the image over SSH).
Install the binary (`.deb`/`.tar.gz` from its GitHub releases) and:

```bash
export HCLOUD_TOKEN="$HETZNER_API"
hcloud-upload-image upload \
  --image-url https://stable.release.flatcar-linux.net/amd64-usr/current/flatcar_production_hetzner_image.bin.bz2 \
  --architecture x86 --compression bz2 \
  --description 'flatcar-stable-hetzner' --labels os=flatcar,purpose=exec-box
# prints the new image id -> update SNAPSHOT_ID in rebuild.sh
```

(This session built it on the jump server `root@120.77.175.80` due to a one-time
local SSH restriction — not required normally.)

The `flatcar_production_hetzner_image` variant matters: its "hetzner" OEM reads
Ignition from the Hetzner **user_data** at first boot. `hcloud-upload-image` dd's
the raw image in rescue without booting Flatcar, so the first-boot flag is intact
and our user_data runs.

## Gotchas learned building this

- **`cx22` (server type 104) is deprecated** — the API refuses to create it
  ("server type 104 is deprecated"). Cheapest creatable x86 is **cx23** (id 114,
  4 GB) / cpx11 (id 22, 2 GB), both €5.49/mo. Query
  `/v1/server_types` and filter `deprecation == null` before creating.
- **GitHub release assets are throttled/blocked from the China jump server.**
  `api.github.com` JSON is fine, but large asset downloads time out. Use a
  mirror: `https://ghfast.top/https://github.com/<...>` (worked 2026-09-09).
- `HETZNER_API` authorizes **both** `api.hetzner.com` (storage boxes) and
  `api.hetzner.cloud` (servers) — same token.
- **DNS-only A record**, not the CF proxy: Caddy needs to answer ACME on :80 and
  serve :443 directly, and the design deliberately avoids Cloudflare Access.
- Ignition stores file contents **gzip+base64** in the data URL — decode with
  gzip when verifying, not plain url-decode.
- Flatcar butane variant is `variant: flatcar / version: 1.1.0` (→ Ignition 3.4).

## Security posture

This is, by design, a public remote-code-execution endpoint protected by **one
256-bit API key over TLS**. That is what was asked for. If it ever needs
hardening: rotate the key (edit `Caddyfile`, restart caddy, or just rebuild),
and/or attach a Hetzner Cloud Firewall — but source-IP allowlisting is
impractical because both the Mac (dynamic home IP) and the pod have changing
egress IPs. Don't put anything on the box you wouldn't want exposed if the key
leaks; treat the box as disposable.

## Teardown

```bash
curl -s -X DELETE -H "Authorization: Bearer $HETZNER_API" \
  https://api.hetzner.cloud/v1/servers/165310923
# then delete the DNS record if not reusing it (Cloudflare API)
```
