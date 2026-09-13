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
# yt-dlp: YouTube audio-download fallback when no transcript exists (CLAUDE.md YouTube section)
RUN curl -fsSL -o /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" \
 && chmod +x /usr/local/bin/yt-dlp
# flyctl: drive Fly (manage the sessions app / rebuild the session image)
RUN FLYCTL_INSTALL=/usr/local curl -fsSL https://fly.io/install.sh | sh
# vercel CLI: deploy HTML reports/demos for Deyao (vercel skill — never Claude Artifacts)
RUN npm install -g vercel
# Common Python libs used across scripts/skills (Ubuntu 24.04 pip is externally-managed).
# requests/bs4/lxml are ubiquitous; pymupdf is the preferred PDF parser (lessons/36).
RUN pip3 install --no-cache-dir --break-system-packages \
      requests beautifulsoup4 lxml pymupdf
# Non-root user with passwordless sudo. claude refuses --dangerously-skip-permissions
# as root, and per-session tool installs want sudo.
RUN useradd -m -s /bin/bash claude \
 && echo 'claude ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-claude \
 && chmod 0440 /etc/sudoers.d/90-claude
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY session-supervisor.sh /usr/local/bin/session-supervisor.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/session-supervisor.sh
USER claude
WORKDIR /home/claude
# Native claude binary for the claude user
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH=/home/claude/.local/bin:/usr/local/bin:/usr/bin:/bin
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
