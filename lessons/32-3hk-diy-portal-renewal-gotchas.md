## 3HK DIY portal renewal gotchas: tab crash, MUI buttons, FPS payment (2026-08-26)

During the 3HK plan renewal the portal tab died mid-flow and the browser-driver daemon
could never re-attach, while the browser itself was fine. Recovery pattern that worked:
switch the whole flow to Playwright-over-CDP in short one-shot scripts (connect → act →
close) against the browser's CDP URL, redo the login, re-stage, and carry on — don't burn
time resurrecting a wedged driver daemon.

Gotchas from the same task:
- A tab crash logs the 3HK DIY SPA out (login state is per-tab); the remember-me
  cookie did NOT rescue it → budget a fresh SMS OTP after any tab death.
- MUI dialogs on the portal ("Duplicate Purchase") have a `Buy` button whose text
  collides with the header `BUY`; Playwright `button:has-text()` grabs the wrong one
  and times out on the overlay — click by exact `innerText.trim() === 'Buy'` match.
- 3HK checkout: 365-day tab auto-selects the HK$120 12GB plan; the "same plan" for
  the 120GB combo is HK$270 (100GB+20GB) — always confirm the cart says "120GB".
- FPS payment page (`/payment/fps?transactionId=…`) shows a ~15 min countdown and
  redirects itself to `/checkout/payment/finished` on success — polling `page.url()`
  for leaving `/payment/fps` is the clean success/failure signal.
