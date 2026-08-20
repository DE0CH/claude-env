---
name: plex-box
description: Manage Deyao's media server box on Hetzner Cloud (server "plex", 49.12.7.149, runs BOTH Jellyfin and Plex) — check status, run commands on it via the storage-box WebDAV command channel (no SSH from web pods), recover the trycloudflare tunnel URLs, and understand its mounts (Storage Box CIFS + 100GB volume). Use whenever a task involves the Jellyfin/Plex server, its tunnel URLs, its media storage, or running anything on that box.
---

# Media box (Hetzner) — Jellyfin + Plex, command channel, tunnel URLs

Provisioned 2026-08-20. Ubuntu 24.04, **cx33** in **fsn1** (€10.19/mo), server id
`162936001`, IP **49.12.7.149**, Hetzner project token `$HETZNER_API`
(api.hetzner.cloud). Firewall `plex-fw` (11495736): inbound 22/tcp + ICMP only —
Plex is reachable ONLY through the tunnel.

## What runs on it

- **Jellyfin** (2026-08-20, the primary server — Deyao's choice after Plex's
  claim-flow friction; official repo.jellyfin.org apt repo, v10.11), service
  `jellyfin`, localhost:8096. Login: user `deyao` (password was DM'd to Deyao;
  he has full admin). Libraries Movies + TV Shows configured over both mounts.
  The `jellyfin` user is in the `plex` group for read access to the CIFS mount.
- **Plex Media Server** (official `downloads.plex.tv/repo/deb` apt repo), service
  `plexmediaserver`, localhost:32400. Still UNCLAIMED (library mgmt only via
  localhost API — see below). Kept running alongside Jellyfin for now.
- **Two cloudflared anonymous quick tunnels**: `cloudflared-quick.service` →
  Plex :32400, `cloudflared-jellyfin.service` → Jellyfin :8096. Each URL is a
  random `https://*.trycloudflare.com` that **changes whenever that service
  restarts**.
- **sbx-agent** (`sbx-agent.timer`, every 30s, `/usr/local/bin/sbx-agent.sh`):
  1. reads each tunnel's current URL from its unit's invocation-scoped journal
     (`journalctl _SYSTEMD_INVOCATION_ID=$(systemctl show -p InvocationID --value <unit>)`);
  2. if Plex is active and its URL changed, rewrites `customConnections` in
     Plex's `Preferences.xml` (stop plex → edit → start plex) for client
     auto-discovery — Jellyfin needs no such sync;
  3. heartbeats `status.json` (fields `plex_url`, `jellyfin_url`, service
     states, mounts) to the storage box;
  4. polls the command channel (below); skips empty cmd.sh files (a WebDAV GET
     can race a PUT and see 0 bytes).

## Mounts (Plex library folders)

- `/mnt/storagebox/media` — the 1TB Storage Box (u652856, box id 635000) CIFS mount
  (`//u652856.your-storagebox.de/backup` → `/mnt/storagebox`, creds in
  `/etc/storagebox.cred`, uid/gid=plex, file_mode 0770). Same box as
  claude-records — don't confuse the folders.
- `/mnt/disk/media` — 100GB Hetzner volume `plex-media` (id 106664429, ~€5/mo),
  ext4 on `/dev/disk/by-id/scsi-0HC_Volume_106664429`.

## Talking to the box from a web pod (no SSH — use the command channel)

SSH from Claude-on-the-web pods is gateway-blocked; SSH is only for Deyao
(`ssh deyao@49.12.7.149`, his GitHub key, passwordless sudo). Agents use the
**storage-box WebDAV command channel** instead:

```bash
printf 'user = "%s:%s"\n' "$STORAGEBOX_USER" "$STORAGEBOX_PASSWORD" > /tmp/claude-0/curlrc-sbx

# current status (tunnel URL, service states, mounts; written every 30s):
curl -s -K /tmp/claude-0/curlrc-sbx "https://$STORAGEBOX_HOST/plex-hetzner/status.json"

# run a command as root on the box:
cat > /tmp/claude-0/cmd.sh <<'EOF'
uptime
EOF
curl -s -K /tmp/claude-0/curlrc-sbx -T /tmp/claude-0/cmd.sh "https://$STORAGEBOX_HOST/plex-hetzner/cmd.sh"
# poll (~30-60s) for the result; it carries "exitcode=N hash=<md5 of cmd.sh>":
curl -s -K /tmp/claude-0/curlrc-sbx "https://$STORAGEBOX_HOST/plex-hetzner/cmd.out"
```

The agent runs `cmd.sh` **once per unique content** (md5 tracked in
`/var/lib/sbx-agent/last`); to re-run the same command, change a comment. Match
the `hash=` in `cmd.out` against your `cmd.sh` md5 to know it's YOUR output.

## Tunnel URL recovery

If a URL stops working, that quick tunnel probably restarted with a new URL:
read `status.json` (`plex_url` / `jellyfin_url`) and send the fresh one to
Deyao. For Plex the agent already re-synced `customConnections` itself.

## Managing Jellyfin / unclaimed Plex via API (through the command channel)

- Jellyfin: authenticate `POST localhost:8096/Users/AuthenticateByName` (header
  `X-Emby-Authorization: MediaBrowser Client="cli", Device="x", DeviceId="y", Version="1"`,
  body `{"Username":"deyao","Pw":...}`) → `AccessToken`; then e.g.
  `POST /Library/VirtualFolders?name=X&collectionType=movies&paths=...` with
  `X-Emby-Token`. Responses carry a UTF-8 BOM — decode with `utf-8-sig`.
  Right after a jellyfin (re)start the API 503s while core services warm up —
  poll `/Startup/User` (pre-wizard) or retry until non-503 before real calls.
- Unclaimed Plex trusts localhost fully: `curl http://localhost:32400/...`
  needs no token (used to create its libraries).

## Gotchas learned during setup

- **CIFS mount error(79) "iocharset utf8 not found"**: Ubuntu cloud images lack
  `nls_utf8` — it's in `linux-modules-extra-$(uname -r)`. Installed + persisted
  via `/etc/modules-load.d/nls_utf8.conf`. Remember this if the kernel is
  upgraded and the mount fails after reboot.
- **Storage Box Samba had to be enabled** via
  `POST api.hetzner.com/v1/storage_boxes/635000/actions/update_access_settings`
  (`samba_enabled: true`) — it ships disabled.
- `$CLOUDFLARE_API` **cannot create named tunnels** (no Account→Cloudflare
  Tunnel→Edit permission) — that's why this uses an anonymous quick tunnel. If a
  stable hostname is ever wanted, Deyao must extend the token first.
- `github.com/de0ch.keys` is unreachable from web pods (GitHub proxy scoping) but
  fine from the server itself — fetch keys in cloud-init, not in the container.
- The Jellyfin `install-debuntu.sh` one-shot can exit "successfully" with the
  `jellyfin`/`jellyfin-server` packages left half-installed (iU/iF in dpkg,
  service 203/EXEC crash-loop, no /usr/bin/jellyfin). Fix: rerun
  `apt-get install -y jellyfin`.
