# hetzner-session — your own Claude Code "container" on a Hetzner box

Replaces the claude.ai cloud container (443-only network, trigger-happy permission
classifier) with **one cheap always-on Hetzner box** that runs
`claude --remote-control --dangerously-skip-permissions`. Your phone's Claude app
attaches to it and starts sessions on demand — full network, no classifier.

## How it works
- **Remote control**: the box runs a headless `claude --remote-control` host that
  registers with Anthropic's relay under your account. In the Claude app it shows up as
  a machine you can start sessions on; each new session is a sibling tmux window on the
  box, so it inherits the same unrestricted environment.
- **Stateless**: the box holds nothing precious.
  - code ← `git clone https://github.com/de0ch/claude-env.git` (public)
  - API keys ← `~/.secrets`, sourced into the process env by the supervisor
  - Claude auth ← `~/.claude/.credentials.json` refresh token
  Nuke it and `rebuild.sh` recreates an identical box.
- **Secret bootstrap** (nothing sensitive left at rest): `create.sh` encrypts
  `{.secrets + Claude creds}` with a random passphrase, parks the ciphertext in your
  Hetzner S3 bucket behind a 20-min presigned URL, and hands the box the URL + passphrase
  via cloud-init. The box downloads, decrypts, installs, then shreds the local copy,
  deletes the S3 object, and shreds its own user-data. Presigned URLs expire either way.

## Commands (run where `~/.secrets` + `~/.claude/.credentials.json` live)
```bash
./create.sh                 # provision "claude-remote" (cx23, ubuntu-24.04, hel1)
./status.sh                 # list the box(es) + break-glass hint
./destroy.sh                # delete it
./rebuild.sh                # destroy + recreate identically
```
Override defaults with env vars: `SERVER_TYPE=cx33 LOCATION=nbg1 ./create.sh myname`.

## Box facts
- **Type**: `cx23` — cheapest x86 (2 vCPU / 4 GB, ~€6.59/mo). ARM `cax11` is pricier here.
- **Auth to attach**: relies on the Claude OAuth **refresh** token; if it ever expires
  (`refreshTokenExpiresAt`), re-login locally and `rebuild.sh`.
- **Passwordless sudo** for `deyao` is ON (`ENABLE_SUDO=1`) so the box can install
  tooling per CLAUDE.md. Set `ENABLE_SUDO=0 ./create.sh` to lock it down.
- **Break-glass**: `ssh deyao@<ip>` (SSH key id 23450965), then
  `systemctl status claude-remote` / `tmux attach -t deyao` /
  `journalctl -u claude-remote` / `/var/log/claude-bootstrap.log`.

## Project note
`HETZNER_API` manages the Cloud project this box is created in. An older box may live in
a different project the token can't see — delete that one from the Hetzner console.
