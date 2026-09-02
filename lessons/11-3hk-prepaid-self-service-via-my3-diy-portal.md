## 3HK prepaid self-service via My3 / DIY portal (2026-08)

Context: reissued the eSIM for 66232317 (adapter → iPhone) and did real-name
registration. The My3 Android app is a webview wrapper around
`three.com.hk/prepaid/DIY/<en|tc>/` — anything the app does, a desktop browser
session on that portal does too, with fewer failure modes.

- **Login**: number → "Send verification code (OTP) to log in" (SMS to the 3HK
  number). The app forgets the session on every cold start, and each new login
  needs a fresh OTP — batch the whole flow in one go. On the web portal the OTP
  boxes are per-digit inputs: `browse fill` digit 1, then `browse type` the rest.
- **eSIM reissue** (prepaid): dashboard gear icon → Subscription setting →
  "Change SIM card" → eSIM → HK$28, FPS supported (QR shown in-page, ~15 min
  validity; poll for the page change to detect payment). New eSIM QR is emailed
  to the registered address; old profile stays live until the new one activates.
- **Real-name registration after SIM change**: dashboard banner → REGISTER NOW.
  Consent page pre-ticks 3 direct-marketing boxes (opt-out = untick). iAM Smart
  "instant approval" path shows a QR (~1 min validity, auto-refreshes): push
  screenshots to Discord in a tight loop keyed on md5 change, and detect scan
  success by the URL leaving `iamsmart.gov.hk` (lands on
  `/prepaid/DIY/en/rnr-reg/s/H3SUB…`). **Dead end for remote automation**: after
  ID-type selection the flow demands a live camera scan of the physical HKID
  ("Please use a mobile phone or tablet with camera function") — hand off to
  Deyao's own phone at that point; same-device iAM Smart also skips the QR race.
- The My3 app's in-app iAM Smart webview returned to a blank
  `/prepaid/DIY/tc/iamsmartauth` page after a successful scan (submission lost);
  the desktop-browser flow worked. Prefer the browser.
- MobileNext cloud devices get force-deallocated after ~45 min regardless of
  activity — don't park a login on one across a long wait.
