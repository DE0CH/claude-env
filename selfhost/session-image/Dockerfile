# Session image — one Claude Code remote-control session runs from this on Fly.
# Each Fly Machine boots this, gets an environment's secrets + repos injected,
# and runs `claude --remote-control` so it shows up in the Claude phone app.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git tmux openssl unzip zip jq ripgrep ffmpeg less nano vim \
      python3 python3-pip python3-venv build-essential sudo gnupg procps \
      openssh-client rsync wget age htop sqlite3 file dnsutils iputils-ping \
 && rm -rf /var/lib/apt/lists/*
# Node.js 22 (for the repo's JS tooling)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
# kubectl: sessions drive the controller cluster (kubeconfig written by entrypoint.sh)
RUN curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/v1.33.4/bin/linux/amd64/kubectl" \
 && chmod +x /usr/local/bin/kubectl
# sops (+ age above): edit/encrypt the selfhost SOPS secrets by hand (see selfhost-k8s skill)
RUN curl -fsSL -o /usr/local/bin/sops "https://github.com/getsops/sops/releases/download/v3.13.3/sops-v3.13.3.linux.amd64" \
 && chmod +x /usr/local/bin/sops
# gh (GitHub CLI): watch CI runs (`gh run list -w portal-image`), PRs, releases; GITHUB_TOKEN auths it
RUN mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh && rm -rf /var/lib/apt/lists/* \
 && gh --version
# yt-dlp: YouTube audio-download fallback when no transcript exists (CLAUDE.md YouTube section)
RUN curl -fsSL -o /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" \
 && chmod +x /usr/local/bin/yt-dlp
# flyctl: drive Fly (manage the sessions app / rebuild the session image)
RUN curl -fsSL https://fly.io/install.sh | FLYCTL_INSTALL=/usr/local sh \
 && test -x /usr/local/bin/flyctl
# vercel CLI: deploy HTML reports/demos for Deyao (vercel skill — never Claude Artifacts)
RUN npm install -g vercel
# Common Python libs used across scripts/skills (Ubuntu 24.04 pip is externally-managed).
# requests/bs4/lxml are ubiquitous; pymupdf is the preferred PDF parser (lessons/36);
# pyotp generates TOTP 2FA codes from a setup key (lessons/40 — Google login/security review).
RUN pip3 install --no-cache-dir --break-system-packages \
      requests beautifulsoup4 lxml pymupdf pyotp
# Browser tooling. Playwright for Node is GLOBAL because every scripts/*.js and skill does
# `require('playwright')` via NODE_PATH; the Python package is pinned to the same version so
# both share ONE Chromium build under /opt/pw-browsers (the path the skills reference).
# `--with-deps` pulls Chromium's system libs; CJK fonts so Chinese pages render in
# screenshots; `ws` for the md-editor/tunnel helpers; edge-tts for tutorial-video voice-over.
# Stable symlinks (/opt/pw-browsers/chromium, /opt/pw-browsers/headless_shell) hide the
# revision-numbered dirs, and the build FAILS if either binary isn't where we expect.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=/usr/lib/node_modules
RUN npm install -g playwright@1.62.0 ws \
 && playwright install --with-deps chromium chromium-headless-shell \
 && pip3 install --no-cache-dir --break-system-packages playwright==1.62.0 edge-tts \
 && apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s "$(find /opt/pw-browsers -path '*/chromium-*' -type f -name chrome | head -1)" /opt/pw-browsers/chromium \
 && ln -s "$(find /opt/pw-browsers -path '*/chromium_headless_shell-*' -type f \( -name headless_shell -o -name chrome-headless-shell \) | head -1)" /opt/pw-browsers/headless_shell \
 && test -x /opt/pw-browsers/chromium && test -x /opt/pw-browsers/headless_shell \
 && ln -s /opt/pw-browsers/chromium /usr/local/bin/chromium \
 && chmod -R a+rX /opt/pw-browsers
# Git identity + GitHub auth for every session: commits as `claude <claude@selfhost>`; pushes
# read $GITHUB_TOKEN from the environment at call time (the entrypoint strips the token out of
# the cloned remote's URL, so nothing sensitive ever lands in .git/config).
RUN git config --system user.name claude \
 && git config --system user.email claude@selfhost \
 && git config --system credential.https://github.com.helper '!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f'
# Non-root user with passwordless sudo. claude refuses --dangerously-skip-permissions
# as root, and per-session tool installs want sudo.
RUN useradd -m -s /bin/bash claude \
 && echo 'claude ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-claude \
 && chmod 0440 /etc/sudoers.d/90-claude
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY session-supervisor.sh /usr/local/bin/session-supervisor.sh
COPY push-claude-credentials /usr/local/bin/push-claude-credentials
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/session-supervisor.sh /usr/local/bin/push-claude-credentials
USER claude
WORKDIR /home/claude
# Native claude binary for the claude user
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH=/home/claude/.local/bin:/usr/local/bin:/usr/bin:/bin
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
