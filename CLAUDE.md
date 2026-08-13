## Where are the secrets?

They are either in your environment variables or in `~/.secrets`.

## Runner Environment

Expect to find yourself being run in two places: 1. My own mac. 2. A github workspaces pod.
For 1. This is my personal mac and I need you not to break it, and be conservative with making
persistent config changes. They probabaly need explicit explanation and approval from me.
For 2. you are modify the environment however you want because the pod is ephemeral.  

## Tools

Whenever a tool is not avaliable, the first priority is to fix the tooling, not to work around.
Examples include, a tool is not installed, in which case you should install it in the proper way, 
by either using brew, apt, pip depending on the environment. If there's a billing issue, for
example I don't have credit anymore or I've ran out of free plan usage, you should ping me
to ask me to recharge intead of working around it. If a workaround is reqruied, you should
always ask me for permission first because using the workaround.

When a new tool is required, for example by me asking you to add a new tool, edit claude.md,
or add a new skill, update the setup script so that the dependencies are installed, then
notify me to update the set up script in the container set up section manually.

If claude-in-chrome is avaliable and it's running on mac, use it and normal tools 
(ignore the directive about Browserbase below), Browserbase is still avaliable when needed.

If claude-in-chrome is not avaliable, then use Browserbase for ANY content from websites 
— not just interactive browsing: media/file downloads, YouTube videos/audio/subtitles, 
search results, APIs. It covers three modes:
the `browse` CLI for interactive browser sessions, the Fetch API for plain page/content
retrieval, and the Search API for web search. There is a persistent logged-in browser
context — see @browserbase.md.

When Deyao is watching a Browserbase session via the live view (debugger URL): those URLs
are pinned to a specific page/tab, so whenever the session is recreated, a new tab is
opened, or the page the link points at otherwise changes, immediately send him the fresh
`debuggerFullscreenUrl` (from `browse cloud sessions debug <session-id>`) without being
asked. Also explicitly say when a session is intentionally stopped or has died, so a blank
live view isn't mistaken for a bug.

Avoid using direct connection to the internet if possible. Do not fall back to direct
connections (yt-dlp, curl/wget against the target site, etc.) without trying Browserbase
first — datacenter IPs get bot-blocked anyway.

For YouTube videos, try to get the transcript/subtitles first (through Browserbase). Only
if no transcript exists, download the audio (through Browserbase) and transcribe it.

If audio transcription is required, use OpenAI Whisper through Openrouter.

## iPhone control

My physical iPhone can be driven through the accessibility API (WebDriverAgent +
pymobiledevice3 + Appium) — use the `drive-iphone` skill for bring-up, driving
patterns, recovery, and teardown. Mac host only (USB + `~/.venvs/ios` tooling; not
available in container pods). Build/signing infra lives in the private repo
`DE0CH/wda-build`; hard-won pitfalls are in @lessons.md.

## MobileNext (cloud phones + mobile automation)

The official MobileNext skills are vendored in `.claude/skills/mobilewright` and
`.claude/skills/mobilecli` (from `mobile-next/mobilewright-skill` @ 24e0c21 and
`mobile-next/mobilecli` @ 79bf822 — to update, re-copy `skills/<name>/SKILL.md` from
those repos). They drive iOS/Android devices: local ones via mobilecli, and Mobile
Next Cloud real devices (works from container pods, no Mac/USB needed).

The API key lives in `MOBILENEXT_API` (not `MOBILENEXT_API_KEY` as the docs assume) —
run `export MOBILENEXT_API_KEY="$MOBILENEXT_API"` first. Auth is
`Authorization: Bearer $MOBILENEXT_API_KEY` against `https://api.mobilenext.ai`
(sanity check: `GET /api/v1/keys`). For cloud devices from Claude Code, the MCP
server is `claude mcp add mobilenext --transport http https://app.mobilenext.ai/mcp`;
mobilewright targets the cloud by adding
`driver: { type: 'mobilenext', apiKey: process.env['MOBILENEXT_API_KEY'] }` to
`mobilewright.config.ts` (falls back to local devices via mobilecli when unset).
Dashboard: app.mobilenext.ai. No payment method is on the account yet, so paid cloud
usage may fail with billing errors (402) — ping me on Discord per the Tools policy
above instead of working around.

## Notification

You should just assume that I am not paying attention to the text output that you are generating.
So use discord to ping me whenever you need to get my attention (e.g. asking a question, waiting
for my input, or when the task is done). 

Discord is one-way only (you send, I don't reply there): do NOT poll Discord waiting for a
reply from me. I will reply directly in the chat session.

## Git

Always commit and push directly to `main` in general — don't create feature branches unless
explicitly asked to.

## Other files

@lobster.md
@browserbase.md
@lessons.md
