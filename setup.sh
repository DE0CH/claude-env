#!/usr/bin/env bash
# Container setup script for this environment.
#
# Installs/verifies the tooling that CLAUDE.md and the bundled skills rely on:
#   - browse CLI (Browserbase skill; needs Node/npm)
#   - curl + jq   (ScrapingBee skill, Discord/lobster notifications)
#   - ffmpeg      (audio work; pip imageio-ffmpeg fallback when apt is broken)
#   - secrets     (~/.secrets or env: LOBSTER_TOKEN, SCRAPINGBEE_TOKEN,
#                  BROWSERBASE_API_KEY, OPENROUTER_API)
#
# Idempotent: safe to re-run. Exits non-zero only if a required install fails;
# missing secrets are warnings (they may be injected as env vars separately).

set -u

FAILURES=()
WARNINGS=()

log()  { printf '==> %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*"; WARNINGS+=("$*"); }
fail() { printf 'FAIL: %s\n' "$*"; FAILURES+=("$*"); }

export PATH="$HOME/.local/bin:$PATH"
mkdir -p "$HOME/.local/bin"

APT_OK=""
apt_install() {
  # apt can be broken in some containers (see lessons.md) — probe once.
  if [ -z "$APT_OK" ]; then
    if command -v apt-get >/dev/null 2>&1 && apt-get update -qq >/dev/null 2>&1; then
      APT_OK=yes
    else
      APT_OK=no
    fi
  fi
  [ "$APT_OK" = yes ] || return 1
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null 2>&1
}

# --- basic CLI tools -------------------------------------------------------

for tool in curl jq git python3; do
  if command -v "$tool" >/dev/null 2>&1; then
    log "$tool already installed"
  elif apt_install "$tool"; then
    log "installed $tool via apt"
  else
    fail "$tool is missing and apt install failed"
  fi
done

if ! command -v pip3 >/dev/null 2>&1 && ! python3 -m pip --version >/dev/null 2>&1; then
  apt_install python3-pip && log "installed pip via apt" || warn "pip not available"
fi

# --- Node.js / npm (needed for the browse CLI) -----------------------------

if ! command -v npm >/dev/null 2>&1; then
  if apt_install nodejs npm; then
    log "installed Node.js + npm via apt"
  else
    log "installing Node.js LTS from nodejs.org tarball"
    NODE_VERSION="v22.14.0"
    NODE_DIR="$HOME/.local/node"
    if curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" \
        -o /tmp/node.tar.xz \
      && mkdir -p "$NODE_DIR" \
      && tar -xJf /tmp/node.tar.xz -C "$NODE_DIR" --strip-components=1; then
      ln -sf "$NODE_DIR/bin/node" "$NODE_DIR/bin/npm" "$NODE_DIR/bin/npx" "$HOME/.local/bin/"
      rm -f /tmp/node.tar.xz
      log "installed Node.js $NODE_VERSION to $NODE_DIR"
    else
      fail "could not install Node.js (apt and tarball both failed)"
    fi
  fi
else
  log "npm already installed ($(npm --version 2>/dev/null))"
fi

# --- browse CLI (Browserbase) ----------------------------------------------

if command -v npm >/dev/null 2>&1; then
  if command -v browse >/dev/null 2>&1; then
    log "browse CLI already installed"
  elif npm install -g browse >/dev/null 2>&1; then
    log "installed browse CLI ($(browse --version 2>/dev/null || echo ok))"
  else
    fail "npm install -g browse failed"
  fi
else
  fail "browse CLI not installed (no npm)"
fi

# --- ffmpeg -----------------------------------------------------------------

if command -v ffmpeg >/dev/null 2>&1; then
  log "ffmpeg already installed"
elif apt_install ffmpeg; then
  log "installed ffmpeg via apt"
else
  # lessons.md: apt can be broken; imageio-ffmpeg ships a static binary.
  log "apt ffmpeg unavailable, falling back to imageio-ffmpeg"
  if python3 -m pip install --quiet --user imageio-ffmpeg 2>/dev/null \
     || python3 -m pip install --quiet --user --break-system-packages imageio-ffmpeg 2>/dev/null; then
    FFBIN=$(python3 -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())' 2>/dev/null)
    if [ -n "${FFBIN:-}" ] && [ -x "$FFBIN" ]; then
      ln -sf "$FFBIN" "$HOME/.local/bin/ffmpeg"
      log "ffmpeg available via imageio-ffmpeg at ~/.local/bin/ffmpeg"
    else
      warn "imageio-ffmpeg installed but binary not found"
    fi
  else
    warn "could not install ffmpeg (apt and pip both failed)"
  fi
fi

# --- secrets ----------------------------------------------------------------

if [ -f "$HOME/.secrets" ]; then
  set -a; . "$HOME/.secrets"; set +a
  log "loaded ~/.secrets"
else
  log "~/.secrets not found (secrets may be provided as env vars instead)"
fi

for var in LOBSTER_TOKEN SCRAPINGBEE_TOKEN BROWSERBASE_API_KEY OPENROUTER_API; do
  if [ -n "${!var:-}" ]; then
    log "$var is set"
  else
    warn "$var is not set (expected in env or ~/.secrets)"
  fi
done

# --- summary ----------------------------------------------------------------

echo
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  printf 'Warnings (%d):\n' "${#WARNINGS[@]}"
  printf '  - %s\n' "${WARNINGS[@]}"
fi
if [ "${#FAILURES[@]}" -gt 0 ]; then
  printf 'Failures (%d):\n' "${#FAILURES[@]}"
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
log "setup complete"
