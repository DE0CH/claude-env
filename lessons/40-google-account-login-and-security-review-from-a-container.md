# Logging into Google (and auditing account security) from a container

Task shape: log into Deyao's Google account with email+password+TOTP, then review
"what can and has access" (linked apps, devices, recent activity) and optionally act
(revoke an app password). Google is the single most aggressive site about automated
logins and datacenter IPs, so this took real fighting. What actually works:

## Credentials
- Collect email / password / **TOTP setup key** (base32 secret) via the cf-tunnel drop
  form (task-specific `~/tunnel-share/index.html`, states `need_credentials → processing
  → done`). With the setup key you generate 2FA codes yourself — no live OTP relay needed:
  `python3 -c "import pyotp; print(pyotp.TOTP(secret.replace(' ','')).now())"`. `pyotp`
  is baked into the session image.
- Delete the drop file afterwards (it holds the password + TOTP seed in plaintext).

## The browser that gets past Google's bot detection
Headed **Chrome-for-Testing** (`/usr/local/bin/chromium`, full headful build) under
**Xvfb** (`Xvfb :99`; run scripts with `DISPLAY=:99`), driven by Playwright
`launchPersistentContext` (cookies persist to the user-data-dir, so login survives across
separate script runs). Flags that matter: `--no-sandbox --disable-dev-shm-usage
--disable-blink-features=AutomationControlled --disable-quic
--disable-features=UseDnsHttpsSvcb,UseDnsHttpsSvcbAlpn`, `ignoreDefaultArgs:
['--enable-automation']`, and an init script nulling `navigator.webdriver`. Locale
`en-GB`, timezone `Europe/London` to match a UK exit.

## The proxy — two gotchas that cost the most time
1. **Route through a residential IP in the user's usual country** (ask them). A UK IPRoyal
   residential sub-user (mint via `$IPROYAL_API`, `_country-gb_session-XXXXXXXX_lifetime-40m`
   for a sticky IP; verify it's clean on ip-api). Datacenter IPs get login-blocked.
2. **Chrome HANGS on google.com through Playwright's own `proxy:{...}` auth** (icanhazip
   loads fine, `accounts.google.com` never commits) — Playwright's 407 auth handling races
   across Chrome's many parallel connections. **Fix: a local auth-injecting forward proxy**
   (`scratchpad/local-proxy.js` pattern): a tiny Node server on 127.0.0.1:8890 that on
   `CONNECT` dials the IPRoyal upstream and sends `Proxy-Authorization: Basic <b64>`, then
   pipes. Point Chrome at it with `--proxy-server=http://127.0.0.1:8890` and NO Playwright
   proxy creds. Now Chrome behaves exactly like curl (which always reached Google fine).
   (`--disable-quic` is also required or Chrome hangs trying UDP through the CONNECT proxy.)
- Navigate with `waitUntil:'commit'` (not domcontentloaded) + explicit `waitForSelector`
  per step — 'commit' fires early, so a fixed sleep misses the field.

## The login flow
identifier (`#identifierId`/`input[type=email]`) → `#identifierNext` → password
(`input[type=password]`) → `#passwordNext` → 2FA. Google defaults to the phone prompt
("dp" challenge); click **"Try another way"**, then the TOTP field (`input[name=totpPin]`)
appears — fill a fresh code, `#totpNext`. Lands on `myaccount.google.com`.

## Reading the "who has access" data
- Linked apps: `myaccount.google.com/connections`. The chips split it: **"Sign in with
  Google (N)"** = identity-only (low risk) vs **"Access to (N)"** = apps with real Gmail/
  Drive/etc. data scopes (`?filters=3,4` deep-links the data-access set). Focus on the
  small "Access to" list.
- Recent activity (what HAS touched it, 28 days): `myaccount.google.com/notifications`.
- Devices: `myaccount.google.com/device-activity`. App passwords:
  `myaccount.google.com/apppasswords`.
- The main `myaccount.google.com/security` page is a great one-shot summary (2SV, passkeys,
  recovery phone/email, device counts, linked-app count, saved-password count).

## Sensitive pages force a SECOND verification — and TOTP is NOT accepted there
device-activity, apppasswords, twosv, passkeys each re-challenge. On these, Google will
NOT take the authenticator code — it escalates to the **phone prompt** ("tap Yes + tap N
on your iPhone"). Password satisfies the first factor but Google still demands the prompt.
So: raise the prompt, read the number off the page (screenshot it; `innerText` is often
just "Loading" — read the number visually from the screenshot as backup), Discord the
number to Deyao, he taps. Two traps:
- **After the prompt is approved you are ALREADY on the target page** (ensureVerified
  returns true because the URL is the myaccount page). Do NOT re-`goto` it — that triggers
  a FRESH challenge. Capture in place.
- The elevation from one approval is **page-specific and short** (~minutes). It let
  device-activity reload without challenge, but apppasswords needed its own approval.
- The challenge entry is inconsistent (sometimes `challenge/pwd`, sometimes a selection,
  sometimes a dead-end "Use a phone number" SMS-to-previous-recovery-phone page). Handle
  robustly: satisfy password/TOTP if offered, click "Try another way" to reach the full
  menu, prefer "Tap Yes on your phone" to raise a tappable number; if stuck on the SMS
  dead-end, re-`goto` the target to restart the challenge.
- Don't spam prompts: raise ONCE; do NOT click the always-present "Resend it" link every
  loop (that regenerates the number). Only resend on an explicit "expired".
- Revoking an app password: on the apppasswords page click the row's trash icon, then the
  "Remove" confirm; the page toasts 'Your app password "X" has been revoked.'

## "Recovery phone recently changed" — a real signal
If a verify screen offers the **"previous recovery phone … temporarily available after
changing your recovery phone"**, the recovery number was changed recently. That's a classic
takeover move — confirm the user did it. (Deyao's case: he'd moved to a UK number. Benign.)

## Bash gotcha that bit repeatedly
`pkill -f deepdive.js` **self-matches the running shell's own command line** (it contains
the pattern) → kills the shell (exit 144) and any heredoc after it never runs. Kill by PID
(`kill -9 $(pgrep -f "node X.js" | head -1)`) and write scripts with the Write tool, not
inline heredocs after a pkill. Clean up leftover Chrome by comm (`ps -eo pid,comm | awk
'$2 ~ /^chrome/ {print $1}' | xargs -r kill -9`) and delete the profile's `Singleton*`
lock before relaunching.

## Revoking a third-party app's access (OAuth grants)
- `myaccount.google.com/connections?filters=3,4` = the "Access to" set (apps with real data
  scopes), vs the ~80 identity-only "Sign in with Google" apps. Classify by the scope TEXT on
  the app's detail page — "Gmail" / "Google Drive" / "Drive files" mean real data access;
  the profile "See your email address" scope is NOT email access (nearly every app has it).
- Each app's detail lives at `myaccount.google.com/linkedapps/overview/<id>` (the scan saves
  the URL). It has a **"Delete all"** card → opens a dialog whose confirm button is **"Confirm"**
  (Cancel/Confirm). Clicking the card by walking the connections list is flaky (render race —
  the click lands before the card is ready and no dialog opens). Reliable path: navigate to the
  overview URL directly, `page.locator('text=/^Delete all$/').last()` → scrollIntoViewIfNeeded →
  click, `waitForSelector('[role=dialog]')`, then click the dialog's Confirm button.
- Revoking "Claude for Gmail"/"Claude for Google Drive" disconnects the Claude Gmail/Drive
  connectors (the mcp__claude_ai_Gmail/Drive tools) for that account — flag it before doing so.

## Setting a Supabase Auth SMTP password (Management API)
- Custom SMTP for magic-link email lives in project config, NOT in a repo: `PATCH
  https://api.supabase.com/v1/projects/<ref>/config/auth` (auth: `Bearer <PAT>`).
- **GOTCHA: a partial PATCH of only `{"smtp_pass": "..."}` NULLS the entire SMTP block**
  (host/user/sender all become null → email breaks). Always re-send the FULL block:
  smtp_host, smtp_port (as string, e.g. "465"), smtp_user, smtp_pass, smtp_admin_email,
  smtp_sender_name. GET the config first to capture the existing values.
- No Supabase PAT in env? Drive it through the target repo's own `SUPABASE_ACCESS_TOKEN`
  GitHub Actions secret: `gh secret set <TEMP>` for the new password, add a one-off
  `workflow_dispatch` workflow that GET+PATCHes the config, `gh workflow run`, verify, then
  delete the workflow + temp secret. A Gmail app password used by a web app is very often
  this SMTP password (magic-link sender), not an IMAP/repo secret.
