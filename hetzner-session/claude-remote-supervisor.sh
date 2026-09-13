#!/bin/bash
# claude-remote-supervisor.sh
# Keeps an always-on `claude --remote-control` host alive inside a tmux session so
# the Claude mobile app can attach to this box and spawn new sessions on demand.
#
# Run by the claude-remote.service systemd unit (as user `deyao`). It:
#   1. sources ~/.secrets so claude and every Bash tool it spawns inherit the API keys
#      as environment variables (the mobile/cloud container provides them the same way);
#   2. (re)creates the tmux `deyao` session running the remote-control host whenever
#      no `claude --remote-control` process is alive (covers boot + crash).
#
# It stays in the foreground (the while loop) so systemd tracks it with Type=simple +
# Restart=always. Sessions the phone spawns become sibling tmux windows and inherit the
# same environment.

set -u

SESSION="${CLAUDE_REMOTE_SESSION:-deyao}"
WORKDIR="${CLAUDE_REMOTE_WORKDIR:-$HOME/claude-env}"
SECRETS_FILE="${CLAUDE_SECRETS_FILE:-$HOME/.secrets}"
POLL_SECS="${CLAUDE_REMOTE_POLL_SECS:-20}"

# Make claude + tooling reachable regardless of the systemd PATH.
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH"
export HOME

load_secrets() {
  if [ -f "$SECRETS_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$SECRETS_FILE"
    set +a
  fi
}

start_session() {
  load_secrets
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  # -d: detached, allocates a pty for claude; workdir = the repo.
  tmux new-session -d -s "$SESSION" -c "$WORKDIR" \
    "claude --remote-control --dangerously-skip-permissions"
  logger -t claude-remote "started remote-control host in tmux session '$SESSION'"
}

# Reload secrets into this supervisor's env too (so tmux server inherits fresh values).
load_secrets

while true; do
  if ! pgrep -u "$(id -u)" -f 'claude --remote-control' >/dev/null 2>&1; then
    logger -t claude-remote "no remote-control host running; (re)starting"
    start_session
  fi
  sleep "$POLL_SECS"
done
