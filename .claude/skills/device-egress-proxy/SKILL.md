---
name: device-egress-proxy
description: Route a remote mobile device's traffic through an IPRoyal residential proxy and verify/rate the egress IP. Use when a task needs a phone (Android/iOS) to browse from a residential IP, or asks to check a proxy exit IP's reputation. Covers AWS Device Farm (preferred), MobileNext (fallback), IPRoyal IP-whitelisting, and ping0.cc reputation lookup via Browserbase.
---

# Device egress proxy (mobile → residential IP → reputation)

Point a remote real phone's browser traffic through an IPRoyal residential exit, then
confirm/rate that exit IP. Proven end-to-end 2026-08-18 (Android via MobileNext:
device direct `99.78.197.7` → IPRoyal exit `190.142.235.17`, a clean VE residential IP).

## The auth problem (read first)
IPRoyal residential auth normally rides on the **password**. But device proxy settings
often have **no username/password field**:
- **Android** Wi-Fi/global proxy: host+port only, no auth.
- **AWS Device Farm** `deviceProxy`: host+port only, no auth.
- **iOS** Wi-Fi proxy: *does* have Username/Password — so iOS can use IPRoyal creds directly
  (mint a sub-user, see below), no whitelist needed.

For the no-auth cases, authenticate at IPRoyal by **IP-whitelisting the device's egress IP**
instead of sending creds. Env: `IPROYAL_API` (management token). Residential user hash:
`01M08XFVYVS8QT13ZYX8T2WHZ1`.

## Preferred harness: AWS Device Farm
See CLAUDE.md "Phone automation". Native device-wide proxy + Appium control:
1. `aws devicefarm create-remote-access-session` (us-west-2) with
   `configuration.deviceProxy = {"host":"geo.iproyal.com","port":12321}`.
2. Whitelist the Device Farm egress CIDR **`54.244.50.32/27`** at IPRoyal (see whitelist API).
3. Drive via `get-remote-access-session` → `endpoints.remoteDriverEndpoint` (Appium/WebDriver):
   open a Chrome web session, GET `http://ipv4.icanhazip.com`, read the body.
4. Stop the session; delete the whitelist entry.
- ~$0.17/device-min (1000 free min on new accounts). **Blocked by `SubscriptionRequiredException`
  until the AWS account is fully activated** — fall back to MobileNext until then.

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
