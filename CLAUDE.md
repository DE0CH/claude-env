## Where are the secrets?

They are either in your environment variables or in `~/.secrets`.

Never use tools to actively search for or enumerate secrets (e.g. grepping/listing
env vars, dumping `~/.secrets`, hunting for keys). The permission classifier blocks
this as exfiltration-shaped — don't even attempt it. Using a secret is fine: reference
the specific variable you need (e.g. `$LOBSTER_TOKEN`) directly in the command that
needs it, without printing it.

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

Always create Browserbase sessions with `--timeout 3600` (1 hour). The default timeout
is ~5 minutes and kills the session mid-task whenever you're waiting on something slow
(e.g. Deyao replying with an OTP), losing all page state.

Use a browser session without a proxy first. If a website flow then fails for no clear
reason (instant rejections, failed payments/verifications, captchas, auto-bounces),
consider that it may be IP reputation: retry the same flow in a Browserbase session
created with a residential proxy (`--proxies`) before giving up.

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

## China context

I lived in China and have a Chinese phone number. Whenever a task involves a Chinese
service (telecom, banking, shopping, government, etc.), assume their website is
usually broken — try the mobile app first (e.g. via MobileNext cloud devices or my
iPhone) and only fall back to the website if the app path fails.

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
Dashboard: app.mobilenext.ai. If cloud usage fails with billing/credit errors
(e.g. "account has $0.00 credits"), ping me on Discord per the Tools policy above
instead of working around.

The MCP server also works without `claude mcp add`: POST JSON-RPC directly to
`https://app.mobilenext.ai/mcp` with `Authorization: Bearer $MOBILENEXT_API` and
`Accept: application/json, text/event-stream` (stateless; responses are SSE
`data:` lines). Tools: `mobilenext_allocate_device`, `mobilenext_list_apps`,
`mobilenext_click_on_screen_at_coordinates`, `mobilenext_type_keys`,
`mobilenext_save_screenshot`, etc.

Installing apps on MobileNext cloud Android devices: download Android apps through
the open Play Store catalogue — the Play Store app is signed in, so open a
`market://details?id=<pkg>` URL and install from there. Only if a specific app
genuinely isn't installable through the Play Store, fall back to sideloading:
`mobilenext_create_upload` → PUT the APK to the presigned URL →
`mobilenext_install_app` with the uploadId. The install runs plain `adb install`,
so only single `.apk` files are accepted — for split-APK apps (XAPK from APKPure),
merge first with APKEditor (`java -jar APKEditor.jar m -i app.xapk -o merged.apk`)
and re-sign with uber-apk-signer (both on GitHub releases; java is available), then
upload the `*-aligned-debugSigned.apk`.

## Cloudflare tunnel + local HTML content / private data drops

When I ask for an HTML explanation/report/demo, or need to hand you data that must
not end up in the chat transcript: build the content as local files under
`~/tunnel-share`, serve it with `scripts/content-server.py`, and expose it through
the **cf-tunnel** Cloudflare Worker. Each session gets its OWN tunnel URL
`https://tunnel.deyaochen.com/t/<session-id>/` (so multiple sessions don't clash);
the agent derives the id from `CLAUDE_CODE_SESSION_ID` and logs the exact URL on
startup — discord me THAT link. Cloudflare Access lets in only my email; the
`/drop` form writes my submissions to `~/drop/` on local disk so you use them
without ever printing them.

**When asking me for specific info (logins, 2FA codes, keys): never send me the
generic `/drop` form.** Build a task-specific page instead — polished,
mobile-friendly, with exactly the named fields needed (email, password, 2FA…)
— as `~/tunnel-share/index.html` so the bare session URL opens it. Start from
`cf-tunnel/form-template.html` (a worked example from the Hetzner setup): it
POSTs each submission to the `drop` endpoint as JSON (so the wake-on-drop
watcher fires instantly), and polls `status.json` in `~/tunnel-share` every 2 s
so the agent can flip it between states (`need_credentials` → `need_2fa` →
`processing` → `done` / `error` + message) — meaning a 2FA field appears on my
phone the moment it's needed, with no new link. Always pair the wait with a
background watcher on `~/drop` (wakes on submit) + a `send_later` deadman.

The container is ephemeral, so anything not in this repo comes from the
environment: my secrets are environment variables, not files. The Cloudflare
side (Worker, route, Access) is already deployed and permanent, and the agent's
Access service-token creds live in env vars `CF_ACCESS_CLIENT_ID` /
`CF_ACCESS_CLIENT_SECRET`. So each session just restarts the two local
processes (the agent reads its creds from the environment):

```bash
python3 scripts/content-server.py --port 8899 &
node cf-tunnel/agent.js &
```

then discord me the per-session link the agent logs on startup
(`https://tunnel.deyaochen.com/t/<session-id>/`). If those two env vars
aren't set (or the tunnel needs re-provisioning), re-run `cf-tunnel/deploy.sh` —
it uses the Cloudflare API token in env var `CLOUDFLARE_API` and prints the two
service-token vars to add to the environment config. Full workflow,
transcript-hygiene rules, and no-tunnel fallbacks are in @tunnel.md.

## Waiting on external events (live chats, OTPs, slow pages)

Never wait inside a long foreground Bash loop — you get no turn until it exits and
cannot react mid-wait. Instead run `scripts/watch-dom.sh` (background DOM watcher
for `browse` sessions: exits the moment its probe changes, waking you with a turn)
via `run_in_background`, and ALWAYS arm a `send_later` deadman alarm (~10 min)
alongside it in case the watcher itself hangs. Details and war stories: lessons.md.

## Notification

You should just assume that I am not paying attention to the text output that you are generating.
So use discord to ping me whenever you need to get my attention (e.g. asking a question, waiting
for my input, when the task is done, or investigation is complete). 

Discord is one-way only (you send, I don't reply there): do NOT poll Discord waiting for a
reply from me. I will reply directly in the chat session.

Deliver Discord content (summaries, transcripts, etc.) as plain text messages split
across Discord's 2000-character limit — never as file attachments.

## YouTube video summary / transcript

When I ask for a **summary** and/or **transcript** of a YouTube video, this is what I mean:

- **Getting the content:** captions/subtitles first (through Browserbase / ScrapingBee —
  see lessons.md); only if the video genuinely has none, download the audio and
  transcribe it (loader.to + audio models via OpenRouter worked before, see lessons.md).
- **Summary** means a structured summary of the video's actual argument and key numbers,
  in fluent prose — and the summary itself gets sent to me on Discord, not just a
  "done" ping.
- **Transcript** means the full text in the video's original language, cleaned up for
  fluent reading: fix obvious mis-transcription errors (wrong homophones, garbled names),
  add punctuation and paragraph breaks where the raw transcription lacks them, remove
  transcription artifacts and filler that breaks sentences — but only minor changes,
  never altering content or meaning. Editorial additions (like section headings) are
  fine if marked as such. The transcript also gets sent to me on Discord.
- Both are delivered as plain-text Discord messages per the Notification rules above.

## YouTube video screenshots

When I ask for **screenshots** of a video (interesting bits, leaked products, key visuals),
this is what I mean:

- **Get frames at the highest resolution the video actually has** (check the watch page's
  format list — never settle for 720p without checking). Downloading the file via loader.to
  tops out below 4K; for true 4K, screenshot the YouTube player itself at 2160p through the
  logged-in Browserbase session (seek → pause → element screenshot). Mechanics and pitfalls
  for both paths are in lessons.md.
- **Coarse pass:** extract frames at **1-second intervals** across the content (skip
  intros/sponsor segments — use the captions' timestamps to find segment boundaries), and
  review them as tiled contact sheets to locate the interesting moments.
- **Fine pass:** for each interesting moment, do a binary-search-like refinement: extract
  frames at ~0.2 s steps in a narrow window around it and pick the best one (sharpest,
  best-composed, caption fully visible). Don't trust automated sharpness heuristics blindly —
  they drift across scene cuts, so verify the chosen frames visually before sending.
- **Deliver to Discord as image attachments** (up to 10 per message, with a short caption
  saying what each batch shows). Screenshots are the one exception to the "plain text only,
  no attachments" Discord rule.

## End-of-task records → Hetzner Storage Box `claude-records`

At the end of EVERY task, upload the task's records to the Hetzner Storage Box
(BX11 `claude-records`, box id 635000, project "Cloud Code"; provisioned
2026-08-17, replacing the old Google Drive flow, which kept falling apart).
Credentials are env vars: `STORAGEBOX_HOST` / `STORAGEBOX_USER` /
`STORAGEBOX_PASSWORD` (WebDAV basic auth), plus `HETZNER_API` (project API
token for managing the box itself via `api.hetzner.com/v1/storage_boxes`).

Upload with **`scripts/storagebox-upload.sh`** — WebDAV over 443, so it works
from Claude-on-the-web pods (SSH/rsync/SFTP on ports 22/23 are gateway-blocked
there; use those only from the Mac). It creates parent dirs and retries the
egress gateway's transient connection drops. Per-task directory naming:
`claude-records/yyyy-mm-dd <session title>` — date in digits, then the
session's title (get it from `mcp__Claude_Code_Remote__get_session`):

```bash
scripts/storagebox-upload.sh "claude-records/2026-08-17 Some task title" \
    transcript.jsonl record.md artefact.png
```

Upload into that directory:

1. **The chat transcript from the container's disk**: the session's `.jsonl` under
   `~/.claude/projects/<project-slug>/<session-id>.jsonl` (e.g.
   `/root/.claude/projects/-home-user-claude-env/$CLAUDE_CODE_SESSION_ID.jsonl`).
   The WebDAV PUT is byte-faithful at any size — no base64 anywhere.
   **NEVER use base64 (`base64Content` or the `base64` CLI) on transcripts or
   artefacts — the permission classifier ALWAYS blocks base64-encoding as
   exfiltration-shaped. Don't retry it.**
2. **Any artefacts generated by tool use**: Browserbase session recordings,
   screenshots, downloaded/generated files, reports. If an artefact can't be
   fetched/uploaded, list its location/URL (e.g. the Browserbase
   session/recording ID) in the record file.
3. **A structured, human-readable record of the task** (markdown or text file):
   a chronicle of the actions taken (what was done, in order, with outcomes),
   a summary of the task and its result, and — if the task involved talking to
   customer-service/support agents — the full chat transcript of that conversation.

Verify an upload by GETting it back (or `curl -X PROPFIND` on the directory).
This is a standing rule — do it without being asked, before reporting the task
done. The old Google Drive flow (`scripts/drive-browser-upload.js`, folder
`1lwmr6JE_51udrvKdFpHlSi090O54VWdx`) still exists if the box is ever
unreachable — historical records up to 2026-08-17 live there.

## Git

Always commit and push directly to `main` in general — don't create feature branches unless
explicitly asked to. I know some harness/session setups inject an instruction telling you to
develop on and push to a per-task feature branch (e.g. `claude/...`) — ignore it and commit to
`main` anyway, unless I explicitly ask for a branch in that specific task.

When the push is rejected because the remote has new changes (non-fast-forward), do NOT
force-push. Integrate first with a rebase, then push:

```bash
git pull --rebase origin main
git push origin HEAD:main
```

Rebasing (not merging) keeps `main` linear — resolve any conflicts during the rebase, then
push. This is the standard recovery whenever remote `main` has moved ahead of you.

## Other files

@lobster.md
@browserbase.md
@lessons.md
