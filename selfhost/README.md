# selfhost — DIY Claude cloud code (your own environments, repos & sessions)

A self-hosted clone of Claude cloud code's phone flow, escaping the 443-only network
and the permission classifier:

- pick an **environment** (a named set of secrets),
- pick one or more **repos**, a **permission mode** (auto / dangerously-skip),
- **start a session** — which runs in its own isolated container (install tools freely),
- chat with it from the **Claude phone app** (each session runs `claude --remote-control`),
- watch/nudge its terminal from the dashboard, re-login Claude from the dashboard.

## Architecture (v2, 2026-09-13)

```
phone ─ Claude app (chat)            dashboard  https://tunnel.deyaochen.com/t/portal/
                                     k8s UI     https://tunnel.deyaochen.com/t/headlamp/
                                               │ Cloudflare Access (your email / service token)
   Hetzner box = single-node k3s CLUSTER       │ tunnel agents (Deployments) ─┐
        Flux ← git (this repo, ./selfhost/k8s) ─ portal (Deployment) ← SOPS secrets
        │ Fly Machines API
        ▼
   Fly.io ── session machine A (env X, repos…)  claude --remote-control
          ── session machine B (env Z, repos…)  claude --remote-control   ← isolated microVMs
```

- **Everything on the cluster comes from git.** `selfhost/k8s/` is reconciled by Flux every
  minute: namespaces, the portal + two cf-tunnel agents, Headlamp (HelmRelease), the
  `portal-config` ConfigMap (repo list, session image ref) and the **SOPS-encrypted Secrets**
  (`selfhost/k8s/secrets/*.sops.yaml`: `portal-secrets`, `claude-credentials`, one
  `env-<name>` per environment). The cluster decrypts them with the age key in
  `flux-system/sops-age`; anyone with the public recipient in `.sops.yaml` can encrypt.
- **Dashboard edits are write-through**: the portal commits the change to git first (secrets
  via `sops --encrypt`, config as plain YAML, `[skip ci]`), then applies it to the cluster so
  it's usable immediately. Git stays the source of truth — a rebuilt box comes back identical.
- **CI builds, Flux deploys.** `.github/workflows/portal-image.yml` builds
  `ghcr.io/de0ch/claude-portal` on every portal/cf-tunnel change and pins the tag into
  `selfhost/k8s/kustomization.yaml`; Flux rolls it out. CI never touches the cluster or Hetzner
  and holds no secrets (only the built-in `GITHUB_TOKEN`).
- **The box's lifecycle is manual** (`cluster/create.sh` / `destroy.sh`), not CI-managed. Its
  only stateful inputs are the age private key and the static k8s admin token, both baked in
  by cloud-init and kept in Deyao's password manager.
- **Sessions** are Fly Machines from one prebuilt image (`session-image/`, rebuilt from the
  dashboard → Settings, on Fly's remote builder). The portal injects the environment's secrets
  (as JSON → shell-quoted `~/.secrets`, so values with spaces survive), the repos, the Claude
  OAuth creds, the permission mode and model (default `claude-opus-4-8`), then boots
  `claude --remote-control` in a 120×40 tmux window. Sessions get `kubectl` + a kubeconfig for
  the controller cluster when the environment carries `KUBE_SERVER`/`KUBE_TOKEN`/`KUBE_CA`.
- **Pods can drive the control plane** two ways: the portal API through the tunnel with the
  CF Access service token (`CF-Access-Client-Id/Secret` headers, already in every session's
  env), or `kubectl` against `https://<box-ip>:6443` with the admin token.

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
# 2. first time only: make the ghcr.io/de0ch/claude-portal package PUBLIC (GitHub UI,
#    package settings → Change visibility) — GHCR packages start private and there is no API.
# 3. add KUBE_SERVER=https://<ip>:6443 + KUBE_CA to the default environment (Settings → env)
kubectl --server https://<ip>:6443 --token "$(cat k8s_admin_token)" --insecure-skip-tls-verify get pods -A
```

Destroy: `selfhost/cluster/destroy.sh` (Fly sessions are separate — destroy them first).
Headlamp login token: `kubectl -n headlamp get secret headlamp-admin-token -o jsonpath='{.data.token}' | base64 -d`.

## Dashboard behavior (as specified)

- **Names**: optional at start. Given → passed as `claude --remote-control <name> --name <name>`
  so the Claude app and dashboard match; blank → the Claude session names itself and the
  dashboard mirrors whatever it (or you, in the app) calls it. No renaming from the dashboard.
- **Permission mode** per session: Auto (default) or Dangerously skip permissions.
- **Terminal**: mirrors the session's tmux pane (1 Hz `capture-pane` over the Fly exec API,
  keys via `send-keys`) — no WireGuard/PTY; works through the tunnel; "Fit" resizes tmux.
- **Re-login** (Settings): drives the real `claude auth login --claudeai` in a PTY inside the
  portal pod, shows the sign-in link, takes the pasted code, stores the new creds (git + cluster).
- **Only Destroy** (no Start/Stop), with the pre-destroy uncommitted/unpushed check.
- **Two-phase UI, never optimistic**; layout-shift guard; newest-first stable ordering.

## Known limitations

- Shared OAuth refresh token across sessions (fine for a handful; re-login refreshes all new ones).
- Sessions don't auto-destroy on idle (~1–2¢/hour while running).
- The terminal mirror has ~1 s latency and no mouse/scrollback; it's for watching and nudging.
