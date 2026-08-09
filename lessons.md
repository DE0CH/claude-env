# Lessons learned

Hard-won operational knowledge from past sessions. Check here before re-deriving a workflow.

## Getting YouTube content (2026-08, video `QK4Ogus0vgQ`)

Goal was: transcript if it exists, otherwise audio → Whisper. What actually worked and what didn't:

### What worked

- **Bot-walled videos:** the persistent Browserbase context is logged into YouTube — a
  context-backed session gets `playabilityStatus: OK` on videos that bot-wall anonymous
  sessions. Try this first (see browserbase.md).
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

- **Browserbase (free plan) + YouTube without the logged-in context:** datacenter IP gets
  "Sign in to confirm you're not a bot" (`LOGIN_REQUIRED`) on the watch page and all
  InnerTube clients (WEB_EMBEDDED_PLAYER, TVHTML5*, IOS, MWEB, ANDROID). `--proxies` and
  `--verified` are paid/Enterprise-gated; `--solve-captchas` does **not** solve Cloudflare
  Turnstile on cobalt.tools.
- **Non-web InnerTube clients from a residential IP (ScrapingBee js_scenario evaluate):**
  still `LOGIN_REQUIRED` — YouTube now wants PO-token/attestation for non-web clients, and
  visitorData doesn't rescue it. Web client from residential IP gets `playabilityStatus:
  OK` but is SABR-only: no `url`, no `signatureCipher` in any format.
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
