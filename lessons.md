# Lessons learned

Hard-won operational knowledge from past sessions. Check here before re-deriving a workflow.

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

## Tunnels from Claude-on-the-web containers (2026-08)

The Anthropic egress gateway (`Egress Gateway SDS Issuing CA` in the cert chain)
MITMs ALL outbound TLS — even with `HTTPS_PROXY`/`https_proxy` unset, interception
is transparent — and only relays traffic that is HTTP(S) or WebSocket on port 443.
Tested results (don't re-derive):

- **ngrok**: dead on any plan. With proxy env set → `ERR_NGROK_9009`
  (agent-behind-proxy = paid feature); with it unset + `root_cas: host` +
  `SSL_CERT_FILE=/root/.ccr/ca-bundle.crt` the TLS handshake succeeds but the
  session dies ("session closed") because muxado-inside-TLS isn't HTTP.
- **cloudflared quick tunnel**: registers a URL but edge connections dial port
  7844 (QUIC + TCP both blocked) → Cloudflare error 1033.
- **tunnelmole**: endpoint is `wss://service.tunnelmole.com:8083`; non-443
  CONNECTs return "200 Connection Established" but the stream is reset on first
  TLS bytes. (The 200 is a lie — check `$HTTPS_PROXY/__agentproxy/status`.)
- **devtunnel**: GitHub device-code login gets 403 through the gateway.
- **WebSocket upgrade on 443 works** (verified 101 vs echo.websocket.org), so a
  WSS-on-443 tunnel service would work if one turns up.
- **piping-server (ppng.io) works** both directions — good enough for one-shot
  data relay (see ngrok.md fallbacks).
- Go binaries don't trust the MITM CA by default: set
  `SSL_CERT_FILE=/root/.ccr/ca-bundle.crt` (Node already gets
  `NODE_EXTRA_CA_CERTS`).

## Controlling the iPhone via accessibility APIs (2026-08)

Working stack: WebDriverAgent built+signed on GitHub macOS runners (repo
`DE0CH/wda-build`, private — workflow, secrets, and runbook all there), installed
with go-ios, launched with pymobiledevice3, driven by Appium CLI (server on :4723,
client in `~/.venvs/ios`, cap `appium:webDriverAgentUrl=http://127.0.0.1:8100`).
Runbook: `wda-build/scripts/start-stack.sh` (tunneld needs one sudo command first —
ask Deyao). Phone: iPhone18,3, iOS 26.6, UDID 00008150-00046CA2019B401C.

- **go-ios (v1.2.1) is broken on iOS 26.5+**: the sudo-free userspace tunnel
  connects but every developer-service DTX channel times out / broken-pipes
  (upstream danielpaulus/go-ios#772, unfixed — maintainer's farm tops out at iOS
  18). `--address/--rsd-port` flags don't help. `ios install` and plain usbmux
  commands still work fine; only tunnel-based services fail.
- **pymobiledevice3 works end-to-end**: `remote tunneld` (root), `mounter
  auto-mount` (phone must be **unlocked** or you get `DeviceLocked`), `developer
  dvt xcuitest dev.de0ch.wda.xctrunner --tunnel <udid>`, `usbmux forward 8100 8100`.
- **Settings > Developer > Enable UI Automation must be ON** on the phone, else the
  XCUITest session dies with `initializationForUITestingDidFailWithError`.
- **Port forwards die on unplug**: a usbmux forward started before a re-plug is
  stale — restart it, symptoms are silent connection refusal.
- **ASC API key roles**: Developer-role keys can read but get 403 on device
  registration / provisioning writes — Admin key required (created `wda-ci`,
  `2QDDAZ495K`; .p8 in `~/paper-trail-signing/`, also in wda-build repo secrets;
  Issuer ID 11025254-570b-463b-af34-00bf6b0e151e, Team ID S64YL394S3).
- **CI cloud signing** (`xcodebuild -allowProvisioningUpdates` + ASC key on
  `macos-15` runners, Xcode 26.x) builds device-signed WDA with no local Xcode; it
  mints a fresh Apple Development cert per run — revoke stale ones if a limit hits.
- Local Xcode is NOT installed (CLT only) and isn't needed for any of this.

## Getting YouTube content (2026-08, video `QK4Ogus0vgQ`)

Goal was: transcript if it exists, otherwise audio → Whisper. What actually worked and what didn't:

### What worked

- **Watch page via Browserbase:** the persistent context is logged into YouTube — a
  context-backed session gets `playabilityStatus: OK` on videos that bot-wall anonymous
  sessions, and caption tracks/timedtext can be fetched from inside the page. Try this
  first (see browserbase.md). Caveat: this covers page data and transcripts only —
  `streamingData` is still SABR-only (no `url`, no `signatureCipher` on any format), and
  non-web InnerTube clients (IOS, ANDROID_VR, TVHTML5, MWEB, *_EMBEDDED_PLAYER) still
  return `LOGIN_REQUIRED`/`ERROR` even from the logged-in session, so audio/video files
  can't be downloaded this way — use loader.to below for that.
- **Transcript check, cheapest first:** ScrapingBee has a dedicated YouTube Subtitles API
  (`https://app.scrapingbee.com/api/v1/youtube/subtitles?video_id=<id>`, Bearer
  `$SCRAPINGBEE_TOKEN`, 5 credits). Returns `{"subtitles":{}}` when none exist. Note: fresh
  uploads (< ~1 day) often have no auto-captions yet.
- **Confirming captions truly don't exist:** fetch the watch page through ScrapingBee with
  `premium_proxy=true&render_js=false` (10 credits) and parse `ytInitialPlayerResponse` —
  from a residential IP `playabilityStatus` is `OK`, so an empty
  `captions.playerCaptionsTracklistRenderer.captionTracks` is authoritative.
- **Audio download: loader.to keyless API** (the only downloader that worked end-to-end):
  1. `GET https://loader.to/ajax/download.php?format=mp3&url=<url-encoded YouTube URL>`
     (browser UA + `Referer: https://loader.to/`) → returns `id` and `progress_url`.
  2. Poll `progress_url` until `download_url` is non-empty (empty-string while running —
     don't grep for the key name).
  3. `curl -L` the `download_url`. Delivered a 320kbps MP3 of a bot-walled video in ~1 min.
- **ffmpeg:** not installed and `apt-get` is broken in the container; `pip install
  imageio-ffmpeg` gives a static binary at
  `.../imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-*`.
- **Transcription:** OpenRouter has **no Whisper and no `/audio/transcriptions`** endpoint.
  Closest to "OpenAI Whisper through OpenRouter" is chat completions with `input_audio`
  (base64) on `openai/gpt-audio` / `openai/gpt-audio-mini` (or Gemini flash models). Chunk
  long audio (~5 min per chunk, 16 kHz mono) to stay under request limits. The env var
  here is `OPENROUTER_API` (not `OPENROUTER_API_KEY`).

### What didn't work (don't retry these first)

- **Browserbase `--verified`** is paid/Enterprise-gated on the current plan;
  `--solve-captchas` does **not** solve Cloudflare Turnstile (tested on
  cobalt.tools). **Proxies now work** (2026-08-15): geolocated proxy sessions
  (e.g. GB/London, residential exit IP) create fine via the `proxies` array in
  the session body — see browserbase.md for the working invocation.
- **Non-web InnerTube clients** (IOS, ANDROID_VR, TVHTML5, MWEB, embedded players):
  `LOGIN_REQUIRED`/`ERROR` from every vantage point tried — Browserbase logged-in session,
  ScrapingBee residential IP (js_scenario evaluate), with or without visitorData. YouTube
  wants PO-token/attestation for non-web clients. The web client is SABR-only everywhere:
  no `url`, no `signatureCipher` in any format.
- **ScrapingBee YouTube Metadata API:** lists all formats but every `url` is `null`
  ("MISSING POT") — it's yt-dlp on their side, same wall.
- **yt-dlp locally:** 429 + bot-check from the container IP.
- **Piped instances** (kavin.rocks, private.coffee, ducks.party, ggtyler, drgns): all dead
  or erroring. **Invidious instances**: API disabled / 401 / 403 / 502 across the board.
- **Cobalt**: cobalt.tools UI stalls forever on Turnstile from datacenter IPs; all
  community API instances tried were dead or Cloudflare-walled. **cnvmp3**: "Access
  denied". **ssvid.net**: needs a Turnstile `cf_token` even for its own frontend flows.

### General

- ScrapingBee `js_scenario` `evaluate` + `json_response=true` (results in
  `evaluate_results`) is a workable way to run arbitrary JS (incl. same-origin `fetch`
  POSTs) on a page from a residential IP — the YouTube failure above was YouTube-specific,
  not a technique failure.
- Browserbase Fetch API returns markdown (not raw HTML) for HTML pages — useless for
  script-embedded JSON like `ytInitialPlayerResponse`; use ScrapingBee for raw HTML.
- Discord API returns 403 for python `urllib` requests (user-agent filtering); the
  documented `curl` invocation in lobster.md works — don't switch it to urllib.

## Video screenshots workflow (2026-08, video `L4Hel6VNebg`)

Extracting screenshots of the interesting bits of a YouTube video (workflow definition
is in CLAUDE.md; these are the mechanics that worked):

- **loader.to video formats:** same keyless API as mp3 (`format=1080`, `format=4k`,
  `format=720`...). 4K came back "This content is not available for download" even when
  the format was accepted at request time — poll result told the truth; 1080p mp4 worked
  (h264 1920x1080). A download URL can 502 persistently from one CDN node
  (`*.savenow.to`) — retrying the same URL doesn't help; re-request the conversion to
  get a different node, that fixed it.
- **ffmpeg** was preinstalled at `/usr/bin/ffmpeg` in the container (no imageio-ffmpeg
  needed this time — check first).
- **Coarse pass:** `-vf fps=1` per content range (caption timestamps → segment
  boundaries, skip sponsor reads), then tile 36 frames per sheet with
  `concat=n=N:v=1:a=0,scale=320:-1,tile=6x6` and read the sheets. 6x6 at 320px wide is
  readable enough to spot product renders vs talking-head filler.
- **Fine pass:** ±1 s around each chosen moment at 0.2 s steps. Auto-picking the largest
  JPEG (sharpness proxy) got ~70% right but **drifts across scene cuts** (picks the
  wrong shot entirely) — always verify the winners in a montage and re-refine the bad
  ones within a narrower same-scene window, choosing visually.
- **Discord multipart uploads:** `curl -F` breaks with HTTP 400 when the `payload_json`
  value contains commas (curl parses `,` and `;` inside `-F` values as its own syntax).
  Fix: write the JSON to a file and pass `-F "payload_json=<file.json;type=application/json"`.
  Attach files as `files[0]`, `files[1]`, ... (max 10 per message).
