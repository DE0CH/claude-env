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
