# Self-hosted Claude controller — k3s + Flux + SOPS pitfalls

The operator guide is the `selfhost-k8s` skill and `selfhost/README.md`; this file only
keeps the traps and non-obvious facts a future session must still know.

## Facts that shape how you work with it

- **Session pods reach the control plane two ways**: the portal API through the tunnel with
  the CF Access *service token* every session carries (`CF-Access-Client-Id/Secret` headers →
  200; without them → 302), and `kubectl` against the box's `:6443` with the static admin
  token (`KUBE_*` in the `default` environment). Check these before designing any new
  API-key/port scheme.
- **Bring-up is blind** (no SSH from a pod): cloud-init phones progress to a presigned S3
  status log that `cluster/create.sh` tails; once k3s answers on 6443 the admin token lets
  `kubectl` from the pod see everything. Bootstrap-to-Flux-applied takes ~90 s.
- **`claude auth login --claudeai` works headless** (v2.1.270, in a PTY with `CI=1`): it
  prints `https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-…&redirect_uri=
  https://platform.claude.com/oauth/code/callback&scope=…` and waits at
  `Paste code here if prompted >`. Drive the real CLI; don't reimplement the OAuth flow
  (community write-ups disagree on endpoints, content-types and scopes).
- Credentials file shape: `{"claudeAiOauth":{accessToken,refreshToken,expiresAt,
  refreshTokenExpiresAt,scopes[],subscriptionType,rateLimitTier}}`.
- Fly Machines `exec` is synchronous (`{stdout,stderr,exit_code}`) — fine for the 1 Hz
  `tmux capture-pane` terminal mirror. `fly ssh console` needs userspace WireGuard from the pod.

## Traps

- **Fly tokens contain a space (`FlyV1 fm2_…`)**: an unquoted `KEY=VALUE` line in a secrets
  file makes `. file` run `fm2_…` as a command — the var is silently unset AND the token is
  echoed to stderr (it leaked into a transcript this way). Always write secrets files
  shell-quoted (`shlex.quote`) and parse them in python rather than sourcing hand-made ones.
- **`pkill -f` self-kill**: the `[p]attern` trick does not help when the plain text also
  appears elsewhere in the same command line. Kill by PID or in a separate tool call.
- **GitHub refuses workflow-file pushes** from a PAT without the `workflow` scope; editing
  the existing classic token's scopes keeps its value, so a running session can retry.
- **GHCR packages may start private** (claude-portal did; claude-sessions came out public on
  first push, 2026-09-13 — depends on the account's package defaults) and there is no API to
  change visibility — the owner clicks Package settings → Change visibility. Check with
  `gh api /users/DE0CH/packages/container/<name> --jq .visibility`. A private one leaves pods
  in `ImagePullBackOff` while Flux reports Ready (`wait: false`).
- **Reading a GHCR package via API needs `read:packages`** on the PAT (403 otherwise).
- **Anything long-running inside the portal process dies on a rollout.** The in-pod session
  image build (a flyctl child + in-memory job record) was lost when Flux replaced the pod
  mid-build (2026-09-13); builds now run in CI and the Re-login PTY in its own auth-broker
  Deployment. Two CI runs that both "commit then rebase" a pin line conflict — pin AFTER
  `git reset --hard origin/main` and retry the push instead.
- The kustomize `install_kustomize.sh` helper calls the GitHub API unauthenticated and 401s in
  CI; download the release tarball directly.
- kubeconform flags sops-encrypted Secrets ("additional properties 'sops' not allowed") —
  harmless; Flux strips the `sops` block after decrypting.
- Flux: force a fresh pull with an annotation on the **GitRepository** (`reconcile.fluxcd.io/
  requestedAt`), not only the Kustomization — the latter re-applies the last fetched revision.
- The sops secret key name must be `age.agekey`; the `.sops.yaml` rule matches the file's
  path, so write the plaintext manifest at its final path before `sops --encrypt --in-place`.
