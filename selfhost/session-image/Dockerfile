# Session image — one Claude Code remote-control session runs from this on Fly.
# Each Fly Machine boots this, gets an environment's secrets + repos injected,
# and runs `claude --remote-control` so it shows up in the Claude phone app.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git tmux openssl unzip jq ripgrep ffmpeg less nano \
      python3 python3-pip python3-venv build-essential sudo gnupg procps \
 && rm -rf /var/lib/apt/lists/*
# Node.js 22 (for the repo's JS tooling)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
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
