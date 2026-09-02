## ZH app on a mobilerun cloud phone (2026-08-18, seat-selection attempt #3)

End-to-end app path works: provision `android_cloud_phone` (billing=minute, ~$0.03/min,
locale zh-CN / Asia/Shanghai) with Evomi HK datacenter SOCKS5 for the install phase, swap
to IPRoyal `_country-cn` sticky BEFORE first app launch (got a real 广州移动 mobile IP),
install 深圳航空 via the 应用宝 page in device Chrome, login, drive the whole UI over the
REST API (`tap`/`keyboard`/`screenshot`/`ui-state`). Specifics:

- **应用宝 install flow on stock AOSP**: the page's big 安全下载 button starts the APK
  download directly (silently); confirm Chrome's 想下载多个文件→允许 and 文件可能有害→
  仍然下载 dialogs. Open the finished APK from the 文件 app (`com.android.documentsui`,
  launch via PUT /apps/{pkg} with EMPTY JSON body `{}` — no body = 400). Decline the
  Play-Protect enable prompt (拒绝) — it eats the first install tap.
- **Read device screens as TEXT, not screenshots** (Deyao, 2026-08-22): default to
  `GET /v1/devices/{id}/ui-state` — the `a11y_tree` JSON has every element's
  text/contentDescription + boundsInScreen (tap center = midpoint) + isClickable.
  Flatten it (see `scratchpad/ui.py` pattern: walk children, print `'text' @(cx,cy) CLK`)
  and grep. Far cheaper and faster than screenshot→vision. Screenshots only for genuinely
  visual things (jigsaw captchas, image layout, seat-map colors).
- **mobilerun API gotchas**: open-deep-link wants `{"deepLink":...}` not `url`;
  `/global` action is an integer (1=BACK); `/devices/{id}/stop` (park) is
  **unsupported** for android_cloud_phone — you cannot pause billing, terminate instead
  and re-provision later; keyboard `text` handles Chinese fine; the app's 6-digit
  OTP boxes take only the first char of a multi-char `text` — send remaining digits
  one per call.
- **ZH app login**: password login (账号密码登录) + new-device SMS verification, same
  as MobileNext run. App is fully usable on the CN mobile proxy.
- **Trip visibility at T-5.7d**: manual 选座值机 query (为其他证件/票号, 护照+伦敦→深圳+
  2026-08-23) → 温馨提示 "暂未获取到行程"; linking the passport to the member account
  (行程 tab → 补全证件 → 新增证件成功) also shows no trip. Same wall as the T-6d web
  attempt — intl seat selection opens ~24–48h out. Retry Routine armed for
  2026-08-21T21:30Z (fresh session, phone path).
- A 服务大厅 first-visit tutorial overlay blocks everything and survives BACK — the
  only listed seat entry is 选座值机 anyway (no separate intl entry).
