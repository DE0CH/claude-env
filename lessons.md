# Lessons learned

Hard-won operational knowledge from past sessions. Check here before re-deriving a workflow.

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

- **Browserbase `--proxies` and `--verified`** are paid/Enterprise-gated on the current
  plan; `--solve-captchas` does **not** solve Cloudflare Turnstile (tested on
  cobalt.tools).
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
