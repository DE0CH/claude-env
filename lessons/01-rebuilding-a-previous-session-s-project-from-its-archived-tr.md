## Rebuilding a previous session's project from its archived transcript (2026-08-21)

A dead container's work is fully recoverable from the session `.jsonl` on the Storage Box:
download it and replay the `Write`/`Edit` tool_use inputs in order (apply each Edit's
old_string→new_string against the accumulated content) — this reconstructed a complete
Remotion project (39KB Video.tsx + 9 edits) byte-exact. Bash heredocs in the transcript
carry the rest (package.json, narration lines, exact commands). Also: **edge-tts is
deterministic** — regenerating the same text/voice/rate gave mp3s with identical durations
to 0.01s, so per-scene timing survives a rebuild; only re-measure the lines you changed.
