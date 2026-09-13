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
# same base for POST /api/sessions {environment,repos,label,permissionMode}, /api/environments,
# /api/repos, /api/image/rebuild, /api/auth/start|code, /api/sessions/<id>/tty (SSE) …
```

## Everyday operations

| task | how |
|---|---|
| **test a dashboard change BEFORE pushing** | run the portal locally against the cluster (`PORT=18080 KUBE_SERVER=https://<ip>:6443 KUBE_TOKEN=… NODE_EXTRA_CA_CERTS=<ca.crt> FLY_API_TOKEN=… GITHUB_TOKEN=… REPO_DIR=/tmp/repo node server.js`), then `NODE_PATH=~/pwtest/node_modules node selfhost/portal/test/dashboard.test.js http://127.0.0.1:18080/ <shots-dir>` (Playwright + Chromium: `npm i playwright && npx playwright install --with-deps chromium` in ~/pwtest). It drives the real page at phone + desktop widths: console errors, failed requests, terminal frame, dialogs, secret-leak check, screenshots — look at the screenshots. Re-run against `https://tunnel.deyaochen.com/t/portal/` after the rollout. curl-only API tests missed a 404'd CDN script and a dialog that covered the page |
| keep a session's records | put files/symlinks under `~/artifacts/` (incl. `record.md`); Destroy uploads them + all transcripts to `claude-records/<date> <title>/` on the Storage Box automatically (lib/archive.js runs inside the machine; needs STORAGEBOX_* in the env). Never upload transcripts yourself |
| deploy a portal/cf-tunnel change | push to `main`; watch `gh run list -w portal-image`; Flux applies the pinned tag within ~1 min (`kubectl -n claude rollout status deploy/portal`) |
| change manifests | edit `selfhost/k8s/**`, push. Force sync: `kubectl -n flux-system annotate kustomization selfhost reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite` |
| add/edit an environment's secrets | portal UI (Environments → Edit) or API `POST /api/environments {name, secrets:{K:V, K2:""(delete)}}` — it commits `env-<name>.sops.yaml` and applies |
| add a portal-level secret by hand | write the Secret manifest (JSON is fine) at `selfhost/k8s/secrets/<x>.sops.yaml`, `sops --encrypt --in-place <path>` (rule matches by path; needs `.sops.yaml` at repo root → run from repo root), add to `secrets/kustomization.yaml`, push |
| read a live secret value | `kubectl -n claude get secret env-default -o json` (values base64 on the wire; decode in code, never with the base64 CLI on artefacts) |
| rebuild the session image | push the Dockerfile change to main FIRST (the portal builds from its own checkout), then `POST /api/image/rebuild` (= portal Settings → Rebuild; flyctl runs inside the portal pod and on success records the ref itself: commits `config/portal-config.yaml` + applies the ConfigMap). Poll `GET /api/image/build` from a background watcher until `running:false`; `ok:null, image:null` = the job record is gone = the portal pod restarted mid-build (see gotchas). Fallback from a session (flyctl is in the image): `flyctl deploy selfhost/session-image --config selfhost/session-image/fly.toml --app de0ch-claude-sessions --build-only --push` with `FLY_ACCESS_TOKEN=$FLY_API_TOKEN` (absolute paths; `--config` is resolved relative to the deploy dir), then record the ref by hand: edit `sessionImage` in `selfhost/k8s/config/portal-config.yaml`, commit+push, `kubectl -n claude apply -f` it. Boot-test the image before recording: `flyctl machine run <ref> --app de0ch-claude-sessions --region arn --detach --entrypoint /bin/bash -- -c "$(cat check.sh)"`, read `flyctl logs -i <id> --no-tail`, `flyctl machine destroy <id> --force` |
| re-login Claude | portal Settings → Re-login (drives `claude auth login --claudeai` in a PTY; paste the code) |
| debug Flux | `kubectl -n flux-system get gitrepository,kustomization,helmrelease -A`; `kubectl -n flux-system logs deploy/kustomize-controller --tail 50` |
| debug the portal | `kubectl -n claude logs deploy/portal --tail 100`; `kubectl -n claude get events --sort-by=.lastTimestamp | tail` |
| rebuild the box | `AGE_KEY_FILE=… K8S_ADMIN_TOKEN_FILE=… selfhost/cluster/create.sh <name>` (needs HETZNER_API + HETZNER_S3_* in env or ~/.secrets); it phones bootstrap status home via a presigned S3 log and prints it; then `destroy.sh <old-id>` |

## Gotchas (all hit on 2026-09-13)

- **A portal rollout kills any in-flight session-image build and loses its status.** The
  build is a flyctl child process of the portal pod with the job record in memory, and every
  portal/cf-tunnel commit → GHA → Flux rollout replaces the pod. Before triggering, check the
  newest `portal-image` GHA run is older than the running pod's image
  (`kubectl -n claude get pods -l app=portal -o jsonpath='{.items[0].spec.containers[0].image}'`
  vs `GET /repos/de0ch/claude-env/actions/runs?per_page=1`); if a rollout is pending, wait for
  it. A killed build leaves nothing half-recorded (registry tag only appears after the push).
- **Building from a session VM: the 1 GB default is tight.** flyctl itself is fine, but the
  harness kills background tasks when the VM runs low (`claude` alone is ~360 MB RSS) — it
  happened during the export/push phase. Prefer the portal path; if building from a session,
  keep nothing else heavy running.
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
