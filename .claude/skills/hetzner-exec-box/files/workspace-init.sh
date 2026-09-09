#!/usr/bin/env bash
# Entry point for the workspace container. Installs a baseline toolset (only if
# missing, so a container restart is fast) then runs the executor. Anything the
# caller apt-installs at runtime persists until the container is recreated.
set -u
export DEBIAN_FRONTEND=noninteractive
mkdir -p /root/work

if ! command -v python3 >/dev/null 2>&1; then
    for i in 1 2 3; do
        apt-get update -qq && \
        apt-get install -y -qq --no-install-recommends \
            python3 openssh-client curl wget ca-certificates git jq rsync less procps iproute2 dnsutils && \
        break
        echo "apt attempt $i failed, retrying..." >&2
        sleep 5
    done
fi

exec python3 /opt/exec/server.py
