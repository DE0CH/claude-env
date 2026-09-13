# selfhost — DIY Claude cloud code (your own environments, repos & sessions)

A self-hosted clone of Claude cloud code's phone flow, escaping the 443-only network
and the permission classifier:

- pick an **environment** (a named set of secrets),
- pick one or more **repos**,
- **start a session** — which runs in its own isolated container (install tools freely),
- chat with it from the **Claude phone app** (each session runs `claude --remote-control`).

## Architecture

```
phone ─ Claude app (chat)          ─ dashboard  https://tunnel.deyaochen.com/t/portal/
                                              │ (Cloudflare Access, your email only)
   Hetzner CONTROLLER box (stateless, cx23)   │  portal + cf-tunnel agent (systemd)
        │ Fly Machines API
        ▼
   Fly.io ── session machine A (env X, repos…)  claude --remote-control
          ── session machine B (env Z, repos…)  claude --remote-control   ← isolated microVMs
```

- **Controller** holds no precious state. All portal state (environments + secrets, repo
  list, session image ref) lives **encrypted in Hetzner S3** (`lib/store.js`, AES-256-GCM,
  key = `PORTAL_ENC_KEY`). Nuke the box → `controller/create.sh` rebuilds it → portal
  reloads everything from S3.
- **Sessions** are Fly Machines from one prebuilt image (`session-image/`). The portal
  injects the environment's secrets, the repos, and the Claude OAuth creds, then boots
  `claude --remote-control` with a unique machineID so each shows as its own target.

## Secrets it needs (in `~/.secrets` on the controller)

| var | for |
|---|---|
| `HETZNER_API` | create/destroy the controller box |
| `HETZNER_S3_*` | encrypted config store (already present) |
| `CF_ACCESS_CLIENT_ID/SECRET` | cf-tunnel agent (already present) |
| `FLY_API_TOKEN` | create/destroy session machines + build the image |
| `PORTAL_ENC_KEY` | 64-hex key encrypting the S3 config (generate once) |
| `GITHUB_TOKEN` | pushing this repo; private-repo clones in sessions |
| Claude OAuth | `~/.claude/.credentials.json` (bundled at provision) |

These live as a plain `~/.secrets` (mode 600) on the controller — that file is their home.
`FLY_API_TOKEN` and `PORTAL_ENC_KEY` are additionally kept in the `default` environment. When
rebuilding the controller from a different machine, copy the controller's `~/.secrets` over
first, since `create.sh` bundles the `~/.secrets` of the machine it runs on.

## Bring-up

```bash
# 1. provision the controller (from a box that has ~/.secrets + ~/.claude creds)
selfhost/controller/create.sh
#    -> cloud-init installs node+flyctl, restores secrets, builds the session image
#       on Fly, starts the portal, exposes it at tunnel.deyaochen.com/t/portal/
# 2. open the dashboard on your phone, add environments + repos, Start a session
# 3. open the Claude app -> the session appears as a remote-control target
```

Manual image (re)build: `selfhost/deploy-session-image.sh`.
Destroy controller: `selfhost/controller/destroy.sh` (Fly sessions are separate — stop
them in the dashboard first).

## Dashboard behavior (as specified)

- **Names**: set once when starting a session (auto-generated if blank). It is passed as
  `claude --remote-control <name> --name <name>`, so the Claude app and the dashboard start
  identical; afterwards the dashboard **mirrors whatever you rename it to in the Claude app**
  (it reads the session's live registry `~/.claude/sessions/<pid>.json` via Fly exec).
  No renaming from the dashboard.
- **Only Destroy** (no Start/Stop). Destroy first inspects the container (`git status`,
  unpushed commits per repo, whether Claude is still working) and lists exactly what would
  be lost before asking.
- **Two-phase UI, never optimistic**: every button acks instantly with a disabled
  `Starting…/Destroying…/Saving…` label; the card only changes when the server confirms
  (`creating… → booting… → idle/working`; destroyed cards linger as `destroying` until Fly
  drops them). Polling is 2s while something settles, 15s otherwise.
- **Layout-shift guard**: after a list's items change, its destructive buttons are faded
  and inert for 250ms.
- Sessions are sorted newest-first (stable). "Remove from list" on a repo only forgets the
  dashboard entry — GitHub is never touched.

## Known limitations (v1)

- **Shared OAuth refresh token across sessions.** Each session gets a copy of the same
  Claude credentials. If Anthropic rotates refresh tokens, many long concurrent sessions
  could churn auth. Fine for a handful of sessions; a central token broker is the v2 fix.
- Sessions don't auto-destroy on idle — destroy them from the dashboard when done
  (~1–2¢/hour while running).
