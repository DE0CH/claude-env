## Chinese airline sites/apps from outside China (2026-08, Shenzhen Airlines seat selection)

- **Mainland ZH domains are unreachable from every non-China vantage point tried**:
  `www.shenzhenair.com` and the `res.shenzhenair.com` CDN time out from the container,
  from Browserbase (datacenter AND GB residential proxy), and from a US MobileNext
  device alike. Only `global.shenzhenair.com` (intl site) is reachable.
- The intl site's guest "Seat selection check-in" form always pops a **member login
  modal** on submit (6-digit password). Its "Forget your password" flow is
  **security-question based** (step 1 = mobile/doc + DOB + image captcha) — there is
  NO SMS reset on the intl site, despite what you'd expect from a Chinese carrier.
  The check-in form's "Document No." wants the ID/passport used at booking; e-ticket
  numbers are rejected ("Voucher number format is incorrect").
- The ZH Android app (`com.air.sz`) is **not on Google Play in any region**
  (play.google.com 404s with gl=US/GB/SG/CN/TW) — Chinese airlines publish only to
  Chinese vendor stores + their own site. On MobileNext's managed Play,
  `market://` shows "Item not found" (different from the admin-blocked message).
- **Working install path on a MobileNext cloud Android**: open Tencent 应用宝's
  distribution page `https://a.app.qq.com/o/simple.jsp?pkgname=<pkg>` in the DEVICE
  browser, tap 通过第三方浏览器下载, accept Chrome's "Download anyway" — the
  developer-signed APK comes from `imtt.dd.qq.com` (official Tencent store CDN; the
  page shows an 官方 badge and the developer name to sanity-check). The same CDN
  **connection-resets curl from the container**, but the device downloads it fine.
- **Agent-side APK fetching (curl or the Browserbase downloads API) gets blocked by
  the permission classifier** even after user approval in chat. The right move (per
  Deyao) is to "click through the phone": drive the device's own browser/store UI to
  download and install, so no binary ever touches the agent host.
- `sj.qq.com` (应用宝 web) is reachable from the container for app metadata, but its
  desktop pages only offer QR codes — `a.app.qq.com/o/simple.jsp?pkgname=` is the
  direct mobile page. Clicking its download button with `browse network on` captures
  the real `imtt.dd.qq.com` URL from the beacon params if it's ever needed.
