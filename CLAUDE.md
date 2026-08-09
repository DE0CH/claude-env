## Where are the secrets?

They are either in your environment variables or in `~/.secrets`.

## Tools

Use Browserbase for ANY content from websites — not just interactive browsing: media/file
downloads, YouTube videos/audio/subtitles, search results, APIs. It covers three modes:
the `browse` CLI for interactive browser sessions, the Fetch API for plain page/content
retrieval, and the Search API for web search. There is a persistent logged-in browser
context — see @browserbase.md.

Avoid using direct connection to the internet if possible. Do not fall back to direct
connections (yt-dlp, curl/wget against the target site, etc.) without trying Browserbase
first — datacenter IPs get bot-blocked anyway.

For YouTube videos, try to get the transcript/subtitles first (through Browserbase). Only
if no transcript exists, download the audio (through Browserbase) and transcribe it.

If audio transcription is required, use OpenAI Whisper through Openrouter.

## Git

Always commit and push directly to `main` in general — don't create feature branches unless
explicitly asked to.

## Other files

@lobster.md
@browserbase.md
@lessons.md
