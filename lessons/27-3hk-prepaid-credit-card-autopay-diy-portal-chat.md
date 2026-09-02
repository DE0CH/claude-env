## 3HK prepaid credit-card Autopay & DIY portal chat (2026-08-20)

- **Autopay (credit-card auto-recharge) setup is server-side locked within 7 days of the
  package expiry** — the Subscription-setting Autopay switch renders `Mui-disabled` +
  `disabled` on the input, clicks are inert (no network call). The chatbot FAQ states it:
  >7 days out you can set up auto-recharge / change card / toggle auto-renew; within 7
  days you can only toggle auto-renew and buy packages. The renewal-reminder email can
  arrive AFTER the window closes. Plan: fund the renewal from wallet stored value this
  cycle, set up card autopay right after renewal for the next cycle. (Unconfirmed by a
  human: whether CS can override, and whether debit cards are accepted.)
- **The My3 app is the same web app**: spoofing UA `MoAppAndroid` changes nothing about
  the disabled switch — don't burn time on a cloud phone for portal-locked features.
- **DIY portal "Remember me" login survives in the Browserbase persistent context**: a
  NEW session on the regular context lands on the dashboard already logged in, NO OTP.
  Huge for follow-up sessions — just open the dashboard URL and check for "Welcome back".
- **DIY portal human chat**: the floating anime-girl avatar (`.ichat` draggable, bottom
  right) → "Online Chat" button → `3chatbot.three.com.hk` iframe, input `#chatbox`.
  3iChat (3ichat.three.com.hk) DEFLECTS prepaid customers to FAQ pages — the in-portal
  widget is the only prepaid chat entry. Typing 轉人工 repeatedly queues for a human
  ("all of our agents are occupied" = real queue). A human DID pick up once (~13:05 HKT,
  said "How may I help you?" ×3) but the conversation auto-closes in ~2-3 min without a
  reply — run a CONTINUOUS watcher (poll 15s) that AUTO-SENDS the prepared questions the
  instant a non-bot message appears; discrete watcher rounds with gaps missed the pickup.
  Bot replies always end with the "Please rate on the accuracy" block — that's the
  reliable bot-vs-human discriminator. An ended conversation leaves a "Confirm" dialog
  (MUI button, has child spans) that hides `#chatbox` until clicked. Widget auto-
  minimizes after idle; re-click the avatar to restore (history survives).
- Afternoon queue (14:00-16:00 HKT) stonewalled for 2h of continuous retries; the one
  observed pickup was ~13:05 HKT. Try lunch-hour next time.
