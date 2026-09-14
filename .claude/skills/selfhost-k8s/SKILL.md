---
name: selfhost-k8s
description: Operate Deyao's self-hosted Claude control plane — a single-node k3s cluster on Hetzner reconciled by Flux from selfhost/k8s in this repo, with SOPS/age-encrypted Secrets, the portal dashboard, and Fly-hosted sessions. Use whenever a task touches the portal/dashboard, environments (session secret sets), the session image, Flux/k3s on the controller, adding or rotating a secret, or "the controller is broken". Covers kubectl access from a session pod, the portal API via the CF Access service token, sops editing, the GHA→GHCR image flow and its private-package gotcha, and rebuilding the box.
---

# selfhost-k8s — operating the controller cluster

Built 2026-09-13 (session 01SMTM2tamW1X7nmHRL75vog). Design doc: `selfhost/README.md`.

## Mental model

- **Git is the source of truth.** Flux (`flux-system/selfhost` Kustomization) applies
  `./selfhost/k8s` from `main` every minute and **prunes** what's gone. Anything you change
  directly in the cluster and not in git is overwritten on the next reconcile.
- **Secrets are SOPS-encrypted in git** (`selfhost/k8s/secrets/*.sops.yaml`, age recipient in
  `.sops.yaml`). The cluster decrypts with `flux-system/sops-age`. You can *encrypt* with the
  public key only; *decrypting/editing* an existing file needs the private key (Deyao's
  password manager / the cluster) — so to change a secret from a session, rewrite the whole
  manifest and re-encrypt, or use the portal (it decrypts nothing: it reads the live Secret
  from the cluster, merges, re-encrypts, commits, applies).
- **CI only builds.** `.github/workflows/portal-image.yml` → `ghcr.io/de0ch/claude-portal:sha-…`
  and pins the tag in `selfhost/k8s/kustomization.yaml` (`[skip ci]`). Flux rolls it out.
- **The box is manual** (`selfhost/cluster/create.sh` / `destroy.sh`). Rebuild = destroy +
  create; needs the age key file + the k8s admin token file (Deyao's password manager).
- **Sessions are Fly Machines** (app `de0ch-claude-sessions`), unchanged. The portal talks to
  the Fly Machines API with `FLY_API_TOKEN` from `portal-secrets`.

## Access from a session pod

```bash
# kubectl (installed in the session image; kubeconfig auto-written if the env has KUBE_*)
kubectl get pods -A
# manual: KUBE_SERVER=https://<box-ip>:6443, bearer = the admin token (group system:masters)
kubectl --server "$KUBE_SERVER" --token "$KUBE_TOKEN" --insecure-skip-tls-verify get nodes

# portal API through the tunnel (Cloudflare Access service token = env vars every session has)
curl -sS -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  https://tunnel.deyaochen.com/t/portal/api/state
# same base for POST /api/sessions {environment,repos,label,permissionMode,size,prompt,oneShot}, /api/environments,
# /api/repos, /api/github/repos (the Add-repo picker's list: every repo the portal's GITHUB_TOKEN
# can see, 5-min cache, ?refresh=1), /api/auth/start|code, /api/sessions/<id>/tty (SSE) …
```

## Everyday operations

| task | how |
|---|---|
| **change the dashboard** | front-end = `selfhost/portal/web/` (Vite + React + TS, Radix Themes components used as shipped, our own bottom sheet in `web/src/sheet/` with the iOS spring/projection physics, xterm). `cd selfhost/portal/web && npm ci && npm run build` writes `portal/public/` (git-ignored; the portal image builds it). Then **test BEFORE pushing** with the mock API — no cluster needed: `cd selfhost/portal && npm ci --omit=dev && node test/mock-server.js 18080 &` (serves `public/` + canned `/api/*`, incl. a fake tmux frame and slow-settling pause/autopause) and `node test/dashboard.test.js http://127.0.0.1:18080/ <shots-dir>` (Playwright is global in the session image). It drives the real page at phone + desktop widths: console errors, failed requests, terminal live frame + **auto-fit on open and on shrink**, handle drag to full / flick to dismiss, action sheet, forms, secret-leak check, screenshots — tile and LOOK at the screenshots (pillow is in the image). Look & feel rules are in CLAUDE.md (no custom theme/overrides, no purple/gradients/shadows). Re-run against `https://tunnel.deyaochen.com/t/portal/` after the rollout. Pitfalls hit 2026-09-13: a `useStore` selector must return a stable reference (`s.state.repos`, not `s.state.repos \|\| []` or `new Set(...)` — that loops React #185); xterm must be opened in an element that exists AFTER the host mounts it (callback ref → state), not in a mount effect; vaul and react-modal-sheet were both tried for the sheets and dropped (vaul: snap-point mode confused by up/down/up sequences, refuses upward drags over scrollable content; react-modal-sheet: tween motion Deyao found unsmooth, scroll vs text-input conflicts) — the sheet is now our own, physics in `web/src/sheet/physics.ts` with the sources cited; a mouse drag leaves the handle on its FIRST move, so track pointermove/up on window after pointerdown, never only on the panel |
| **fire-and-forget job** | `POST /api/sessions {…, prompt, oneShot:true}` (dashboard: New session → Mode → One-shot). The session runs the prompt; the supervisor exits claude when it has been busy and is then idle (60 s, or 15 min with background jobs still running; "needs you" waits for an answer from the app) and writes `~/.claude/.one-shot-done`; the portal's 30 s loop then archives + force-destroys (dirty repos don't block; Deyao gets a lobster DM if work was lost or the archive failed). Records land in `claude-records/<date> <title>/` like any Destroy; the one-shot Claude still follows CLAUDE.md (record.md under `~/artifacts`, push its commits) |
| keep a session's records | put files/symlinks under `~/artifacts/` (incl. `record.md`); Destroy uploads them + all transcripts to `claude-records/<date> <title>/` on the Storage Box automatically (lib/archive.js runs inside the machine; needs STORAGEBOX_* in the env). Never upload transcripts yourself |
| deploy a portal/cf-tunnel change | push to `main`; watch `gh run list -w portal-image`; Flux applies the pinned tag within ~1 min (`kubectl -n claude rollout status deploy/portal`). Rollouts are zero-downtime: the portal is `RollingUpdate` (maxSurge 1 / maxUnavailable 0 — the new pod must be Ready before the old goes, and the tunnel agent targets the `portal` Service, i.e. the load balancer), and the tunnel agent pod is pinned separately (`claude-tunnel-agent` image entry in `kustomization.yaml`, bumped by CI only when `cf-tunnel/**` changed) so portal builds never restart it. Pitfall: both pins map placeholder names (`claude-portal`, `claude-tunnel-agent`) to the same GHCR image — never use the real image name as an entry's `name`, because `kustomize edit set image` sorts entries and a later entry re-matches an earlier entry's `newName` (that chained rewrite re-tagged the tunnel agent on every portal build) |
| change manifests | edit `selfhost/k8s/**`, push. Force sync: `kubectl -n flux-system annotate kustomization selfhost reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite` |
| add/edit an environment's secrets | portal UI (Environments → Edit) or API `POST /api/environments {name, secrets:{K:V, K2:""(delete)}}` — it commits `env-<name>.sops.yaml` and applies |
| add a portal-level secret by hand | write the Secret manifest (JSON is fine) at `selfhost/k8s/secrets/<x>.sops.yaml`, `sops --encrypt --in-place <path>` (rule matches by path; needs `.sops.yaml` at repo root → run from repo root), add to `secrets/kustomization.yaml`, push |
| read a live secret value | `kubectl -n claude get secret env-default -o json` (values base64 on the wire; decode in code, never with the base64 CLI on artefacts) |
| rebuild the session image | **push = rebuild.** Any push to main touching `selfhost/session-image/**` runs `.github/workflows/session-image.yml`: builds from that dir, pushes `ghcr.io/de0ch/claude-sessions:sha-<12>` (public package; Fly pulls anonymously) and pins the ref into `selfhost/k8s/config/portal-config.yaml` (`[skip ci]`); Flux applies the ConfigMap within a minute and the next `POST /api/sessions` boots it. Watch with `gh run list -R DE0CH/claude-env -w session-image` / `gh run watch <id>` from a background job. Rebuild without a code change: `gh workflow run session-image.yml -R DE0CH/claude-env`. The pin step FAILS (without pinning) if the package is private — make it public once in the GitHub UI, then re-run. Fallback: build anywhere with `docker build selfhost/session-image -t ghcr.io/de0ch/claude-sessions:<tag> && docker push …`, then set `sessionImage` in `portal-config.yaml`, commit+push, `kubectl -n claude apply -f` it |
| **move a running session to a bigger/other machine** | the session image supports resume: create the new machine with the SAME `SESSION_REPOS`/`environment` plus `SESSION_RESUME_ID=<the session uuid>` and `SESSION_RESUME_PATH=<WebDAV path on the Storage Box holding that session's `.jsonl`>`. Steps from the old (or any) session: (1) `PUT` the transcript `~/.claude/projects/<slug>/<uuid>.jsonl` to the Storage Box (e.g. `_transfer/<uuid>.jsonl`); (2) `POST` the Fly Machines API (or the portal, which lacks a resume field — use the API) to create a machine cloning your `CLAUDE_CREDENTIALS`/`CLAUDE_ACCOUNT`/`SESSION_*` env with those two vars added and `guest:{cpu_kind:"shared",cpus:4,memory_mb:4096}`; entrypoint.sh downloads the transcript into `~/.claude/projects/<cwd slug>/` (slug = `sed 's#[^A-Za-z0-9]#-#g'` of the workdir) and the supervisor runs `claude --remote-control … --resume <uuid>`, so it reconnects to Remote Control with full history. Resume never auto-continues — send it a prompt (SendMessage or the app) to pick the task back up. **Per-box, NOT transferred by resume:** the cf-tunnel + `~/tunnel-share`/`~/drop` are local to each machine (start a fresh `content-server.py`+`agent.js` on the new box if you need a tunnel; drop files don't move). The 1 GB default (`small`) OOM-kills Chromium on heavy pages — use `medium`/4 GB for anything that drives a browser. |
| retire the CURRENT session from inside it | `retire-session` skill → `scripts/retire-session.sh` (push check, record check, then `DELETE /api/sessions/$FLY_MACHINE_ID` detached) |
| re-login Claude | portal Settings → Re-login (drives `claude auth login --claudeai` in a PTY inside the **auth-broker** pod — `portal/auth-broker.js`, Deployment `auth-broker`, relayed by the portal via `AUTH_BROKER_URL`; paste the code). Normally unnecessary: the portal refreshes the stored OAuth pair before each session start (`ensureFreshCredentials`, `lib/oauth.js`) and every session pushes its refreshed `~/.claude/.credentials.json` back (`push-claude-credentials` → `POST /api/credentials`, newest expiry wins). A RUNNING session that says "Login expired · Please run /login" (another session rotated the shared refresh token first) is revived with the session card's **Refresh login** button (`POST /api/sessions/:id/relogin` — writes the portal's pair into the session, then types `continue`). Symptom of a dead login: new sessions show "Not logged in · Run /login" in their terminal and never appear in the app; `/api/state` → `creds.stale`, the dashboard shows a red banner, `POST /api/sessions` → 409 `needLogin` |
| call the portal API from a program | see `selfhost/API.md` — same endpoints the dashboard uses, auth = the CF Access service token headers (in the `default` env) |
| debug Flux | `kubectl -n flux-system get gitrepository,kustomization,helmrelease -A`; `kubectl -n flux-system logs deploy/kustomize-controller --tail 50` |
| debug the portal | `kubectl -n claude logs deploy/portal --tail 100`; `kubectl -n claude get events --sort-by=.lastTimestamp | tail` |
| rebuild the box | `AGE_KEY_FILE=… K8S_ADMIN_TOKEN_FILE=… selfhost/cluster/create.sh <name>` (needs HETZNER_API + HETZNER_S3_* in env or ~/.secrets); it phones bootstrap status home via a presigned S3 log and prints it; then `destroy.sh <old-id>` |

## Gotchas (all hit on 2026-09-13)

- **A "bypass" session shows "booting…" forever (2026-09-14).** `--dangerously-skip-permissions`
  on a TTY opens the "WARNING: Claude Code running in Bypass Permissions mode … Yes, I accept"
  dialog and claude blocks there: no `~/.claude/sessions/*.json` (so no status → "booting…"),
  no bridge session in the app, and the supervisor's first-prompt loop gives up after ~3 min.
  **The key that suppresses it is `skipDangerousModePermissionPrompt: true` in
  `~/.claude/settings.json`** — the userSetting the dialog itself writes on "Yes, I accept"
  (`$$()` in cli 2.1.270 reads it; verified in the binary). The legacy `~/.claude.json`
  `bypassPermissionsModeAccepted` that entrypoint.sh has always set does **not** suppress the
  first-run TTY dialog — that's why sessions still hung. **Do NOT unblock by sending Enter to
  the dialog: its default focus is "No, exit" (`focus:"cancel"`), so a bare Enter quits claude.**
  Permanent fix (applied 2026-09-14): `trust_dirs()` in `session-supervisor.sh` writes
  `skipDangerousModePermissionPrompt: true` to `~/.claude/settings.json` before every claude
  launch. To rescue an already-stuck machine from any session with the Fly exec API (the
  `default` env has `FLY_API_TOKEN`): write that settings key and restart claude, e.g.
  `POST …/machines/<id>/exec {"command":["bash","-lc","su - claude -c 'python3 -c \"import json,os;p=os.path.expanduser(\\\"~/.claude/settings.json\\\");s=json.load(open(p)) if os.path.exists(p) else {};s[\\\"skipDangerousModePermissionPrompt\\\"]=True;json.dump(s,open(p,\\\"w\\\"))\"; tmux -S /tmp/tmux-1001/default kill-session -t claude'"]}`
  — the supervisor watchdog relaunches claude within ~20 s, now past the dialog. (exec runs as
  root, so `su - claude`.)

- **Rotating `FLY_API_TOKEN` (the portal's Fly access).** It's an **org** token
  `claude-selfhost-controller` in the **personal** org (the account requires SSO, so
  personal-access tokens can't be minted via the UI — only org tokens at
  `fly.io/dashboard/personal/tokens`). To rotate: create a new org token there, swap it into
  `portal-secrets` (read all live values `kubectl -n claude get secret portal-secrets -o json`,
  rewrite the manifest with only `FLY_API_TOKEN` changed, `sops --encrypt --in-place`, push),
  then `kubectl -n claude rollout restart deploy/portal` (it's `envFrom`, so a secret change
  needs a restart), verify with `GET …/portal/api/state` (it calls the Fly API), then revoke
  the old token. Two capture pitfalls: (1) a Fly token is `FlyV1 fm2_<macaroon>,fm2_<discharge>`
  — capture the **whole** string incl. the comma+discharge or the API 401s; read it from the
  reveal `<input>`/`<code>` and match `/FlyV1 fm2_[A-Za-z0-9_,=\/+.-]+/` (comma inside the
  class). (2) The create/revoke controls are Phoenix **LiveView** (`phx-click`, `data-confirm`)
  — wait for `window.liveSocket.isConnected()` before filling/clicking or the click no-ops, and
  accept the `data-confirm` dialog (`page.on('dialog', d=>d.accept())`).
- **Nothing long-running may live inside the portal process** — a Flux rollout replaces the pod on every portal/cf-tunnel commit. That is why the session image is built in CI and the Re-login PTY runs in the separate auth-broker Deployment (its pin is bumped only when `portal/lib/auth.js` / `portal/auth-broker.js` change). Don't add in-process background jobs to `server.js`.
- **`VAR=x curl … | sh` scopes VAR to curl, not sh.** `FLYCTL_INSTALL=/usr/local curl … | sh`
  installed flyctl under `/root/.fly` (invisible to the `claude` user). Put the assignment on
  the consumer side of the pipe and assert the binary path in the same `RUN`.
- **Playwright ≥1.6x uses the Chrome-for-Testing layout on linux64**: `chromium-<rev>/chrome-linux64/chrome`
  and `chromium_headless_shell-<rev>/chrome-headless-shell-linux64/chrome-headless-shell` (not
  `headless_shell`). The image symlinks both to `/opt/pw-browsers/{chromium,headless_shell}`;
  match binaries by basename with alternatives, never by a hard-coded revision dir.

- **GHCR packages are private by default, even for a public repo, and there is no API to flip
  it.** First image push → Deyao clicks Package settings → Change visibility → Public. Until
  then the portal/tunnel pods sit in `ImagePullBackOff` (Flux still reports Ready: `wait: false`).
- **Pushing a workflow file needs the PAT `workflow` scope** — a classic `repo`-only PAT is
  rejected by GitHub. Editing the existing token's scopes keeps its value, so a running session
  can push right after Deyao ticks the box.
- **Fly tokens contain a space (`FlyV1 fm2_…`)**: an unquoted `KEY=VALUE` line in `~/.secrets`
  silently drops the var when sourced (bash runs `fm2_…` as a command — and echoes the token
  into stderr). The session image now writes `~/.secrets` shell-quoted (`shlex.quote`); never
  `. ~/.secrets` a hand-written file with unquoted values — parse it in python.
- **`pkill -f <pattern>` kills the shell running it** when the same command line also contains
  the pattern text (even with the `[p]attern` trick, if the plain text appears elsewhere in the
  command). Put the kill in its own tool call or kill by PID.
- `flux install` + a public `GitRepository` needs no git credentials; the sops secret key must be
  named `age.agekey`. `--tls-san <public-ip>` on k3s or the API cert won't match from outside.
- cf-tunnel worker strips `/t/<id>` before forwarding; absolute links still work via the
  `cf_tunnel` cookie. Two agents = two Deployments with different `TUNNEL_ID`s.
- The terminal panel is a tmux mirror (`capture-pane -p -e` at 1 Hz over the Machines exec API,
  `send-keys` for input). `fly ssh console` would need userspace WireGuard from the pod — avoided.
