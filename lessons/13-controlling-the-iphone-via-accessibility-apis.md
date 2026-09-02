## Controlling the iPhone via accessibility APIs (2026-08)

Working stack: WebDriverAgent built+signed on GitHub macOS runners (repo
`DE0CH/wda-build`, private — workflow, secrets, and runbook all there), installed
with go-ios, launched with pymobiledevice3, driven by Appium CLI (server on :4723,
client in `~/.venvs/ios`, cap `appium:webDriverAgentUrl=http://127.0.0.1:8100`).
Runbook: `wda-build/scripts/start-stack.sh` (tunneld needs one sudo command first —
ask Deyao). Phone: iPhone18,3, iOS 26.6, UDID 00008150-00046CA2019B401C.

- **go-ios (v1.2.1) is broken on iOS 26.5+**: the sudo-free userspace tunnel
  connects but every developer-service DTX channel times out / broken-pipes
  (upstream danielpaulus/go-ios#772, unfixed — maintainer's farm tops out at iOS
  18). `--address/--rsd-port` flags don't help. `ios install` and plain usbmux
  commands still work fine; only tunnel-based services fail.
- **pymobiledevice3 works end-to-end**: `remote tunneld` (root), `mounter
  auto-mount` (phone must be **unlocked** or you get `DeviceLocked`), `developer
  dvt xcuitest dev.de0ch.wda.xctrunner --tunnel <udid>`, `usbmux forward 8100 8100`.
- **Settings > Developer > Enable UI Automation must be ON** on the phone, else the
  XCUITest session dies with `initializationForUITestingDidFailWithError`.
- **Port forwards die on unplug**: a usbmux forward started before a re-plug is
  stale — restart it, symptoms are silent connection refusal.
- **ASC API key roles**: Developer-role keys can read but get 403 on device
  registration / provisioning writes — Admin key required (created `wda-ci`,
  `2QDDAZ495K`; .p8 in `~/paper-trail-signing/`, also in wda-build repo secrets;
  Issuer ID 11025254-570b-463b-af34-00bf6b0e151e, Team ID S64YL394S3).
- **CI cloud signing** (`xcodebuild -allowProvisioningUpdates` + ASC key on
  `macos-15` runners, Xcode 26.x) builds device-signed WDA with no local Xcode; it
  mints a fresh Apple Development cert per run — revoke stale ones if a limit hits.
- Local Xcode is NOT installed (CLT only) and isn't needed for any of this.
