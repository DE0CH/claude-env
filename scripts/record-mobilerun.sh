#!/usr/bin/env bash
# Self-hosted mobilerun session recorder (no vendor recording API needed).
# Polls the device's native screenshot endpoint at a target FPS and stitches the
# frames into an mp4 with ffmpeg. Because each frame IS the device screen, the
# output is automatically at the phone's exact resolution/aspect ratio.
#
# Usage:
#   scripts/record-mobilerun.sh <deviceId> <outFile.mp4> [durationSec] [fps]
#     durationSec omitted -> record until SIGINT/SIGTERM, then finalize.
#     fps default 2 (screenshot endpoint is ~1-3 fps realistic).
#
# Env: MOBILERUN_API (bearer token). FFMPEG override optional.
set -euo pipefail

DID="${1:?deviceId required}"
OUT="${2:?output mp4 path required}"
DUR="${3:-}"          # seconds, empty = until signal
FPS="${4:-2}"
API="https://api.mobilerun.ai/v1"
# Need a FULL ffmpeg (image2 demuxer). Playwright's bundled ffmpeg is webm-only,
# so prefer a real build: $FFMPEG override -> imageio-ffmpeg -> system ffmpeg.
FFMPEG="${FFMPEG:-}"
if [ -z "$FFMPEG" ]; then
  FFMPEG="$(python3 -c 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())' 2>/dev/null || true)"
fi
[ -x "$FFMPEG" ] || FFMPEG="$(command -v ffmpeg || true)"
[ -x "$FFMPEG" ] || { echo "no full ffmpeg found (pip install imageio-ffmpeg)"; exit 1; }

FRAMEDIR="$(mktemp -d)"
START_TS=$(python3 -c "import time;print(time.time())")
cleanup_done=0
finalize() {
  [ "$cleanup_done" = 1 ] && return; cleanup_done=1
  echo "finalizing -> $OUT"
  local n; n=$(ls "$FRAMEDIR"/*.png 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" -lt 1 ]; then echo "no frames captured"; rm -rf "$FRAMEDIR"; exit 1; fi
  # Encode at the ACTUAL capture rate so playback matches wall-clock time
  # (the screenshot endpoint is ~1s/call, well under the target FPS).
  local now elapsed realfps
  now=$(python3 -c "import time;print(time.time())")
  elapsed=$(python3 -c "print(max(0.001, $now-$START_TS))")
  realfps=$(python3 -c "print(round($n/$elapsed, 4))")
  echo "captured $n frames over ${elapsed}s -> real ${realfps} fps"
  "$FFMPEG" -y -framerate "$realfps" -i "$FRAMEDIR/f_%06d.png" \
    -vf "pad=ceil(iw/2)*2:ceil(ih/2)*2" -r 24 -c:v libx264 -pix_fmt yuv420p -movflags +faststart \
    "$OUT" >/dev/null 2>&1
  echo "VIDEO: $OUT ($n frames, real-time ~${elapsed}s)"
  rm -rf "$FRAMEDIR"
  exit 0
}
trap finalize INT TERM

echo "recording device $DID (target ${FPS}fps) -> $OUT (frames in $FRAMEDIR)"
interval=$(python3 -c "print(1.0/$FPS)")
i=0
start=$(python3 -c "import time;print(time.time())")
while true; do
  printf -v name "$FRAMEDIR/f_%06d.png" "$i"
  curl -sS -m 15 -H "Authorization: Bearer $MOBILERUN_API" \
       "$API/devices/$DID/screenshot" -o "$name" || true
  # drop empty/failed frame so ffmpeg's sequence stays clean
  if [ ! -s "$name" ]; then rm -f "$name"; else i=$((i+1)); fi
  if [ -n "$DUR" ]; then
    now=$(python3 -c "import time;print(time.time())")
    done=$(python3 -c "print(1 if ($now-$start)>=$DUR else 0)")
    [ "$done" = 1 ] && break
  fi
  sleep "$interval"
done
finalize
