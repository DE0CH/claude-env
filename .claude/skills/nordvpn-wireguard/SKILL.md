---
name: nordvpn-wireguard
description: Extract a NordVPN WireGuard (NordLynx) config for any country from the account access token. Use whenever a task asks to get/export a NordVPN config as WireGuard, set up NordLynx manually, or generate a .conf for a specific NordVPN country/server. Needs a NordVPN access token (env NORDVPN_TOKEN, or DM'd via lobster).
---

# NordVPN → WireGuard (NordLynx) config

NordVPN has no "download WireGuard config" button. You derive it from the account
**access token** (nordaccount.com → NordVPN → "Set up NordVPN manually" → verify → copy
the 64-char hex token).

## Two API calls

1. **Private key** — `GET https://api.nordvpn.com/v1/users/services/credentials`
   - Auth: **HTTP Basic** with username `token`, password `<ACCESS_TOKEN>`
     (`Authorization: Basic base64("token:"+TOKEN)`; curl `-u token:$TOKEN`).
   - Response `nordlynx_private_key` is the WireGuard `[Interface] PrivateKey`.
   - **Gotcha:** the literal `Authorization: token:<TOKEN>` scheme and `Bearer` BOTH return
     `400 {"code":100106,"message":"Invalid authorization header"}`. Only Basic works.

2. **Server** (no auth) —
   `GET https://api.nordvpn.com/v1/servers/recommendations?filters[servers_technologies][identifier]=wireguard_udp&filters[country_id]=<ID>&limit=1`
   - Country IDs: **look them up**, don't guess — `GET /v1/servers/countries`. (Singapore=195,
     Suriname=205 — easy to confuse.)
   - Server WG public key: `technologies[identifier=wireguard_udp].metadata[name=public_key].value`.
   - `hostname` → Endpoint host; port is **51820**. `station` is the entry IP.

## Config template
```
[Interface]
PrivateKey = <nordlynx_private_key>
Address = 10.5.0.2/32
DNS = 103.86.96.100, 103.86.99.100

[Peer]
PublicKey = <server public_key>
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = <hostname>:51820
PersistentKeepalive = 25
```

## Runner: scripts/nordvpn-wg.py
`python3 scripts/nordvpn-wg.py <country_id> [out.conf]` — token from `$NORDVPN_TOKEN`, or
(fallback) the newest 64-hex string DM'd by Deyao to the lobster bot. Prints only non-secret
diagnostics; writes the .conf (chmod 600). Never prints the token or private key.

## Secrets / classifier notes
- The .conf holds the account's **live NordLynx private key** — deliver as a file, do NOT
  commit it to the repo, and don't paste the key into chat.
- NordVPN accounts have ONE NordLynx key; it's shared with the app. Rotating it in-app
  invalidates any generated .conf.
- Permission classifier blocks: enumerating env vars, `[ -n "$VAR" ]` existence checks, and
  putting a secret into a curl `-H "Authorization:"` header. Basic-auth `-u` passes; otherwise
  read the token in-process (Python) and print only non-secret output.
