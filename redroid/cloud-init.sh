#!/bin/bash
# Full reproducible provisioner for the self-hosted cloud-Android box (redroid).
# Runs as cloud-init user_data on a fresh Ubuntu 24.04 x86 Hetzner Cloud server.
# Result: redroid (Android 14, ARM-translation included) + ws-scrcpy browser control
# behind Caddy (auto HTTPS + basic auth), with an on-demand SOCKS5 egress proxy toggle.
set -x
exec > /var/log/redroid-setup.log 2>&1
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl gnupg git android-tools-adb redsocks \
  debian-keyring debian-archive-keyring apt-transport-https "linux-modules-extra-$(uname -r)"

# ---- Docker ----
install -m0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io

# ---- kernel modules: binder (redroid) + NAT redirect (proxy toggle) ----
modprobe binder_linux devices="binder,hwbinder,vndbinder" || true
modprobe ashmem_linux || true
modprobe nf_nat || true; modprobe iptable_nat || true; modprobe xt_REDIRECT || true
printf 'binder_linux\nnf_nat\niptable_nat\nxt_REDIRECT\n' > /etc/modules-load.d/redroid.conf
echo "options binder_linux devices=binder,hwbinder,vndbinder" > /etc/modprobe.d/redroid.conf

# ---- redroid (Android 14, native x86_64 + arm64 translation). adb bound to localhost ----
mkdir -p /root/redroid-data
docker run -itd --restart unless-stopped --privileged --name redroid \
  -v /root/redroid-data:/data -p 127.0.0.1:5555:5555 \
  redroid/redroid:14.0.0-latest \
  androidboot.use_memfd=1 \
  androidboot.redroid_width=720 androidboot.redroid_height=1280 androidboot.redroid_dpi=320 \
  androidboot.redroid_gpu_mode=guest

# ---- ws-scrcpy (browser screen + control), built from source ----
mkdir -p /root/ws-scrcpy-build
cat > /root/ws-scrcpy-build/Dockerfile <<'DOCKER'
FROM node:18-bookworm
RUN apt-get update && apt-get install -y android-tools-adb git python3 build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN git clone --depth 1 https://github.com/NetrisTV/ws-scrcpy.git .
RUN npm install && npm run dist
WORKDIR /app/dist
EXPOSE 8000
CMD ["node","index.js"]
DOCKER
docker build -t ws-scrcpy /root/ws-scrcpy-build
docker run -d --restart unless-stopped --name ws-scrcpy --network host ws-scrcpy

# ---- Caddy: auto HTTPS + basic auth in front of ws-scrcpy (:8000) ----
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
# password: generated on first boot, plaintext kept in /root/ws-auth.txt (never in git)
python3 -c "import secrets,string;print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(24)))" > /root/ws-auth.txt
HASH=$(caddy hash-password --plaintext "$(cat /root/ws-auth.txt)")
DOMAIN="${REDROID_DOMAIN:-android.deyaochen.com}"
cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
    basic_auth {
        deyao ${HASH}
    }
    reverse_proxy localhost:8000
}
CADDY
systemctl restart caddy

# ---- on-box helper scripts ----
install -m0755 /dev/stdin /usr/local/bin/redroid-proxy <<'PROXY'
#!/bin/bash
# Toggle redroid container egress through a SOCKS5 proxy (TCP). Default OFF = box datacenter IP.
# Usage: redroid-proxy on <host> <port> <user> <pass> | off | status
CID=redroid; RPORT=12345
CIP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $CID 2>/dev/null)
case "$1" in
  on)
    H=$2;P=$3;U=$4;PW=$5
    cat >/etc/redsocks.conf <<CFG
base { log_debug=off; log_info=on; log="syslog:daemon"; daemon=on; redirector=iptables; }
redsocks { local_ip=0.0.0.0; local_port=$RPORT; ip=$H; port=$P; type=socks5; login="$U"; password="$PW"; }
CFG
    pkill redsocks 2>/dev/null; sleep 1; redsocks -c /etc/redsocks.conf
    iptables -t nat -N REDROID_RS 2>/dev/null || iptables -t nat -F REDROID_RS
    HIP=$(getent hosts "$H" | awk '{print $1; exit}'); [ -n "$HIP" ] && iptables -t nat -A REDROID_RS -d "$HIP" -j RETURN
    for n in 0.0.0.0/8 10.0.0.0/8 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10; do iptables -t nat -A REDROID_RS -d $n -j RETURN; done
    iptables -t nat -A REDROID_RS -p tcp -j REDIRECT --to-ports $RPORT
    iptables -t nat -D PREROUTING -s "$CIP" -p tcp -j REDROID_RS 2>/dev/null
    iptables -t nat -A PREROUTING -s "$CIP" -p tcp -j REDROID_RS
    echo "proxy ON: $H:$P  (container $CIP)"
    ;;
  off)
    iptables -t nat -D PREROUTING -s "$CIP" -p tcp -j REDROID_RS 2>/dev/null
    iptables -t nat -F REDROID_RS 2>/dev/null
    pkill redsocks 2>/dev/null
    echo "proxy OFF (datacenter IP)"
    ;;
  status)
    pgrep redsocks >/dev/null && echo "redsocks: running" || echo "redsocks: stopped"
    iptables -t nat -S PREROUTING 2>/dev/null | grep -q REDROID_RS && echo "redirect: ACTIVE" || echo "redirect: none (datacenter IP)"
    ;;
  *) echo "usage: redroid-proxy on <host> <port> <user> <pass> | off | status";;
esac
PROXY

install -m0755 /dev/stdin /usr/local/bin/redroid-ip <<'RIP'
#!/bin/bash
# Print redroid's current outbound IP (static curl pushed to /data/local/tmp/curl;
# --resolve because Android has no /etc/resolv.conf for musl).
adb -s localhost:5555 shell "/data/local/tmp/curl -s --max-time 15 --resolve ip-api.com:80:208.95.112.1 'http://ip-api.com/line?fields=query,country,isp'" 2>/dev/null | tr '\n' ' '; echo
RIP

# push a static curl into redroid (handy HTTP client; survives restarts via /data volume)
for i in $(seq 1 40); do [ "$(adb connect localhost:5555 >/dev/null 2>&1; adb -s localhost:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break; sleep 3; done
curl -sL https://github.com/moparisthebest/static-curl/releases/latest/download/curl-amd64 -o /root/curl-and
adb -s localhost:5555 push /root/curl-and /data/local/tmp/curl && adb -s localhost:5555 shell chmod 755 /data/local/tmp/curl
docker exec ws-scrcpy adb connect localhost:5555

# reconnect device to ws-scrcpy after every reboot
cat > /etc/systemd/system/redroid-connect.service <<'UNIT'
[Unit]
Description=Connect redroid device to ws-scrcpy adb after boot
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=/bin/sleep 25
ExecStart=/usr/bin/docker exec ws-scrcpy adb connect localhost:5555
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable redroid-connect.service

touch /root/redroid-setup-done
echo "SETUP DONE"
