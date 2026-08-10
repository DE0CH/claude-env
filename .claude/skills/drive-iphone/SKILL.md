---
name: drive-iphone
description: Control Deyao's physical iPhone over USB through the accessibility API (WebDriverAgent + pymobiledevice3 + Appium). Use when asked to open apps, read screens, tap/type, screenshot, or automate anything on the iPhone. Mac host only.
---

# Drive the iPhone (accessibility API)

Target: physical iPhone (iPhone18,3, iOS 26.6), UDID `00008150-00046CA2019B401C`.
Only works on the Mac host with the phone plugged in via USB. Deep background and
pitfalls: `lessons.md` ("Controlling the iPhone"); build/signing infra: private repo
[DE0CH/wda-build](https://github.com/DE0CH/wda-build).

## Bring-up

1. Phone plugged in (ping Deyao on Discord if not — he may need to plug it in).
2. tunneld must be running as root. Check: `curl -s -m 2 http://127.0.0.1:49151/hello`.
   If it's not, you cannot sudo — Discord Deyao to run:
   ```
   sudo sh -c 'nohup /Users/deyaochen/.venvs/ios/bin/pymobiledevice3 remote tunneld > /tmp/pmd3-tunneld.log 2>&1 &'
   ```
3. Run `~/cs/wda-build/scripts/start-stack.sh` — waits for the device tunnel, mounts
   the DDI (first mount after reboot needs the phone **unlocked**, retry on
   `DeviceLocked`), launches WDA as an XCUITest, forwards localhost:8100, and polls
   until WDA answers. Safe to rerun anytime; it kills stale processes first.
4. Sanity: `curl -s localhost:8100/status` → "WebDriverAgent is ready to accept commands".

## Driving it

Raw WDA (W3C WebDriver + Appium extensions) is on `http://localhost:8100`. For real
work use Appium: start `appium` (port 4723, long-running background process), then
drive from Python (`~/.venvs/ios/bin/python`, Appium-Python-Client installed):

```python
from appium import webdriver
from appium.options.ios import XCUITestOptions

opts = XCUITestOptions()
opts.udid = "00008150-00046CA2019B401C"
opts.set_capability("appium:webDriverAgentUrl", "http://127.0.0.1:8100")
opts.set_capability("appium:usePrebuiltWDA", True)
opts.set_capability("appium:skipLogCapture", True)
d = webdriver.Remote("http://127.0.0.1:4723", options=opts)

d.activate_app("net.whatsapp.WhatsApp")      # launch/foreground an app
src = d.page_source                          # accessibility tree as XML
png = d.get_screenshot_as_png()              # screenshot
d.quit()                                     # end session (app stays open)
```

Working patterns (proven in the 2026-08 session):

- **Find bundle IDs**: `~/.venvs/ios/bin/pymobiledevice3 apps list` (JSON keyed by
  bundle id; match on `CFBundleDisplayName`). e.g. WhatsApp `net.whatsapp.WhatsApp`,
  中国移动 `cn.10086.app`.
- **Read screens**: parse `page_source`, keep elements with `visible="true"` and a
  non-empty label/value/name, print `type "label" @(x,y,wxh)`. Tap via
  `AppiumBy.ACCESSIBILITY_ID` when the label is unique, else `d.tap([(x,y)])` with
  the element's center.
- **Webviews** (common in Chinese apps): expose nothing while loading — wait and
  re-dump; once rendered the tree usually contains the full text. Fall back to
  screenshots (Read the PNG) when the tree is sparse.
- Session teardown (`d.quit()`) does NOT close the app on the phone — state persists
  between scripts, so iterative "act → dump → decide" loops across separate script
  runs work fine.

## Recovery

Any USB unplug/replug or tunnel blip kills the XCUITest session (launcher exits,
"Connection was terminated abruptly") and silently stales port forwards. Fix: rerun
`start-stack.sh`. Check tunnel state: `curl -s http://127.0.0.1:49151/` (device UDID
should be listed).

## Teardown

```bash
pkill -f "dvt xcuitest"; pkill -f "usbmux forward"; pkill -f appium
```

tunneld runs as root — ask Deyao to `sudo pkill -f tunneld` (leaving it running is
harmless).

## Rebuilding WDA (only if uninstalled or signing expired, ~1 year from 2026-08)

```bash
gh workflow run build-wda -R DE0CH/wda-build --ref main   # CI builds + signs, ~10 min
cd ~/cs/wda-build && ./scripts/fetch-wda.sh
ios install --path=out/WebDriverAgentRunner-Runner.app
```

One-time phone prerequisites (already done, listed for reinstalls): Developer Mode
ON; Settings > Developer > **Enable UI Automation** ON (else
`initializationForUITestingDidFailWithError`).

Do NOT use go-ios for tunnel/launch — its userspace tunnel is broken on iOS 26.5+
(danielpaulus/go-ios#772). go-ios is fine for `ios install` and other usbmux-only
commands.
