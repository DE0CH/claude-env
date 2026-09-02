## Setting an outbound proxy for MobileNext cloud devices (2026-08)

Goal: route a MobileNext cloud device's traffic through our own proxy. MobileNext exposes
**no API/MCP proxy parameter** (allocate_device and every tool lack any proxy field), so the
only lever is the **Android WiFi HTTP-proxy** setting, driven through the Settings UI.
Verified end-to-end: a real Pixel 10 (Android 16) egress flipped 99.78.197.7 (AWS fleet) ->
78.47.146.87 (our Hetzner box) -> back to 99.78.197.7 after revert.

- **The "other end" = a Hetzner Cloud box, configured via cloud-init only.** Create with the
  Cloud API ($HETZNER_API): cx23 / ubuntu-24.04 is fine. Pass `user_data` that installs
  tinyproxy (`Port <highport>`, `Allow 0.0.0.0/0`, `ConnectPort 443`). We CANNOT SSH in from
  Claude-on-the-web pods (22/23 gateway-blocked), and we CANNOT test the proxy from the
  container either — the egress gateway only relays :443 HTTP/S/WSS, so a `curl -x box:31280`
  from the container times out. **The device is the only vantage point that can validate the
  proxy.** Use a non-standard high port and DELETE the box promptly (open proxy = abuse magnet).
- **Fleet devices are real MDM-managed (AirWatch) handsets on WiFi** in an AWS Oregon facility
  (SSID "PDX80-PROVISIONER10"). WiFi proxy is settable despite MDM. Path:
  Settings -> Network & internet -> Internet -> tap connected WiFi -> pencil (edit, top-right) ->
  Advanced options -> Proxy = Manual -> hostname + port -> Save. The dialog warns "The HTTP
  proxy is used by the browser but may not be used by other apps" — so this proxies Chrome,
  not necessarily every app. **Revert to None before releasing** so the next user isn't left
  pointing at a dead box.
- Real devices force-deallocate fast when idle — do the whole flow in one go.

### MobileNext MCP over raw JSON-RPC (curl) — reliable patterns
- POST to `https://app.mobilenext.ai/mcp` with `Authorization: Bearer $MOBILENEXT_API` and
  `Accept: application/json, text/event-stream`. The response is an SSE stream that **stays
  open**. Reliable capture:
  `curl -sS -m 90 -N ... | grep -m1 '^data: ' | sed 's/^data: //'`.
  Do NOT use `head -c N` (buffers until N bytes/EOF -> blocks) and do NOT wrap curl in
  `timeout` (SIGTERM drops buffered output). `-N` + `grep -m1` (exits on match -> SIGPIPE
  closes curl) is the pattern.
- **Bash `${2:-{}}` is mis-parsed** as `${2:-{}` + literal `}`, appending a stray `}` that
  corrupts JSON args (silent empty/near-empty responses). Use
  `ARGS="$2"; [ -z "$ARGS" ] && ARGS='{}'`.
- `mobilenext_save_screenshot` returns a temporary S3 URL — fetch over 443 (no base64) to read
  the screen. `mobilenext_list_elements_on_screen` returns a **nested** tree; flatten to leaf
  rows `{text, identifier, center-x, center-y}` to get reliable tap coordinates.
- `mobilenext_release_device` requires BOTH `device` AND `sessionId`.
- A Gboard "Proofread" popup can eat typed input into form fields — dismiss ("Not now") and
  re-enter; press BACK to hide the keyboard (IME consumes BACK first) to reach covered fields.
