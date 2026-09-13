---
name: redroid
description: Self-hosted cloud Android phone on a cheap Hetzner box — redroid (Android-in-Docker) driven over SSH + adb, with a view-only screenshot in the portal and an on-demand SOCKS5 egress proxy. Use whenever a task needs an Android device/emulator we control (app automation, ADB, browsing, a phone UI to tap), as the cheap alternative to managed cloud-phone platforms (mobilerun/MobileNext). NOT for apps with aggressive anti-bot / Play Integrity / anti-root (redroid is rooted + fingerprintable) — use a real-device cloud for those.
---

# redroid — self-hosted cloud Android

Cheap replacement for managed cloud phones for **apps without aggressive anti-bot**.
redroid runs Android in Docker on the **host kernel** (no KVM / nested virt needed), so it
runs on an ordinary Hetzner Cloud VM. **~€10/mo** (cx33) vs mobilerun ~$50/mo.

**Do NOT run this on a Fly session pod** — Firecracker microVMs have no KVM, a locked
`-fly` kernel, and can't load the `binder` module. It only works on a box where we're root
and control the kernel (Hetzner Cloud VM is fine; ARM `cax` is blocked on Deyao's Hetzner
account, so use x86). This session box confirmed: no `/dev/kvm`, no vmx/svm.

## The running box (as of 2026-09-13)
- Server: `claude-redroid`, Hetzner **cx33** (4c/8GB, €10.19/mo), hel1. IP in `redroid/server.json`
  and in the default env as `REDROID_IP`.
- **No web UI / no domain** (Deyao, 2026-09-13: doesn't want one). The only ways in are SSH + adb
  (sessions) and the portal's view-only Debug screenshot. Nothing listens on 80/443.
- SSH: `ssh -i <key> root@$REDROID_IP` — key is `REDROID_SSH_KEY` in the default env (NOT in git).
- Android 14, 720×1280, abilist `x86_64,arm64-v8a,...` → **ARM apps run via built-in translation**.

## Architecture
One `redroid` container (adb on 127.0.0.1:5555, `--restart unless-stopped` → reboot-safe) plus
host-side helpers (`redroid-proxy`, `redroid-ip`) and `redroid-adb-connect.service` (host
`adb connect localhost:5555` after boot). Everything else talks to it through `adb` on the
box, over SSH. Android takes ~1-2 min to boot after a VM start; until then the portal's
Debug health shows an empty boot flag.

## Manage it from the portal (dashboard)
The portal has an **Android** tab (self-hosted controller, `selfhost/portal`):
- **Release** — deletes the VM (irreversible; rebuild with `redroid/provision.sh`). This is
  the only lifecycle button, deliberately: Hetzner bills a powered-off server exactly like a
  running one, so a Stop would save nothing (Deyao, 2026-09-13). Running or released — no
  in-between.
- **Debug (view-only)** — a live screenshot + health (boot flag, container up/down, exit IP,
  proxy state, load/mem/disk/uptime), pulled on demand over SSH.

The portal reads `HETZNER_API` and the **control key `REDROID_SSH_KEY`** from the **default
environment** secrets (single source of truth). Endpoints: `GET /api/redroid/state`,
`DELETE /api/redroid`, `GET /api/redroid/{debug,screen.png}` (portal `lib/redroid.js` +
`lib/hetzner.js`). The box is found by Hetzner label `purpose=redroid-android` — no hardcoded id.

## Control key in the default store (for sessions)
The default env carries `REDROID_SSH_KEY` (private key) and `REDROID_IP`. Any session can
drive the box:
```bash
install -m600 <(printf '%s' "$REDROID_SSH_KEY") /tmp/rk
ssh -i /tmp/rk -o StrictHostKeyChecking=no root@"$REDROID_IP" 'adb -s localhost:5555 shell ...'
```

## Drive it (over SSH from a session)
```bash
adb -s localhost:5555 shell ...            # any adb command
adb -s localhost:5555 exec-out screencap -p > s.png
# install an app: no Play Store (AOSP image). adb install <apk>, or install Aurora Store on-device.
/usr/local/bin/redroid-ip                  # print current outbound IP
```
Static curl is at `/data/local/tmp/curl` inside redroid (Android has no /etc/resolv.conf for
musl → use `--resolve host:port:IP`).

## Egress proxy (default = box datacenter IP; switch only when needed)
```bash
redroid-proxy status
redroid-proxy on <socks5_host> <port> <user> <pass>   # e.g. Evomi (Tier1) or IPRoyal mobile (Tier2)
redroid-proxy off
```
redsocks + iptables REDIRECT of the container's TCP (needs `xt_REDIRECT` module — loaded &
persisted). TCP only; DNS is not proxied (fine for IP-reputation, minor DNS leak). Validated:
OFF=Hetzner, ON=proxy exit IP. Get proxies via the `evomi` / `iproyal` skills.
**Not reboot-persistent:** after a Stop/Start the proxy is OFF again (iptables rules gone; the
Debian `redsocks` unit is disabled on purpose so it doesn't auto-start with a stale config).

## Rebuild from scratch
`redroid/provision.sh [type] [location]` — creates an SSH key and an x86 Ubuntu 24.04 server
with `redroid/cloud-init.sh` (needs only `HETZNER_API`; no DNS). cloud-init takes ~3-5 min
(docker + redroid image pull). Everything (redroid, proxy toggle, helper scripts, static curl)
is in `cloud-init.sh`. Afterwards put the new private key / IP into the default env as
`REDROID_SSH_KEY` / `REDROID_IP` (portal → Environments → default → Edit secrets) so the
portal's Android tab and sessions can reach it.

## Manage the box
```bash
# destroy when no longer needed (stops the €10/mo):
curl -X DELETE -H "Authorization: Bearer $HETZNER_API" https://api.hetzner.cloud/v1/servers/<id>
# resize if sluggish (cx33 -> cx43): power off, POST /servers/<id>/actions/change_type, power on
```

## Gotchas
- After a VM reboot, host adb only sees the device as `emulator-5554` until `adb connect
  localhost:5555` runs (the boot unit does it; the portal also prefixes every command with it).
  If `adb -s localhost:5555 …` says "device not found", run `adb connect localhost:5555`.
- SSH heredocs with nested `adb shell` drop mid-session → run adb commands as **separate,
  atomic** SSH invocations, not one big heredoc.
- redroid Android has **no curl/wget**; toybox has `nc`. Use the pushed static curl.
- If you ever need a live tap-able screen for a hands-on moment, don't stand up a public web UI
  (Deyao removed the ws-scrcpy + Caddy + `android.deyaochen.com` one). Do it ad hoc: tunnel the
  scrcpy/adb port through SSH into the session and expose it through the per-session
  cf-tunnel (CF Access gated), then tear it down.
- Portal buttons: `pbtn(key, cls, onclick, label)` drops `onclick` into a double-quoted HTML
  attribute — write the handler with **single** quotes (`"someFn('arg')"`), or the
  attribute truncates and the button silently does nothing (bit the old Stop/Start buttons).
