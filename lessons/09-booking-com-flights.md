## Booking.com flights: order access + Gotogate changes (2026-08, LHR–SZX booking)

- Order-details links from confirmation emails hit a **"You need permission to access
  this booking" wall**; "Verify with email" sends a 6-char code to the booking's
  contact email (per-character input boxes: `browse fill` box 1 + `browse type` rest).
  The Booking.com-context cookie did not cover a different traveller's booking.
- The order page's **"Customer reference" equals the Gotogate order number** — use it
  to authenticate scary-looking `*.gotogate.support` payment emails (Brevo-tracked
  links, odd sender domain, but same order ref = genuine). PIN code sits next to it.
- Price details show pending "Booking changes" (e.g. "Flight change £2,308") that are
  **added to the total even while unpaid**; the itinerary/cabin display stays stale
  (still showed Economy + old seat) after payment and even after the change is
  ticketed — the **e-ticket number updating is the reliable signal** of reissue.
- Booking.com flights **live chat** (Help centre → Continue without an account →
  confirmation number → topic → Start chat) is handled by Gotogate agents and works
  well for "was payment received / is the change ticketed / what's the new e-ticket
  number". They **cannot assign seats** — seats must go through the airline.
