## ZH888 window-seat round 3: seat was already assigned — CHECK 已选座位 FIRST (2026-08-22)

Task "select a window seat" for a business ZH888 ticket ended with zero seat-changing:
the trip ALREADY had 01A (front-row window) assigned — likely at booking/by the OTA.
The whole battle with seat maps was unnecessary.

- **LESSON #1: before fighting any seat-selection flow, FIRST check whether a seat is
  already assigned**: app → 选座值机 → 已选座位 tab (or run the manual query and read the
  "该行程已完成选座值机" dialog). Business tickets often come pre-seated.
- **Global-site (global.shenzhenair.com) web check-in CAN be driven end-to-end** with a
  human doing the sliders via Browserbase live view: homepage 选座值机 widget → fill →
  `seatCheckin('seatCheckIn')` → login modal (prefill password; human enters phone +
  drags jigsaw) → submit slider (human drags) → lands on
  `/zhair/ibe/checkout/airAncillaries.do` with the FULL seat map. Enter via
  `flightSearch.do?language=zh&market=CN` homepage — the standalone toCheckIn.do page's
  submit button never gets its JS handler bound (dead page variant).
- On the web seat map (`#SeatNo_1A` etc, `already-book`/`not-book` classes), every
  not-book click returned 运营保障，该座位不可选 — for THIS flight even non-window seats;
  probably because online assignment was closed/held, while the pre-assigned 01A showed
  as already-book. Don't burn hours on 运营保障 without checking existing assignment.
- **Browserbase silently IGNORES external proxies** (`type:external`, IPRoyal + Evomi
  both, `proxyBytes:0`, exit = AWS) and silently no-ops `browserbase`-type geolocation
  CN/HK on this plan. Don't plan CN-exit browsing via Browserbase.
- **ScrapingBee premium CN (`country_code=cn`) DOES reach www.shenzhenair.com** (the
  mainland site, unreachable from everywhere else we tried) — but exits are flaky
  (~30% success, ERR_TUNNEL/ERR_CONNECTION_CLOSED otherwise) and EVEN error pages
  billed 25 credits with render_js. One-shot recon only, never interactive flows.
- Mainland guest check-in exists login-free: `checkIn/initCheckInTC.action`, form
  `checkInTongChengInputForm` (name/cert/date/cities/phone + SMS code to any entered
  phone via `sendCodeBtn`), behind the vodka/dfp anti-bot interstitial (needs JS + ~10s).
- ZH mainland web CS chat: `chat.shenzhenair.com/zxkf_sz/chatAction.do?action=firstInto&acceptedAccount=szair_web`
  — reachable from ANY IP (not CN-gated), SMS-code login, but 服务须知 says intl flights
  NOT handled (国内 only; intl → 95361).
- mobilerun re-provision after key fix: APK download via imtt.dd.qq.com REDIRECTS to
  `*.rdt.tfogc.com:49156` which FAILS through IPRoyal residential SOCKS5 — do the
  download on the Evomi datacenter proxy (per the two-tier install-then-swap flow),
  then swap to IPRoyal CN before first app launch. Chrome (not stock browser) needs
  the real APK URL extracted from the 应用宝 page HTML (regex `https?://...apk`, CDP
  execute-script) and opened directly; its 安全下载 button does nothing in Chrome.
- ZH app fresh-device SMS login worked exactly as documented (one SMS, no slider);
  "网络开小差了" on 获取验证码 = rotate the IPRoyal sticky session token and retry.
