## True-4K YouTube frames via Browserbase player screenshots (2026-08, `L4Hel6VNebg`)

loader.to tops out below 4K: `format=4k` is accepted at request time but the progress poll
ends in "This content is not available for download" even when the video has 2160p
(verified via the watch page's `adaptiveFormats`). Undocumented `format=1440` DOES work.
For real 4K frames, skip the download and screenshot the player in a logged-in Browserbase
session (playwright is installed globally for node — `NODE_PATH=$(npm root -g)`, connect
with `chromium.connectOverCDP(connectUrl)`):

- Force quality with the player API: `movie_player.setPlaybackQualityRange('hd2160','hd2160')`
  (check `getPlaybackQuality()` per frame); `p.seekTo(t); p.pauseVideo()` per timestamp, wait
  for `video.readyState >= 2` and `currentTime` near target.
- **Viewport**: `Emulation.setDeviceMetricsOverride {width:3840, height:2160, deviceScaleFactor:1}`
  via `ctx.newCDPSession(page)` works on Browserbase (window.innerWidth really becomes 3840).
  DSF:2 + Playwright `screenshot({scale:'device'})` does NOT give device pixels here —
  Playwright ignores emulation it didn't set itself. Use a big CSS viewport at DSF 1 instead.
- **Overlay trap**: pinning the video to `position:fixed; 100vw/100vh; huge z-index` is not
  enough — the related-videos column still paints on top (the video can't escape its
  stacking context), and element screenshots include whatever overlaps. Fix:
  `document.body.appendChild(video)` (playback survives re-parenting; MSE stays attached),
  then `ytd-app, #masthead-container { display:none }`. Screenshot `body > video` as
  JPEG (`type:'jpeg', quality:92` — 4K PNGs are slow over remote CDP, ~20s+ each).
- ~25s per frame end-to-end; batch everything into one session and mind 10-minute Bash
  timeouts (run in background). Release the session when done.
- Discord accepts ~900KB 4K JPEGs fine, 10 per message.
