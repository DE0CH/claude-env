---
name: redroid
description: Self-hosted cloud Android phone on a cheap Hetzner box — redroid (Android-in-Docker) with browser-based live control (ws-scrcpy) and an on-demand SOCKS5 egress proxy. Use whenever a task needs an Android device/emulator we control (app automation, ADB, browsing, a phone UI to tap), as the cheap alternative to managed cloud-phone platforms (mobilerun/MobileNext). NOT for apps with aggressive anti-bot / Play Integrity / anti-root (redroid is rooted + fingerprintable) — use a real-device cloud for those.
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
- Server: `claude-redroid`, Hetzner **cx33** (4c/8GB, €10.19/mo), hel1. IP in `redroid/server.json`.
- **Live URL (open on phone):** https://android.deyaochen.com — basic auth user `deyao`,
  password in the storage-box task record (`~/artifacts/redroid/basic-auth-password.txt`).
- SSH: `ssh -i <id_redroid> root@<ip>` (key in `~/artifacts/redroid/id_redroid`; NOT in git).
- Android 14, 720×1280, abilist `x86_64,arm64-v8a,...` → **ARM apps run via built-in translation**.

## Architecture
`redroid` container (adb on 127.0.0.1:5555) → `ws-scrcpy` container (host net, :8000,
browser screen+touch) → `Caddy` (auto-HTTPS + basic auth) on :443. All `--restart
unless-stopped` / systemd-enabled → reboot-safe. `redroid-connect.service` re-attaches the
device to ws-scrcpy on boot.

## Manage it from the portal (dashboard)
The portal has an **Android** tab (self-hosted controller, `selfhost/portal`):
- **Start / Stop** — power the Hetzner VM on/off without deleting it. NOTE: a stopped VM
  still bills (Hetzner charges powered-off servers); only Release stops the monthly cost.
- **Release** — deletes the VM (irreversible; rebuild with `redroid/provision.sh`).
- **Debug (view-only)** — a live screenshot + health (boot flag, container up/down, exit IP,
  proxy state, load/mem/disk/uptime), pulled on demand over SSH.

The portal reads `HETZNER_API` and the **control key `REDROID_SSH_KEY`** from the **default
environment** secrets (single source of truth). Endpoints: `GET/POST /api/redroid/{state,start,
stop}`, `DELETE /api/redroid`, `GET /api/redroid/{debug,screen.png}` (portal `lib/redroid.js` +
`lib/hetzner.js`). The box is found by Hetzner label `purpose=redroid-android` — no hardcoded id.

## Control key in the default store (for sessions)
The default env now carries `REDROID_SSH_KEY` (private key), `REDROID_HOST`, `REDROID_IP`,
`REDROID_WEB_USER`, `REDROID_WEB_PASSWORD`. Any session can drive the box:
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

## Rebuild from scratch
`redroid/provision.sh [type] [location] [domain]` — creates SSH key, x86 Ubuntu 24.04 server
with `redroid/cloud-init.sh`, and the DNS A record. cloud-init takes ~5-8 min (image pull +
ws-scrcpy source build). Everything (redroid, ws-scrcpy, Caddy, proxy toggle, helper scripts,
reboot service, static curl) is in `cloud-init.sh`.

## Manage the box
```bash
# destroy when no longer needed (stops the €10/mo):
curl -X DELETE -H "Authorization: Bearer $HETZNER_API" https://api.hetzner.cloud/v1/servers/<id>
# resize if sluggish (cx33 -> cx43): power off, POST /servers/<id>/actions/change_type, power on
```

## Gotchas
- SSH heredocs with nested `adb shell` drop mid-session → run adb commands as **separate,
  atomic** SSH invocations, not one big heredoc.
- redroid Android has **no curl/wget**; toybox has `nc`. Use the pushed static curl.
- Caddy needs the DNS A record **grey-cloud (DNS-only)** for Let's Encrypt HTTP-01.
- `CLOUDFLARE_API` token is DNS-scoped only — it can't create CF Tunnels or Access apps
  (that's why the gate is Caddy basic auth, not CF Access).
