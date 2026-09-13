#!/bin/bash
# status.sh — show Claude remote-control boxes in the HETZNER_API token's project.
set -euo pipefail
set -a; . "${SECRETS_FILE:-$HOME/.secrets}"; set +a
: "${HETZNER_API:?missing HETZNER_API}"

curl -fsS -H "Authorization: Bearer $HETZNER_API" \
  "https://api.hetzner.cloud/v1/servers?label_selector=role=claude-remote" \
| python3 -c "
import sys,json
srv=json.load(sys.stdin).get('servers',[])
if not srv: print('(no claude-remote boxes in this project)'); raise SystemExit
for s in srv:
    ip=(s['public_net']['ipv4'] or {}).get('ip','-')
    print(f\"{s['id']}  {s['name']:<16} {s['server_type']['name']:<6} {s['status']:<10} {ip}  {s['datacenter']['location']['name']}\")
"
echo
echo "break-glass:  ssh deyao@<ip>   then:  systemctl status claude-remote ; tmux attach -t deyao"
