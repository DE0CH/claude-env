---
name: device-egress-proxy
description: Route a remote mobile device's traffic through a proxy (Evomi datacenter Tier-1 or IPRoyal residential Tier-2) and verify/rate the egress IP. Use when a task needs a phone (Android/iOS) to browse from a proxied IP, or asks to check a proxy exit IP's reputation. Covers mobilerun (preferred — whole-device SOCKS5 with auth, no whitelisting), MobileNext (fallback, IP-whitelisting), and ping0.cc reputation lookup via Browserbase.
---

# Device egress proxy (mobile → residential IP → reputation)

Point a remote real phone's browser traffic through an IPRoyal residential exit, then
confirm/rate that exit IP. Proven end-to-end 2026-08-18 (Android via MobileNext:
device direct `99.78.197.7` → IPRoyal exit `190.142.235.17`, a clean VE residential IP).

## The auth problem (read first)
Proxy auth normally rides on the **password**. Whether you need a whitelist depends on the
harness:
- **mobilerun** (preferred): whole-device **SOCKS5 with user:pass** → hand it creds directly,
  **no whitelist**.
- **iOS** Wi-Fi proxy: *has* Username/Password → creds directly, no whitelist.
- **Android** Wi-Fi/global proxy: host+port only, **no auth** → IP-whitelist the egress IP.

For the no-auth cases, authenticate at IPRoyal by **IP-whitelisting the device's egress IP**
instead of sending creds. Env: `IPROYAL_API` (management token). Residential user hash:
`01M08XFVYVS8QT13ZYX8T2WHZ1`.

## Preferred harness: mobilerun
Whole-device SOCKS5 **with auth**, so no whitelisting — hand it Tier-1 Evomi (skill `evomi`,
`dcp.evomi.com:2002`) or Tier-2 IPRoyal (`geo.iproyal.com:32325`) SOCKS5 creds. See CLAUDE.md
"Proxies (two-tier) & mobilerun". Cloud Phones are persistent (no idle deallocation).
1. Provision / pick a ready device (`POST /v1/devices` or `GET /v1/devices?state=ready`),
   `Authorization: Bearer $MOBILERUN_API`.
2. Attach the proxy: `POST /v1/devices/{id}/proxy` with a `socks5` body `{host,port,user,password}`
   — switchable live any time (replaces the existing connection). See the `evomi` skill for a
   generate → split → POST one-liner.
3. Read the exit IP: open `https://ipv4.icanhazip.com` (open-deep-link) → `screenshot`, or
   execute-JS-in-Chrome (CDP) to fetch it. Swap the proxy and re-read to compare exits.
4. Terminate the device when done (`POST /v1/devices/{id}` terminate) if you provisioned it.

## Fallback harness: MobileNext (Android)
JSON-RPC to `https://app.mobilenext.ai/mcp` (see CLAUDE.md MobileNext section; helper pattern
`grep -m1 '^data: '`). Android has no proxy auth, so IP-whitelist the device egress IP.
1. `mobilenext_allocate_device {platform:"android"}`; poll `list_available_devices` for `online`.
   Probe the bridge with `get_screen_size` first — iOS devices frequently come up "online" but
   with a dead automation bridge (`localhost:12000 EOF`); if so, release + reallocate.
2. Baseline: `open_url http://ipv4.icanhazip.com` → `save_screenshot` (returns an S3 URL; curl
   it, don't base64) → read the direct egress IP (the a11y tree usually misses the tiny page
   text; use the screenshot).
3. Whitelist that IP at IPRoyal (below).
4. Set the Wi-Fi proxy through the Settings UI:
   `launch_app com.android.settings` → Connections → Wi-Fi → connected-network **cog** icon →
   **View more** → **Proxy → Manual** → host `geo.iproyal.com`, port `12321` → **Save**.
   Use `list_elements_on_screen` for tap coords.
   **Keyboard gotcha:** after typing the host, the soft keyboard covers the port field —
   tapping the port coord hits a keyboard key and the port lands in the host field. Fix:
   press BACK to hide the keyboard *between* fields, then tap the now-visible port field.
   To clear a bad field: long-press it → Cut, then retype.
5. `open_url http://ipv4.icanhazip.com` again → screenshot → read the IPRoyal exit IP.
6. **Cleanup (always):** delete the whitelist entry; revert Proxy → None (Settings, courtesy to
   next user); `release_device` (needs both `device` and `sessionId`).

## IPRoyal whitelist API
```bash
HASH=01M08XFVYVS8QT13ZYX8T2WHZ1
# create (port 12321 = HTTP/S). Auth is by IP once this exists — no creds needed from that IP.
curl -s -X POST "https://resi-api.iproyal.com/v1/residential-users/$HASH/whitelist-entries" \
  -H "Authorization: Bearer $IPROYAL_API" -H "Content-Type: application/json" \
  -d '{"ip":"<device-egress-ip>","port":12321,"note":"egress-test-temp"}'   # -> returns entry hash
# delete right after (stops the shared-NAT auth window + any billing)
curl -s -X DELETE "https://resi-api.iproyal.com/v1/residential-users/$HASH/whitelist-entries/<entry-hash>" \
  -H "Authorization: Bearer $IPROYAL_API"
```
- Whitelist billing hits the **main** account (not a sub-user), so keep the window tiny and
  delete immediately. A sub-user's `traffic` allocation is *reserved* from the pool and
  *returned* on sub-user deletion — it is not usage. The whole test cost ~10 KB.
- **iOS alternative (authenticated, no whitelist):** create a sub-user for creds
  (`POST /v1/residential-subusers {username,password,traffic:0.1}`; password ≤16 chars), enter
  them in iOS Wi-Fi proxy Username/Password, delete the sub-user after.

## Reputation check — ping0.cc via Browserbase (NOT IPRoyal)
Check the exit IP's reputation on its own, off IPRoyal (conserve data). ping0.cc is JS-rendered
+ bot-protected, so the Fetch API returns empty — use a remote browser session:
```bash
browse open "https://ping0.cc/ip/<exit-ip>" --remote
browse wait load networkidle --timeout 45000
browse screenshot --path ping0.png     # read the rows from the screenshot (it's a Chinese page)
browse stop
```
Key rows: 位置 (location), ASN/所有者, **IP 类型** (家庭宽带=residential / IDC=datacenter),
**风控值** (risk %; 极度纯净 = very clean), **原生 IP** (native vs secondary), **共享人数**
(shared users), 适用场景 (suitability stars).
