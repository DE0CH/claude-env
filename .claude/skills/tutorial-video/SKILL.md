---
name: tutorial-video
description: >
  Make tutorial/explainer videos with programmatic animation and a Chinese
  (or any) voice-over, fully inside a Linux Claude container — no GPU, no
  external video service. Stack (researched & verified 2026-08-21): Remotion
  (React-based scenes rendered via the preinstalled Playwright Chromium
  headless shell) + edge-tts (Microsoft neural voices, free, works through
  the egress gateway) + imageio-ffmpeg (full static ffmpeg for probing).
  Use whenever Deyao asks for a video, animation, explainer, voice-over, or
  screencast-style presentation of content.
compatibility: "Web-container ready: npm + pip installs only. Needs fonts-noto-cjk for Chinese text (apt). No env vars required — edge-tts is keyless."
allowed-tools: Bash
---

# Tutorial videos with animation + voice-over (Remotion + edge-tts)

Verified end-to-end 2026-08-21 (video 《Claude Code 从入门到精通》, 12 scenes,
~4m50s, 1080p30, rendered in a Claude-on-the-web pod).

## Why this stack (researched alternatives, don't re-derive)

- **Remotion** (React → MP4): the right tool here. Renders deterministically in a
  headless Chromium — which the container already has. Native `<Audio>` mixing,
  `<Series>` scene sequencing, `spring()/interpolate()` animations. ~60k weekly
  downloads, battle-tested.
- Motion Canvas: editor-centric workflow (real-time preview app), awkward headless.
  Revideo (its automation fork) is viable but tiny ecosystem. Manim: python/math
  style, heavier native deps, wrong aesthetic for tool tutorials. Skip all three.
- **edge-tts**: free Microsoft neural TTS via WSS on 443 (passes the gateway).
  zh-CN voices are excellent. Local TTS (Piper/Coqui/ChatTTS) = big downloads,
  slow CPU inference, no quality win — skip.

## Setup (container)

```bash
pip install edge-tts imageio-ffmpeg
apt-get install -y fonts-noto-cjk fonts-noto-color-emoji   # CJK + emoji glyphs
# Remotion is per-project (see below); Chromium is already at /opt/pw-browsers
```

**edge-tts TLS fix (required in pods):** it uses aiohttp+certifi, which doesn't
trust the egress gateway's MITM CA → `CERTIFICATE_VERIFY_FAILED`. Setting
`SSL_CERT_FILE` is NOT enough. Append the gateway CA to certifi's bundle:

```bash
cat /root/.ccr/ca-bundle.crt >> "$(python3 -c 'import certifi; print(certifi.where())')"
```

## 1) Voice-over first, animation second

Write the narration as one line per scene, generate per-scene mp3s, measure real
durations, then size every scene to its audio. Never guess durations.

```bash
edge-tts --list-voices | grep zh-CN        # YunxiNeural (male, lively) is a good default
while IFS= read -r line; do
  edge-tts --voice zh-CN-YunxiNeural --rate=+8% --text "$line" \
    --write-media "s$i.mp3" --write-subtitles "s$i.srt"
done < lines.txt
# measure with the full ffmpeg (imageio_ffmpeg):
FF=$(python3 -c 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())')
$FF -i s1.mp3 2>&1 | grep Duration
```

Notes: `--rate=+8%` tightens delivery; digits/latin read fine; write "archive
point today" style workarounds only when a literal dot must be spoken.

**Subtitles: ALWAYS from `--write-subtitles`, never hand-timed (hard lesson).**
Hand-written subtitle chunks with length-weighted timing drift from the speech
and get called out immediately. edge-tts emits SRT cues from the service's
word-boundary events — sentence-level for Chinese, timing exact. Pipeline that
worked: parse each SRT → merge cues shorter than ~12 chars into the previous →
split cues over ~58 chars at punctuation with char-proportional timestamps →
normalize display text (spoken "四四三" → shown "443", "archive point today" →
"archive.today") → emit a `cues.ts` (`{t, text}[][]` + `DUR[]`) that the
Remotion SceneShell consumes (active cue = last cue with `t <= frame/fps`).

## 2) Remotion project (no create-video scaffold needed)

Minimal layout — `package.json` deps `remotion`, `@remotion/cli`, `react`,
`react-dom` (tested 4.0.240 / react 18.3.1), then:

- `src/index.ts`: `registerRoot(Root)`
- `src/Root.tsx`: one `<Composition>` (fps 30, 1920x1080,
  `durationInFrames` = sum of per-scene frames)
- `src/Video.tsx`: `<Series>` of scenes; each scene = `<Series.Sequence>` with
  `<Audio src={staticFile('sN.mp3')} />` (mp3s live in `public/`)
- Per-scene frames = `ceil((audioSeconds + 0.7 pad) * fps)`; hardcode the
  measured durations array into the file.

Patterns that worked well: a `SceneShell` (kicker + title + body + bottom
subtitle bar + progress bar) shared by all scenes; subtitle = the narration
split into 2-4 chunks, shown weighted by character count over the scene's
audio duration; `spring()` entrances (Pop/Rise/SlideL primitives); a
typewriter `CodeBox` for terminal content. Font stack:
`"Noto Sans CJK SC", "WenQuanYi Zen Hei", sans-serif` (system fonts — no
webfont loading needed).

## 3) Render — THE critical flag

The Playwright Chromium (`/opt/pw-browsers/chromium-*/chrome-linux/chrome`)
has old-headless REMOVED → Remotion fails with "Old Headless mode has been
removed". Use the **headless shell** binary instead:

```bash
npx remotion render src/index.ts <CompId> out/video.mp4 --codec=h264 \
  --browser-executable=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
```

(Glob the version dir — `1194` changes with Playwright bumps.) Remotion bundles
its own Rust compositor, so no ffmpeg is needed for the render itself.
Throughput observed: ~8800 frames 1080p ≈ minutes-scale; run it with
`run_in_background`, never a foreground wait. Smoke-test first:
`--frames=0-60`, extract a PNG with ffmpeg, eyeball fonts/layout.

## 4) Deliver

Per CLAUDE.md: upload the mp4 to the Storage Box with
`scripts/storagebox-upload.sh` (WebDAV handles ~100MB files fine), verify by
GET/PROPFIND, Discord the location. Don't attach video files to Discord.

**Web copy on Vercel — hard limits & verification (2026-08-21 incident):**
- Vercel rejects any single file >100MB ("File size limit exceeded"). Ship a
  capped re-encode for the site (motion graphics survive
  `-crf 26 -maxrate 420k -bufsize 840k` at 1080p looking clean) and keep the
  full-bitrate master on the Storage Box.
- NEVER deploy or deliver a media file without probing THAT artifact first:
  `ffmpeg -i file` must show Duration+streams, AND the first ~2MB prefix must
  probe too (proves `+faststart` moov-up-front, which streaming needs). A
  broken encode once shipped because `ffmpeg … | tail -1` hid the non-zero
  exit — an interrupted faststart pass leaves ftyp/free/mdat(size 0) with NO
  moov and the file is unplayable. Capture ffmpeg's real exit code (`2> log;
  echo $?`), never pipe it through tail.
- After deploying, probe the SERVED URL's byte-range prefix the same way.

## Community prior art (found 2026-08-21 — read these before reinventing)

Search first: this exact stack has community skills. Patterns worth stealing:

- **`ajanaku1/demo-video-skill`** (GitHub, MIT) — a Claude Code skill for
  Remotion + Edge TTS demo videos. Install: `npx claude-code skills add
  ajanaku1/demo-video-skill`. Its good ideas: 5-act story arc scripting
  (hook → problem → turn → journey → resolution) instead of feature lists;
  **word-level timing parsed into a `timing.ts` so visuals appear exactly when
  the narrator mentions them**; karaoke captions highlighting the current word;
  scene duration = audio + 0.5s; a library of device mockups (phone/browser/
  terminal frames), GradientBackground, TypewriterText.
- **`MatrixReligio/ProductVideoCreator`** (GitHub, ~39★, has 中文文档) —
  modular skills toolkit (storyboard/recording/voiceover/bgm/subtitles/
  compositing). Its good ideas: **storyboard-first workflow with user
  confirmation before production**; voiceover validation (duration/overlap/gap
  checks); BGM with scene-aware volume ducking; multi-size presets (16:9/9:16/
  1:1); Playwright screen-recording scenes composited into Remotion;
  `@remotion/google-fonts` for consistent Chinese fonts.

Upgrade path for our pipeline: word-synced element reveals (their `timing.ts`
pattern) and BGM ducking are the two highest-value adds we don't do yet.
(2026-08-21 second cut: word-synced reveals + karaoke captions are now DONE —
see the Dynamism section below. BGM ducking remains open.)

## Dynamism: never let a scene sit still (2026-08-21, "make it dynamic" round)

The first cut's failure mode: each scene springs its cards in during the first
~5 s, then is a STILL IMAGE for the remaining ~30 s of narration. Feedback:
"太多静态内容". The fix, verified end-to-end on the 24-scene cut:

- **Capture word boundaries, not just SRT.** edge-tts 7.x python API:
  `Communicate(text, voice, rate='+8%', boundary='WordBoundary')`, then
  `.stream()` yields `WordBoundary` chunks (`offset`/`duration` in 100 ns
  units, `text` per word) alongside the audio bytes — one network pass gives
  the mp3 AND per-word timing. (Default boundary is SentenceBoundary — that's
  why the CLI's `--write-subtitles` is sentence-level.) Persist per scene as
  `s{i}.words.json`; build `cues.ts` from it (display cues split at sentence
  enders / >58-char commas, each cue carrying `k: [t, fraction][]` karaoke
  pairs).
- **Phrase-anchored reveals** (the big one): every visual element declares the
  narration phrase it belongs to. At module load, join each scene's word texts
  into one searchable string (STRIP spaces/hyphens on both sides — word events
  have no inter-word spaces, so `'数据中心 IP'` must be searched as
  `'数据中心IP'`); a `usePh()` hook maps phrase → frame (minus ~5 frames of
  anticipation). Elements appear exactly when the narrator says them, so the
  scene keeps building for its whole duration instead of front-loading.
  VERIFY every anchor with a python checker (search each `ph('…')` in the
  scene's joined words) before rendering — a missed anchor silently falls back.
- **Beat component** (focus follows narration): spring in at `at`, glow +
  slight scale while current (until the next element's `at`), then settle to
  ~0.75 opacity with a gentle sine bob. The viewer's eye is always pulled to
  what's being said; nothing is ever frozen.
- ~~Karaoke subtitles~~ **REJECTED by Deyao** (2026-08-21): no karaoke-style
  subtitle sweep — plain sentence-cue subtitles only (engine-timed cue switch
  + small pop is fine). Keep subtitle font ≥44px for mobile.
- **Ambient layer in the shell** so no frame is static even between beats:
  2-3 drifting radial-gradient glow blobs + ~16 slow-rising dust motes
  (deterministic pseudo-random from index — no Math.random in Remotion),
  slow gradient-angle wobble, Ken Burns on the whole body (scale →1.028 over
  the scene), directional slide transitions (exit left / enter right),
  pulsing kicker dot, animated title underline, progress bar with scene ticks
  and glowing head.
- **Continuous micro-loops** where content allows: traveling dot along chains
  (FlowDot), packet dashes under proxy cards, rotating ↻, message-arrival
  buzz on the phone mock, files flying into the storage box, loop-node
  highlight cycling. Cheap, and they keep late-scene frames alive.
- Cost: identical render pipeline, negligible render-time difference.

## Motion-graphics cut, v3 (2026-08-21, "not a PowerPoint" round)

Even with narration-synced reveals, card-and-text layouts still read as
slides. Deyao's bar: **Fireship / 3Blue1Brown** — animated GRAPHICS that
explain the concept, with a camera, not decorated bullet lists. What shipped:

- **World + camera per scene**: each scene is a 1920×1080 SVG "stage"; a `Cam`
  wrapper interpolates arrival stops `{f, x, y, s}` (translate+scale, cubic
  in-out). CRITICAL: keys are ARRIVAL stops — hold the previous position and
  travel only ~34 frames before each arrival. Naive keyframe spans make the
  camera drift through empty space for seconds (looked broken in QC).
- **SVG diagram language**: glow-filtered pipes (colored wide stroke + white
  thin core) with draw-on via strokeDasharray and endless flowing dash pulses;
  ~25 hand-drawn stroke icons (robot/browser/phone/key/vault/wall/db/...);
  impact shake (`sin` decay) for wall slams; seeded pseudo-random only.
  **No emoji in graphics** (Deyao rule) — emoji only inline in text, if at all.
- **One protagonist motion per scene** (from video-shotcraft's aesthetic
  rules): a query ball cascading tiers, an APK riding a chute past a crossed
  container, a person escaping the loop ring, a minted credential shredded.
  Everything else supports. Hold ≥1s after key info lands.
- **Text sizes for mobile** (video-shotcraft Q11): subtitles ≥44px, any "meant
  to be read" label ≥32px effective (after camera scale), big keywords
  80-110px via a kinetic `BigWord` overlay. Verify on a 480px-wide thumbnail.
- **Script style**: story-driven, not listing. The guide's leveling frame
  (关卡/存档/装备/滚雪球, roguelike metaphor) IS the narrative spine; short
  punchy sentences; each scene ends hooking the next bottleneck. Full
  sentences read aloud = boring (Deyao). Symbols get read aloud —
  `SERPAPI_KEY` becomes "SERPAPI underscore KEY" — so speak "SERPAPI KEY" and
  map back to display text in the cues normalizer.
- **Voice / accent fix**: zh-CN voices speak English with a Chinese accent.
  Fix = multilingual voices (`en-US-BrianMultilingualNeural` chosen by Deyao;
  Andrew/Ava also fine; there is NO zh-CN multilingual in edge-tts). They run
  SLOWER than Yunxi: Andrew +8% ≈ 37% slower, Brian +8% ≈ 22% slower —
  measure a sample line and compensate with rate (we shipped Brian +15%).
  edge-tts 7.x: word events need `boundary='WordBoundary'` in the python API
  (default is SentenceBoundary).
- **Reference library**: `Vincentwei1021/video-shotcraft` (clone it — 152 shot
  recipe cards + demos + `references/aesthetic-rules.md`, judgment cases from
  real rework: no uniform-speed motion, accelerating batch entrances + 0.5s
  rest, one animation trick as protagonist per film, glint restraint, finale =
  "group photo" of all shown elements at peak energy). Also `Remocn/remocn`
  (shadcn-style copy-paste Remotion primitives).
- **SVG text vertical alignment**: `<text>` positions by alphabetic BASELINE —
  a label with y at a box's center sits ~0.35em too high, and it reads as
  sloppy "PPT alignment" (Deyao caught it). Give the shared Label component
  `dominantBaseline="central"` from day one and position by visual center;
  never hand-compensate with per-label y fudges.
- **Glow-filter clipping**: a shared `<filter filterUnits="userSpaceOnUse">`
  with a fixed region CLIPS any filtered element outside that region — pipes
  drawn inside translated groups with far-reaching local coords rendered as
  floating fragments (Deyao's screenshot). Make the filter region huge
  (e.g. x/y -3000, 8000×7000 — Chromium intersects it with the element bbox,
  so it costs nothing) and draw long connectors in world coordinates.
  Connectors must visually TOUCH the nodes they join — a 95px "gap by
  design" reads as broken, not stylish.
- Anchor-check every `ph('phrase')` against the scene's joined word stream
  before rendering (strip spaces/hyphens on both sides), and smoke-render
  ~1 frame per scene and LOOK at them — every layout bug above was caught
  that way, never by reasoning about code.

## Re-render policy (Deyao, 2026-08-21)

Renders are EXPENSIVE (a 15-min 1080p video ≈ 27k frames ≈ 45-85 min of CPU).
When the companion website/guide changes, do NOT re-render the video — only
re-render when Deyao explicitly asks for it. Treat the video as a pinned
artifact; content drift between site and video is acceptable until an explicit
re-render request.

## Gotchas recap

- certifi append (above) or every edge-tts call dies on TLS.
- `--browser-executable` must point at headless_shell, not chrome.
- Playwright's bundled ffmpeg (`/opt/pw-browsers/ffmpeg-*/ffmpeg-linux`) has no
  mp3 demuxer — use imageio-ffmpeg's binary for probing/frame extraction.
- No CJK font = tofu in every frame; install fonts BEFORE rendering.
- Colons/backslashes in JSX text are fine, but keep narration lines free of
  literal double quotes or escape them when shelling out to edge-tts.
- **Screen-space overlays must live OUTSIDE the camera rig.** Big kinetic
  words / titles rendered as HTML overlays get transformed too if they're
  children of the Cam component — whenever the camera isn't at the identity
  stop they drift off-frame, clip at an edge, or slide under the subtitle
  (several "level title" words were simply invisible for a whole video
  version). Return `<><Cam>…</Cam><BigWord…/></>` and keep overlay y within
  the safe band (~150 top / ~840 bottom; subtitle box top edge ≈933 at 1080p).
- **QC = full-res screenshots at ~6 keyframes per scene, reviewed one by
  one.** 1fps contact sheets at 480px tiles miss exactly the defects viewers
  see (label/subtitle collisions, overlapping pills, half-cropped leftovers
  of previous beats, clipped titles). Also: when the camera moves on, fade
  parked elements to ~20% (restore for the finale) or their cropped fragments
  will float at frame edges under the HUD.
