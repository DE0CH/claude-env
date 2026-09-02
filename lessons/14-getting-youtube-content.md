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

- **Browserbase `--verified`** is paid/Enterprise-gated on the current plan.
  **Browserbase HAS built-in captcha solving — use it FIRST** (Deyao, 2026-08-19):
  create the session with `browserSettings: {solveCaptchas: true}` and wait on the
  solver's own signal — it logs `browserbase-solving-started` /
  `browserbase-solving-finished` to the page console (Playwright `page.on('console')`);
  keep a page-text poll as fallback. Verified working on archive.today's "One more step"
  interstitial (a session without it hit the wall; with it, sailed straight through).
  Reach for residential proxies only after the built-in solver fails. Known limit:
  it did **not** solve Cloudflare Turnstile on cobalt.tools (tested 2026-08).
  **Proxies now work** (2026-08-15): geolocated proxy sessions
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
