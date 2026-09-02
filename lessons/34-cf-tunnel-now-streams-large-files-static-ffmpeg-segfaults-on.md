## cf-tunnel now streams large files; static ffmpeg segfaults on HLS TS (2026-08-29)

- **The tunnel can now carry big files** (proven: 76MB mp4, byte-identical, ~13MB/s).
  The old protocol sent each response as ONE base64 WS message and died at
  Cloudflare's ~1MB WS message cap ("1009 Message is too large" in the agent log,
  502 at the client) on anything over ~700KB. agent.js/worker.js now speak a
  chunked protocol (res-start / res-chunk×N / res-end, 512KB raw per chunk,
  res-cancel for aborted downloads; legacy single-message "res" still accepted).
  If a big transfer 502s in a future session, the worker deploy is stale — redeploy
  with `cd cf-tunnel && CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API" npx wrangler deploy`.
  Do NOT re-run deploy.sh for this: it re-mints the Access service token and
  invalidates the CF_ACCESS_CLIENT_ID/SECRET already in the environment config.
  Worker memory buffers an unthrottled body server-side, so single responses
  should stay under ~100MB (DO memory limit); split anything bigger.
- **imageio-ffmpeg's static build (7.0.2, johnvansickle) segfaults** probing/remuxing
  real-world MPEG-TS (xvideos HLS segments) — instantly, exit 139, works fine on
  lavfi synthetic input. `apt-get update && apt-get install -y ffmpeg` DOES work in
  the current web pods (install without update 404s on stale indexes) and that
  ffmpeg (6.1.1) handled the same files fine. Static ffmpeg also segfaults on
  https:// input URLs through the egress gateway — but curl-ing HLS segments and
  concatenating locally sidesteps both problems: xvideos HLS is unencrypted TS,
  `cat` the segments in playlist order, then `-c copy -bsf:a aac_adtstoasc`.
- **xvideos video downloads**: the player page's `setVideoUrlHigh` mp4 tops out at
  360p; the real max lives in the HLS master (`setVideoHLS`). The tokenized
  hls-cdn77 URLs from a Browserbase page load work from the container IP too
  (no IP binding observed), so grab the URL via Browserbase, then curl directly.
- **`pkill -f`/`pgrep -f` self-kill trap**: the pattern matches the calling shell's
  own -c command line (exit 144 with no other symptom). Use a bracketed regex
  (`pgrep -f "agent[.]js"`) AND keep the restart (which contains the literal
  string) in a separate Bash call.
