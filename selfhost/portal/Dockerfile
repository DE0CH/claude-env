# Portal image: dashboard/API + the cf-tunnel agent (same image, different command), plus
# the tools the portal shells out to: sops (encrypt secrets for git), git (write-through
# commits), claude (re-login flow, run by the auth broker — auth-broker.js, same image).
# Build context = repo root (see .github/workflows/portal-image.yml).
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/portal
COPY selfhost/portal/package.json selfhost/portal/package-lock.json ./
RUN npm ci --omit=dev
WORKDIR /app/cf-tunnel
COPY cf-tunnel/package.json cf-tunnel/package-lock.json ./
RUN npm ci --omit=dev

# Dashboard front-end: Vite + React (+ vaul sheets, xterm, Bootstrap) in selfhost/portal/web,
# built here into portal/public — the only thing server.js serves statically.
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY selfhost/portal/web/package.json selfhost/portal/web/package-lock.json ./
RUN npm ci
COPY selfhost/portal/web ./
RUN npm run build

FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git openssl procps bash openssh-client \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /usr/local/bin/sops https://github.com/getsops/sops/releases/download/v3.10.2/sops-v3.10.2.linux.amd64 \
 && chmod +x /usr/local/bin/sops \
 && useradd -m -u 1001 -s /bin/bash portal
COPY --from=deps /app /app
COPY selfhost/portal /app/portal
COPY --from=web /public /app/portal/public
COPY cf-tunnel /app/cf-tunnel
COPY .sops.yaml /app/.sops.yaml
RUN chown -R portal:portal /app
USER portal
WORKDIR /home/portal
# claude (for `claude auth login` in the auth broker), user-local
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV HOME=/home/portal \
    PATH=/home/portal/.local/bin:/usr/local/bin:/usr/bin:/bin
WORKDIR /app/portal
EXPOSE 8080
CMD ["node", "server.js"]
