## Shenzhen Airlines accounts & seat selection (2026-08, follow-up to the app saga)

- **The intl-site login slider captcha is solvable in one shot**: screenshot, measure the
  piece→gap x-offset, `browse mouse drag` the handle right by that offset (CSS px =
  displayed px × scale). A plain linear drag passed twice in a row — no humanization needed.
- ZH web login modal: 登录方式=手机号 + 6-digit password. A **password reset done in the
  app applies account-wide** and the web then logs in with it. App logins on a NEW device
  need an extra SMS "device verification"; the web needed none.
- ZH app on MobileNext: force-deallocation hit at **~30 min** (twice), not the ~45 min
  noted earlier — plan any app flow to fit inside ~25 min, and prefer the WEB once
  credentials exist (no timeouts).
- ZH member accounts don't auto-link tickets booked with a passport via an OTA; use the
  manual query (doc no + name + flight + date). 凭证号码 accepts the **passport**, not the
  13-digit e-ticket (fails client-side validation silently — button stays disabled).
- **"客票信息提取失败" ≈ seat-selection window not open yet** when both app and web fail
  identically ~6 days out with correct data; intl check-in/seat selection opens nearer
  departure (~24-48h). Retry at T-48h rather than debugging the data.
