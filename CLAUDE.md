## Where are the secrets?

They are either in your environment variables or in `~/.secrets`.

## Tools

Whenever a tool is not avaliable, the first priority is to fix the tooling, not to work around.
Examples include, a tool is not installed, in which case you should install it in the proper way, 
by either using brew, apt, pip depending on the environment. If there's a billing issue, for
example I don't have credit anymore or I've ran out of free plan usage, you should ping me
to ask me to recharge intead of working around it. If a workaround is reqruied, you should
always ask me for permission first because using the workaround.

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

## Notification

You should just assume that I am not paying attention to the text output that you are generating.
So use discord to ping me whenever you need to get my attention (e.g. asking a question, waiting
for my input, or when the task is done). 

## Git

Always commit and push directly to `main` in general — don't create feature branches unless
explicitly asked to.

## Other files

@lobster.md
@browserbase.md
@lessons.md
