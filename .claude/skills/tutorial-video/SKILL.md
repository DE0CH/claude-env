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

## Gotchas recap

- certifi append (above) or every edge-tts call dies on TLS.
- `--browser-executable` must point at headless_shell, not chrome.
- Playwright's bundled ffmpeg (`/opt/pw-browsers/ffmpeg-*/ffmpeg-linux`) has no
  mp3 demuxer — use imageio-ffmpeg's binary for probing/frame extraction.
- No CJK font = tofu in every frame; install fonts BEFORE rendering.
- Colons/backslashes in JSX text are fine, but keep narration lines free of
  literal double quotes or escape them when shelling out to edge-tts.
