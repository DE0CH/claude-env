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
  datacenter proxy, playwright-stealth + human mouse warm-up + reload. All 403. The `_abck` cookie stays
  `~-1~` (sensor never validates). A real device (mobilerun/MobileNext phone Chrome) is the remaining route.
- Reading the app's flow: the sessionStorage keys `tsp:bookingStore` etc. show the zustand state
  (`initialized`, `createSessionFinish`, `flightSearchData`) — a quick way to see where it stalled.
