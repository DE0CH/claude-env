---
name: plex-box
description: Manage Deyao's Plex media server on Hetzner Cloud (server "plex", 49.12.7.149) — check status, run commands on it via the storage-box WebDAV command channel (no SSH from web pods), recover the trycloudflare tunnel URL, and understand its mounts (Storage Box CIFS + 100GB volume). Use whenever a task involves the Plex server, its tunnel URL, its media storage, or running anything on that box.
---

# Plex box (Hetzner) — status, command channel, tunnel URL

Provisioned 2026-08-20. Ubuntu 24.04, **cx33** in **fsn1** (€10.19/mo), server id
`162936001`, IP **49.12.7.149**, Hetzner project token `$HETZNER_API`
(api.hetzner.cloud). Firewall `plex-fw` (11495736): inbound 22/tcp + ICMP only —
Plex is reachable ONLY through the tunnel.

## What runs on it

- **Plex Media Server** (official `downloads.plex.tv/repo/deb` apt repo), service
  `plexmediaserver`, listening on localhost:32400 (32400 is firewalled externally).
- **cloudflared anonymous quick tunnel** (`cloudflared-quick.service`):
  `cloudflared tunnel --url http://localhost:32400`. URL is random
  `https://*.trycloudflare.com` and **changes whenever the service restarts**.
- **sbx-agent** (`sbx-agent.timer`, every 30s, `/usr/local/bin/sbx-agent.sh`):
  1. greps the current tunnel URL from the cloudflared journal and, if changed,
     rewrites `customConnections` in Plex's `Preferences.xml` (stop plex → edit →
     start plex) so Plex clients auto-discover the URL;
  2. heartbeats `status.json` to the storage box;
  3. polls the command channel (below).

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

If the Plex URL stops working, the quick tunnel probably restarted with a new
URL: read `status.json` (`tunnel_url`) and send it to Deyao. The agent already
re-synced Plex's `customConnections` itself.

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
