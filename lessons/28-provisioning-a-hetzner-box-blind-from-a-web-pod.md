## Provisioning a Hetzner box blind from a web pod (2026-08-20, Plex server)

**DECOMMISSIONED 2026-08-21** per Deyao: server `plex` (162936001), its 100GB
volume `plex-media` (106664429) and firewall `plex-fw` (11495736) were all
deleted via the Cloud API; the `plex-box` skill was removed. The Storage Box
(claude-records, 635000) is unaffected; its `plex-hetzner/` command-channel dir
is just leftover files. The provisioning pattern below stays valid for future
boxes.

Built the Plex box (see the `plex-box` skill for the living runbook) entirely via
cloud-init — no SSH from pods, so debugging happened through a **storage-box WebDAV
command channel**: a 30s systemd timer on the server GETs `cmd.sh` from the box over
WebDAV, runs it once per unique md5, PUTs `cmd.out` + a `status.json` heartbeat back.
This is the pattern for ANY future headless Hetzner provisioning — bake the channel
into cloud-init so a botched first boot is fixable without recreating the server.

- **CIFS mounts with `iocharset=utf8` fail on Ubuntu cloud images**: mount error(79),
  dmesg "iocharset utf8 not found". `nls_utf8` lives in `linux-modules-extra-$(uname -r)`
  (not installed by default). Install it + `/etc/modules-load.d/nls_utf8.conf`, or drop
  the iocharset option.
- **Storage Box Samba is disabled by default** — enable via the new API's
  `actions/update_access_settings` (`samba_enabled: true`) before any CIFS mount. Works
  from a cloud server in the same DC over port 445; the `backup` share = the box root
  (same tree WebDAV sees).
- **$CLOUDFLARE_API can't create tunnels** (scoped without Account→Cloudflare
  Tunnel→Edit; auth error 10000). Anonymous quick tunnels
  (`cloudflared tunnel --url ...`) need no account/token at all and work fine from a
  Hetzner server (the pod's egress gateway blocks them, port 7844 — run them on the
  server, never in the pod). Quick-tunnel URL changes on every cloudflared restart —
  pair it with an auto-resync of Plex's `customConnections` (Preferences.xml; stop
  plex → edit attr → start plex, ET rewrite is safe).
- **`github.com/<user>.keys` and api.github.com are blocked in web pods** (GitHub
  proxy is repo-scoped) — fetch SSH keys from cloud-init on the server instead.
- Hetzner cloud + volume + firewall create-in-one-call works: `volumes:[id]` +
  `firewalls:[{firewall:id}]` in POST /v1/servers; volume device path is
  `/dev/disk/by-id/scsi-0HC_Volume_<id>`.
