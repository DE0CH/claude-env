---
name: gl-router-eduroam-tailscale
description: Flash a GL.iNet travel router (esp. GL-SFT1200/Opal) and turn it into a Tailscale exit node whose WAN uplink is eduroam (WPA2-Enterprise/PEAP). Covers U-Boot flashing, GL firmware selection, scripted SSH to GL dropbear, eduroam STA config, Tailscale on MIPS with tiny RAM, MAC-spoof + account failover, and ACL/exit-node setup. Use for GL.iNet routers, OpenWrt on unusual SoCs, eduroam-as-WAN, or router Tailscale exit nodes.
---

# GL.iNet router → eduroam-uplinked Tailscale exit node

Hard-won from setting up a **GL-SFT1200 (Opal)** on 2026-08-25. Read this before re-deriving.

## 0. Identify the SoC FIRST — it decides the firmware
- GL-SFT1200 (Opal) = **Siflower SF19A28, mipsle** (little-endian despite `uname` saying "mips"; verify with ELF byte 6 of `/bin/busybox`: `01`=LE). **Mainline OpenWrt does NOT support it** (the wiki device page "does not exist"). GL's own firmware (OpenWrt-based) is the ONLY option.
- Flashing the WRONG-arch image is harmless: GL's U-Boot refuses to boot it and stays in web-recovery (it protects itself). Symptom = device keeps returning to the "Firmware update" page.

## 1. Get the right GL firmware (their download site is a JS SPA)
- API: `https://firmware-api.gl-inet.com/cloud-api/model/info?model=<model>` (e.g. `sft1200`). The `info[].download[]` array has `.link` + `.sha256` for both a `.tar` (GUI upgrade) and a **`.img` (U-Boot-compatible)** — for U-Boot recovery use the `.img`.
- Files are served from `https://fw.gl-inet.com/firmware/<model>/release4/...`.

## 2. Flash via U-Boot web recovery
- Device in U-Boot recovery serves a plain HTML form at `http://192.168.1.1/` ("uboot2.0"). Put your PC on `192.168.1.2/24` on the wired NIC.
- Upload = a single multipart POST (no hidden fields): `curl -F "firmware=@file.img" http://192.168.1.1/`. Response "UPDATE IN PROGRESS" = flash started. It rebuilds and reboots (~2-3 min). A `curl` exit 56 mid-upload = connection reset; just retry.
- After a good flash the device boots GL firmware with LAN **192.168.8.1** (not .1.1). Add `192.168.8.2/24` to your NIC to reach it.

## 3. First-boot setup (headless, via Playwright)
- GL 4.x首boot is a JS SPA wizard at `http://192.168.8.1/#/welcome`. Its RPC (`/rpc`, challenge→login) is fiddly; easier to drive the wizard with **Playwright using the installed Chrome** (`channel="chrome"`, headless) — fill the two password inputs, click Next. Completing the wizard (through the Wi-Fi step) is what starts **dropbear**, enabling SSH. The admin password == root == SSH password.

## 4. Scripted SSH to GL dropbear (the gotchas)
- GL dropbear only offers the **legacy `ssh-rsa` host key**; paramiko 5.x removed it and OpenSSH disables it. Use **`pip install paramiko==3.5.1`** and force it: `t=paramiko.Transport((host,22)); t._preferred_keys=("ssh-rsa","rsa-sha2-512","rsa-sha2-256"); t.connect(username="root",password=pw)`. (OpenSSH CLI: `-o HostKeyAlgorithms=+ssh-rsa`.)
- **No SFTP subsystem** → transfer files by streaming over an exec channel: open `cat > '/remote/path'`, `ch.send()` the bytes in chunks, `ch.shutdown_write()`, check `recv_exit_status()`. Verify with `sha256sum` on the far end.
- Feed multi-line command batches from a **BOM-free** file (PowerShell here-strings add a UTF-8 BOM that breaks the first line). Avoid recursive `grep`/`find` over the FS in SSH batches — they hang the channel.

## 5. eduroam as WAN (WPA2-Enterprise STA)
- GL firmware has **`wpad-openssl`** → EAP works out of the box. GL's own repeater daemon (`gl-repeater`) can't do enterprise, so stop it (`/etc/init.d/gl-repeater stop; uci set repeater.main.auto=0`) and manage the STA yourself via uci.
- STA wifi-iface (network `wwan`, already in the `wan` firewall zone with masq): `mode=sta ssid=eduroam encryption=wpa2 eap_type=peap auth=MSCHAPV2 identity=<user> password=<pw> ieee80211w=1 ifname=staeduroam macaddr=<spoof>`. **`ieee80211w=1` (PMF) is REQUIRED** — without it association is rejected with `status_code=1` (`bssid=00:00:00:00:00:00`). Do NOT set `auth=auth=...` (netifd wraps it → `phase2="auth=MSCHAPV2"`). Omit `ca_cert` to skip server-cert validation when you don't have the campus CA.
- Bring up with `wifi reload`. Watch `wpa_cli -i staeduroam -p /var/run/wpa_supplicant status` for `wpa_state=COMPLETED`, then DHCP on wwan, then ping.
- **Marginal signal is the usual failure**: a travel router's antenna receives eduroam far worse than a laptop (saw -74..-85 dBm vs laptop 85%). Symptoms: intermittent association + PEAP that never completes (EAP restarts every ~38s). A fresh **spoofed MAC + a clean single retry** often succeeds where churning did not. The Siflower `lb-fmac` driver CAN do concurrent AP+STA (combos allow managed+AP); GL's repeater uses it daily.

## 6. Tailscale on a 128MB mipsle router
- Push the static **mipsle** build (`pkgs.tailscale.com/stable/tailscale_<ver>_mipsle.tgz`) — the combined-binary symlink trick does NOT work with this tgz, so push BOTH `tailscale` and `tailscaled`. UBIFS compresses the overlay (~40MB binary → ~24MB on disk), so space is fine.
- procd init for tailscaled: `--state=/overlay/tailscale/state/tailscaled.state --statedir=... --socket=/var/run/tailscale/tailscaled.sock`, `respawn`.
- **128MB RAM OOM-kills tailscaled.** No zram module on this build. Mitigate: `procd_set_param env GOGC=10 GOMEMLIMIT=48MiB` (caps the Go heap; costs CPU — load runs high but it stays alive), and disable unneeded GL services (gl-cloud, rtty, gl_clients, carrier-monitor, gl_eqos, gl_s2s, gl_tethering…).
- Bring up: `tailscale up --advertise-exit-node --ssh --advertise-tags=tag:<t> --hostname=<h> --accept-dns=false`. Runs in background printing a `https://login.tailscale.com/a/...` URL — grep it from the log and Discord it. tailscaled persists the pending login, so the daemon completes auth after the user clicks even if the `up` CLI process exits. **Clock must be correct first** (TLS) — force `sysntpd restart` and wait for `date -u +%Y >= 2025`; otherwise the first HTTPS calls (incl. Discord notifications) fail.

## 7. Tailnet ACL (repo DE0CH/tailscale-acl, GitHub Action applies on push to main)
- Pre-authorize the tag so the user's login "just works": `tagOwners{"tag:<t>":["<user>"]}`, `autoApprovers{"exitNode":["tag:<t>"]}`, an acl `{"src":["*"],"dst":["tag:<t>:*"]}`, and an `ssh` rule `{"action":"accept","src":["autogroup:member"],"dst":["tag:<t>"],"users":["root"]}`.
- Push triggers the "Sync Tailscale ACLs" Action (`gh run watch <id> --exit-status`). NB: commit signing (SSH key) may be unavailable on the box → commit `--no-gpg-sign` and tell Deyao.
- Verify from another tailnet device: `tailscale exit-node list` shows the node; `ssh root@<node>` works passwordless (Tailscale SSH host key is ED25519, not dropbear's ssh-rsa).

## 8. Cron on GL firmware
- crond runs `-c /tmp/gl_crontabs` (tmpfs, rebuilt each boot; GL's `auto_timezone` also rewrites system TZ every minute). Append jobs to `/tmp/gl_crontabs/root` from your boot init and `killall -HUP crond`. For "02:00 UTC" make it TZ-independent: run hourly and gate on `[ "$(date -u +\%H)" = "02" ]` (escape `%` as `\%` in the crontab).

## Network-safety note
If the box you're driving is itself remote-accessed (Deyao's case), only ever touch the SECONDARY NIC wired to the router; never the internet-facing adapter, default route, or enable routing/VPN on the host.
