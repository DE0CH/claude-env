## Browserbase tab crash mid-task: recover over raw CDP, don't fight the browse daemon (2026-08-26, 3HK renewal)

During the 3HK plan renewal the portal tab died moments after the live-view link was
sent (Deyao saw "WebSocket disconnected"; `browse tab list` returned `[]`), and from
then on the browse daemon could never re-attach to that session ("Timed out waiting
for driver daemon session", even after `browse stop --force`). The SESSION AND BROWSER
WERE FINE the whole time: `chromium.connectOverCDP(connectUrl)` (connectUrl re-fetched
via `browse cloud sessions get`) worked instantly. Recovery pattern: switch the whole
flow to Playwright-over-CDP in short one-shot scripts (connect → act → close), redo the
login, re-stage, and carry on — don't burn time resurrecting the daemon.

Related gotchas from the same task:
- A tab crash logs the 3HK DIY SPA out (login state is per-tab); the remember-me
  cookie did NOT rescue it → budget a fresh SMS OTP after any tab death.
- The sessions `/debug` endpoint's `pages` list can be stale/misleading while the
  daemon holds the session. Before sending Deyao a live-view URL, get the REAL page id
  via CDP (`Target.getTargetInfo`) and build/pick the `debuggerFullscreenUrl` for that
  id — a URL pinned to a dead page id is exactly the "blank live view" failure mode.
- MUI dialogs on the portal ("Duplicate Purchase") have a `Buy` button whose text
  collides with the header `BUY`; Playwright `button:has-text()` grabs the wrong one
  and times out on the overlay — click by exact `innerText.trim() === 'Buy'` match.
- 3HK checkout: 365-day tab auto-selects the HK$120 12GB plan; the "same plan" for
  the 120GB combo is HK$270 (100GB+20GB) — always confirm the cart says "120GB".
- FPS payment page (`/payment/fps?transactionId=…`) shows a ~15 min countdown and
  redirects itself to `/checkout/payment/finished` on success — polling `page.url()`
  for leaving `/payment/fps` is the clean success/failure signal.
