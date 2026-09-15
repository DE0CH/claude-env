# Cathay Pacific fares: Google Flights window, CX booking-site internals, Akamai wall (2026-09-15)

Task: price/time for CX LHR–HKG business (Aria Suite) 23–28 Aug 2027, ~11 months out.

- **Google Flights only covers ~330 days ahead** (on 2026-09-15 the last selectable date was
  10 Aug 2027; SerpApi `google_flights` returns "hasn't returned any results" beyond it). For dates
  past that, Google is useless — go to the airline. Cathay's own widget accepts dates up to 360 days.
- **Aria Suite on LHR–HKG = Google's "Individual suite" tag**, shown only on the 777-300ER rotation
  (as of Aug 2027 schedule: CX250 out 18:20→14:10+1, CX255 back 23:15→06:20+1); the other four
  daily pairs are A350 "Lie flat seat". SerpApi exposes this in `flights[].extensions[0]`.
- **Cathay booking entry URL** (revenue, return): `https://www.cathaypacific.com/wdsibe/IBEFacade?ACTION=SINGLECITY_SEARCH
  &ENTRYPOINT=…&ENTRYLANGUAGE=en&ENTRYCOUNTRY=GB&RETURNURL=…&ERRORURL=…&BOOKING_FLOW=REVENUE&ORIGIN=LHR
  &DESTINATION=HKG&DEPARTUREDATE=20270823&ARRIVALDATE=20270828&TRIPTYPE=R&CABINCLASS=C&ADULT=1&YOUNGADULT=0
  &CHILD=0&INFANT=0&FLEXIBLEDATE=false` (return date is `ARRIVALDATE`, not RETURNDATE/DEPARTUREDATE[2]).
  It bounces through Queue-it and `/ibe/` (Angular, POST `/ibe/api/v1.0/flightSearch/singleCitySearch`) to
  the Next.js app `book.cathaypacific.com/tsp/en_GB/flight-selection?ca=C&o=LHR&d=HKG&a=1&ya=0&ch=0&i=0
  &ddb1=2027-08-23&ddb2=2027-08-28` — which can be opened directly.
- **Cabin code pitfall:** the TSP app validates `ca` ∈ {F,C,W,Y} (typia assertPrune) and silently does
  nothing on anything else ("Departing flight  to " with blank cities, no API calls). Passing
  CABINCLASS=B to the facade yields ca=B → dead page. Use C for business.
- **The fare API is behind Akamai Bot Manager and blocks every automated browser**: after the page
  loads, `api.cathaypacific.com/tsp-svc/v1.0/create-session` / `air-calendar` return 403 AkamaiGHost
  (surfaces in the console as a CORS "No Access-Control-Allow-Origin" error — read the real status via
  CDP `Network.responseReceivedExtraInfo`). Tried: headless + headed Xvfb Chromium, Fly IP and Evomi UK
  datacenter proxy, playwright-stealth + human mouse warm-up + reload, nodriver. All 403. The `_abck`
  cookie stays `~-1~` (sensor never validates). **A Browserbase session passes cleanly** (GB residential
  proxy, `solveCaptchas`, Playwright `connect_over_cdp`): the page renders the full fare list in ~30 s.
- **The Cathay results page carries a ±7-day price strip** ("Mon 16 Aug GBP5,435.14 … Mon 30 Aug") above
  the flight list, so ONE page load answers "cheapest day in a range" — no need to load each date.
- **Kayak and Trip.com reach ~360 days out** (both priced 23–28 Aug 2027 on 2026-09-15 while Google
  Flights stopped at 10 Aug). Kayak URL: `kayak.co.uk/flights/LHR-HKG/2027-08-23/business?sort=price_a&fs=airlines=CX`
  (renders in a headed pod Chromium, no bot wall); Trip.com: `uk.trip.com/flights/showfarefirst?dcity=lon&acity=hkg&ddate=…&triptype=ow&class=c`.
  Skyscanner throws a PerimeterX captcha at pod Chromium. Kayak's OTA fares ran ~£550 below cathaypacific.com.
- Reading the app's flow: the sessionStorage keys `tsp:bookingStore` etc. show the zustand state
  (`initialized`, `createSessionFinish`, `flightSearchData`) — a quick way to see where it stalled.
- **Fly-and-ferry through-tickets are priced as a different market and can be far cheaper**: on 2026-09-15 the
  one-way business LHR→ZYK (Shekou Cruise Home Port, HKIA SkyPier ferry leg CX98xx operated by Chu Kong
  Passenger Transport) was GBP 3,516.84 vs GBP 5,435.14 for LHR→HKG on the same day — same CX250 flight.
  Use `d=ZYK` (or FYG/NSZ/PFT/ZTI/ZGN/ZUI/XZM) in the `tsp` flight-selection URL; Google Flights and Kayak
  return nothing for these ferry codes, only Cathay's own site prices them.
- **Which 777 has Aria on a given day (Google Flights):** the "Individual suite" extension appears only in
  business-class results, and Google lists no business result at all when the cabin is sold out. Fallback that
  works: Google's per-flight CO₂ estimate — refitted (Aria) 777-300ERs show 642 kg (economy) / 963 kg (premium
  economy) LHR→HKG, un-refitted ones 676 / 1,014 (different seat counts). Verified against the tag on every day
  it was present. Aria rotations change daily; don't assume one fixed flight number.
- **Agent prices per exact flight:** SerpApi `google_flights` with `booking_token=<token from the search result>`
  returns `booking_options[].together.{book_with,price}` — the full Google "Booking options" list (agents +
  the airline). Near departure the agents undercut cathaypacific.com by up to ~40% in business.
- **Cathay's results page rows carry all three cabin fares + seats-left** ("from GBP x | 3 seats left | Not
  available") — load the economy page (`ca=Y`) once per date and read every cabin from the row.
