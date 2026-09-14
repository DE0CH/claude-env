# selfhost — DIY Claude cloud code (your own environments, repos & sessions)

A self-hosted clone of Claude cloud code's phone flow, escaping the 443-only network
and the permission classifier:

- pick an **environment** (a named set of secrets),
- pick one or more **repos** (added on the Repos tab from a searchable dropdown of your own
  GitHub repos, listed via the portal's `GITHUB_TOKEN`, or by pasting any git URL), a **permission mode** (auto / dangerously-skip),
- **start a session** — which runs in its own isolated container (install tools freely),
- chat with it from the **Claude phone app** (each session runs `claude --remote-control`),
- watch/nudge its terminal from the dashboard, re-login Claude from the dashboard.

## Architecture (v2, 2026-09-13)

```
phone ─ Claude app (chat)            dashboard  https://tunnel.deyaochen.com/t/portal/
                                               │ Cloudflare Access (your email / service token)
   Hetzner box = single-node k3s CLUSTER       │ tunnel agents (Deployments) ─┐
        Flux ← git (this repo, ./selfhost/k8s) ─ portal (Deployment) ← SOPS secrets
        │ Fly Machines API
        ▼
   Fly.io ── session machine A (env X, repos…)  claude --remote-control
          ── session machine B (env Z, repos…)  claude --remote-control   ← isolated microVMs
```

- **Everything on the cluster comes from git.** `selfhost/k8s/` is reconciled by Flux every
  minute: the namespace, the portal + its cf-tunnel agent, the
  `portal-config` ConfigMap (repo list, session image ref) and the **SOPS-encrypted Secrets**
  (`selfhost/k8s/secrets/*.sops.yaml`: `portal-secrets`, `claude-credentials`, one
  `env-<name>` per environment). The cluster decrypts them with the age key in
  `flux-system/sops-age`; anyone with the public recipient in `.sops.yaml` can encrypt.
- **Dashboard edits are write-through**: the portal commits the change to git first (secrets
  via `sops --encrypt`, config as plain YAML, `[skip ci]`), then applies it to the cluster so
  it's usable immediately. Git stays the source of truth — a rebuilt box comes back identical.
- **CI builds, Flux deploys.** `.github/workflows/portal-image.yml` builds
  `ghcr.io/de0ch/claude-portal` on every portal/cf-tunnel change and pins the tag into
  `selfhost/k8s/kustomization.yaml`; Flux rolls it out with zero downtime (portal = RollingUpdate
  behind its Service; the tunnel agent has its own image pin, bumped only when `cf-tunnel/**`
  changes, so it is never restarted by a portal build). CI never touches the cluster or Hetzner
  and holds no secrets (only the built-in `GITHUB_TOKEN`).
- **The box's lifecycle is manual** (`cluster/create.sh` / `destroy.sh`), not CI-managed. Its
  only stateful inputs are the age private key and the static k8s admin token, both baked in
  by cloud-init and kept in Deyao's password manager.
- **Sessions** are Fly Machines from one prebuilt image (`session-image/`, built by GitHub
  Actions on every change — `.github/workflows/session-image.yml` pushes the public package
  `ghcr.io/de0ch/claude-sessions:sha-…` and pins the ref into `k8s/config/portal-config.yaml`;
  Fly pulls it anonymously. Nothing builds inside the portal). The portal injects the environment's secrets
  (as JSON → shell-quoted `~/.secrets`, so values with spaces survive), the repos, the Claude
  OAuth creds, the permission mode and model (default `claude-opus-4-8`), then boots
  `claude --remote-control` in a 120×40 tmux window. Sessions get `kubectl` + a kubeconfig for
  the controller cluster when the environment carries `KUBE_SERVER`/`KUBE_TOKEN`/`KUBE_CA`.
  The image preinstalls the tools the repo's workflows lean on — git, node 22, python3,
  `ssh`/`rsync`, `flyctl`, `sops`+`age`, `vercel`, `yt-dlp`, `ffmpeg`, `jq`, `ripgrep`,
  common Python libs (requests/bs4/lxml/pymupdf/edge-tts), and **Playwright 1.62 (Node global
  + Python) with Chromium** under `/opt/pw-browsers` (`NODE_PATH` preset; stable symlinks
  `/opt/pw-browsers/chromium` and `/opt/pw-browsers/headless_shell`; CJK fonts). Git is
  preconfigured as `claude <claude@selfhost>` with a credential helper that reads
  `$GITHUB_TOKEN`, so `git push` just works. Anything else is a per-session `apt`/`pip`
  install away (isolated microVM, passwordless sudo) — and if it might be useful again it
  goes into the Dockerfile too (CLAUDE.md rule).
- **Pods can drive the control plane** two ways: the portal API through the tunnel with the
  CF Access service token (`CF-Access-Client-Id/Secret` headers, already in every session's
  env), or `kubectl` against `https://<box-ip>:6443` with the admin token.

## API

The dashboard is a static page that only calls the portal's JSON API — every action it can do,
any program can do. Reference: [`API.md`](API.md). Auth is Cloudflare Access: your Google login
in the browser, or the Access **service token** (two headers, `CF-Access-Client-Id` /
`CF-Access-Client-Secret`) for programs — it is stored in the `default` environment's secrets, so
every session (and anything else you hand it to) can call the API.

## Secrets

| where | what |
|---|---|
| `selfhost/k8s/secrets/portal-secrets.sops.yaml` | `FLY_API_TOKEN`, `CF_ACCESS_CLIENT_ID/SECRET`, `GITHUB_TOKEN` (portal commits) |
| `selfhost/k8s/secrets/claude-credentials.sops.yaml` | `~/.claude/.credentials.json` + minimal `~/.claude.json` |
| `selfhost/k8s/secrets/env-<name>.sops.yaml` | one environment's secrets (label `selfhost.claude/environment`) |
| password manager | age private key (`flux-system/sops-age`), k8s admin token |
| nowhere in CI | — |

Encrypt by hand: put a Secret manifest at `selfhost/k8s/secrets/<x>.sops.yaml`, run
`sops --encrypt --in-place` on it (the `.sops.yaml` rule matches by path), add it to
`secrets/kustomization.yaml`, push. Decrypt: `SOPS_AGE_KEY_FILE=age.agekey sops -d file`.

## Bring-up / rebuild

```bash
# 0. one-time: age-keygen -o age.agekey; put its public key in .sops.yaml; encrypt secrets
# 1. provision the box (needs HETZNER_API + HETZNER_S3_* for the bootstrap status log)
AGE_KEY_FILE=age.agekey K8S_ADMIN_TOKEN_FILE=k8s_admin_token selfhost/cluster/create.sh
#    -> cloud-init: k3s (--tls-san <ip>, static token auth) → flux install → sops-age secret
#       → applies selfhost/k8s/flux/sync.yaml → Flux brings up everything from main
# 2. first time only: check ghcr.io/de0ch/claude-portal and ghcr.io/de0ch/claude-sessions are
#    PUBLIC (`gh api /users/DE0CH/packages/container/<name> --jq .visibility`; fix in the GitHub
#    UI, package settings → Change visibility — no API). New packages have come out public on
#    this account (claude-sessions, 2026-09-13) but may start private; the session-image
#    workflow refuses to pin a private image and says so.
# 3. add KUBE_SERVER=https://<ip>:6443 + KUBE_CA to the default environment (Settings → env)
kubectl --server https://<ip>:6443 --token "$(cat k8s_admin_token)" --insecure-skip-tls-verify get pods -A
```

Destroy: `selfhost/cluster/destroy.sh` (Fly sessions are separate — destroy them first).

## Dashboard behavior (as specified)

- **Names**: optional at start. Given → passed as `claude --remote-control <name> --name <name>`
  so the Claude app and dashboard match; blank → the Claude session names itself and the
  dashboard shows the app's AI-generated conversation title (read from the session transcript's
  `ai-title` records) — so both always match. No renaming from the dashboard.
- **Permission mode** per session: Auto (default) or Dangerously skip permissions.
- **First prompt**: optional at start. Given → the session image's supervisor waits for the
  remote-control host to come up, pastes it into the input (tmux bracketed paste, so newlines
  survive) and presses Enter — once per machine, never re-sent on a host restart/reboot. The
  CLI's positional `claude … "<prompt>"` is silently ignored under `--remote-control`, hence
  the paste. Blank → the first message comes from the Claude app as before.
- **Machine size** per session: Small (2 shared vCPU / 2 GB, ~$0.016/h), **Medium (4/4 GB, default, ~$0.033/h)**, Large
  (8/8 GB), XLarge (8/16 GB), Perf (2 dedicated / 4 GB). Presets live in `server.js` (`SIZES`); anything
  else is rejected. 1 GB was too small: `claude` alone is ~400 MB and Chromium got OOM-killed.
- **Secret values are write-only**: the dashboard lists key names and lets you set a new value, delete
  a key, or add keys; values are never sent to the browser (there is no reveal endpoint).
- **Terminal**: mirrors the session's tmux pane (1 Hz `capture-pane` over the Fly exec API,
  keys via `send-keys`) — no WireGuard/PTY; works through the tunnel. A plain full-screen page
  (✕ or browser Back closes it; no gestures around xterm). It **auto-fits**: on open, on rotation
  and when the phone keyboard appears, xterm is refitted and the remote tmux window resized to
  match (a ResizeObserver on the terminal area; the page is sized to the `visualViewport`, which
  is what the iOS keyboard shrinks — `100dvh` is not). Touch devices type through the input row +
  key chips (xterm's own hidden textarea is disabled there). The mirrored cursor is shown only
  when the app shows one (tmux `cursor_flag`; claude's TUI hides it and draws its own).
- **Front-end** (`portal/web/`): Vite + React + TypeScript. Components are **Radix Themes**
  (`@radix-ui/themes`, used as shipped — configured only through `<Theme>` props in
  `web/src/theme.tsx`: radius large, blue accent, slate grays; colour mode follows the OS via a
  `light`/`dark` class on `<html>`). Bottom sheets are **our own** (`web/src/sheet/`, no library —
  vaul and react-modal-sheet were both tried and rejected) with iOS detents and the real iOS
  motion model, documented in `sheet/physics.ts`: a bounce-0 spring of 0.5 s perceptual duration
  (stiffness (2π/d)², critically damped, closed form) started with the gesture's release velocity;
  the target detent is the one nearest to where the finger would have coasted (velocity projection
  with UIScrollView's 0.998 deceleration rate); rubber-banding past the top with Apple's 0.55
  formula. Hand-off (`sheet/useSheet.ts`): below the top detent the content never scrolls so any
  drag moves the sheet (a flick up expands); at the top detent the content scrolls, and a drag down
  while scrolled to the top brings the sheet down — decided on the FIRST move and vetoed to the
  browser with a non-passive touchmove; moves/release are tracked on `window` for the rest of the
  gesture. Focusing a field snaps to full so the keyboard never fights the scroller; the panel
  lives in a box sized to the `visualViewport`, so the keyboard shrinks it. Motion is written to the
  DOM per frame (transform + backdrop opacity), React only tracks the resting detent. Per-session
  actions beyond Terminal/Start live
  behind a **More** action sheet (one row of at most two buttons per card). `npm run build` in
  `web/` writes `portal/public/` (git-ignored; the portal image builds it in a Docker stage).
  Actions are never optimistic: `pendUntil` keeps a button in its pending state until
  `/api/state` reports the new value (Fly's list lags metadata/state changes by a few seconds),
  so a toggle never flips back to the old state before settling.
- **Re-login** (Settings): drives the real `claude auth login --claudeai` in a PTY inside the
  **auth-broker** pod (`portal/auth-broker.js`, `k8s/auth/` — same image as the portal, pinned
  separately so portal rollouts never kill a login in progress); the portal relays the sign-in
  link and the pasted code, and stores the new creds (git + cluster).
- **Portal rollouts are stateless**: every long-lived thing lives outside the portal process —
  session-image builds in CI, the Re-login PTY in the auth broker, the tunnel in its own pod —
  so a Flux rollout of the portal (RollingUpdate, new pod Ready before the old one goes) loses
  nothing. Keep it that way: no in-process job whose state matters may live in `server.js`. The
  one in-process job (the **auto-pause** loop) is deliberately fail-safe — its only state is an
  in-memory "idle since" map, so a rollout just resets the idle clocks (a session runs a little
  longer, nothing lost); during the brief two-pod overlap the fresh pod's empty map means it
  won't pause anything, so there's no double-stop.
- **Pause / Start** each session (Fly stop/start), and **auto-pause** idle ones (default on,
  per-session toggle): the portal pauses a machine after ~1h idle (claude status idle + no
  background jobs) to cut compute. **Fly stop resets the machine's ephemeral rootfs on the next
  Start** (verified — after a stop/start every transcript was gone), so Pause = snapshot, then
  stop (`pauseMachine` in `server.js`): the in-machine uploader (`lib/archive.js`, `snapshot`)
  puts every transcript + `~/.claude.json` + `workspace.tar.gz` (all of `~/workspace`,
  uncommitted work and node_modules included) + `artifacts.tar.gz` + a manifest into
  `claude-records/.paused/<machine-id>/` on the Storage Box; if that upload fails the machine is
  left running (a 500 from `/stop`; auto-pause retries next tick). On Start, `entrypoint.sh`
  finds the snapshot by `FLY_MACHINE_ID`, restores `~/.claude.json` (same machineID → same
  Remote Control target), extracts the two tarballs (the repo clone step then skips repos that
  are already there) and drops the transcripts under the project slug, sets the
  first-prompt marker (so the first prompt isn't pasted again), and `session-supervisor.sh`
  launches `claude --resume <newest id>` **without `--remote-control`** — re-passing that flag
  would start a NEW bridge session (new app entry); plain `--resume` reattaches to the
  conversation's existing bridge via its reconnection record while the server still holds it,
  otherwise Claude opens a replacement bridge session with the conversation intact. Destroying
  a *paused* session moves its snapshot into the normal `claude-records/<date> <title>/`
  archive (`finalizePaused`: transcripts as `transcript-<id>.jsonl`, the artefacts as
  `artifacts.tar.gz`); destroying a running one archives from disk and drops the stale snapshot. **Only Destroy** (not pause) runs the pre-destroy uncommitted/unpushed check. **Destroy archives
  first, with no AI involved**: the portal runs an uploader inside the machine that puts every
  transcript (`~/.claude/projects/**/*.jsonl`), everything under `~/artifacts/` (the mark — files or
  symlinks, subfolders kept) and a `session.json` on the Hetzner Storage Box at
  `claude-records/<yyyy-mm-dd> <title>/`, then deletes the machine. If the upload fails the machine is
  kept and the dashboard offers "destroy anyway". Sessions never upload their own transcript.
- **Two-phase UI, never optimistic**; layout-shift guard; newest-first stable ordering.

## Known limitations

- Sessions share one Claude OAuth identity. Claude rotates the refresh token on every refresh, so
  each session pushes its refreshed `~/.claude/.credentials.json` back to the portal
  (`push-claude-credentials`, via `POST /api/credentials`; newest expiry wins) and the portal
  refreshes the stored pair itself before starting a session. If that refresh is rejected the
  dashboard says so and the only fix is Re-login (Settings). See `API.md`.
  Remaining limit: the refresh token is single-use, so with several long-running sessions the
  first one to refresh (≈8 h in) wins and the others can't refresh their own copy when theirs
  expires (their terminal shows "Login expired · Please run /login"). Fix: the session card's
  **Refresh login** button (`POST /api/sessions/:id/relogin`) writes the portal's current pair
  into the session and types `continue` so it carries on. A stop/start of the machine re-seeds
  the pair the machine was CREATED with (from its env), so press Refresh login after a restart too.
  This applies to **auto-pause wakes too**: a session woken after a long pause may show "Login
  expired" if the shared refresh token rotated meanwhile — press Refresh login on the card.
- Sessions **auto-pause** (snapshot + Fly stop) on idle to cut compute, but don't auto-destroy
  (~1–2¢/hour while running; ~free while paused apart from a small rootfs-storage cost). Destroy
  when done.
- The terminal mirror has ~1 s latency and no mouse/scrollback; it's for watching and nudging.
