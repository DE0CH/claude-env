---
name: evomi
description: "Use Evomi proxies — the cheap pay-as-you-go datacenter SOCKS5 tier (our default Tier-1 proxy), plus residential and mobile. Generate ready-to-use proxy strings via the Evomi Public API (host:port:user:pass with country/city/session targeting), check usage, and feed SOCKS5 creds straight to mobilerun / curl / requests. Use whenever a task needs a cheap proxy IP for scraping or routing a phone's traffic, mentions Evomi, or needs a datacenter SOCKS5 endpoint. For residential/mobile stealth prefer the `iproyal` skill (Tier 2); reach for Evomi residential only if IPRoyal is unavailable."
compatibility: "Needs the Evomi Public API key in env var `EVOMI_API` (personal key from dashboard Settings → API). Only needs `curl` (and optionally `python3`). No install."
---

# Evomi proxies

Evomi is our **Tier-1 cheap datacenter proxy** (two-tier policy in CLAUDE.md): pay-as-you-go,
SOCKS5, ~$0.45/GB. One Evomi account also carries residential and mobile products, but for
residential/mobile prefer **IPRoyal** (skill `iproyal`, Tier 2) per policy.

## Credentials / environment

Per the repo secrets policy, reference env vars directly, never print them.

- **`EVOMI_API`** — the Public API key (dashboard **Settings → API**, "personal" key). This is the
  only credential you need; the proxy username/password come back FROM the API.
- Account proxy username is `chendeyao0` (rpc uses `chendeyao04`). Don't hardcode the proxy
  password — always fetch a fresh string from the generate endpoint.

> If `EVOMI_API` is not set in this session's env, it may be cached at
> `scratchpad/evomi_key` (Deyao dropped the key in Discord on 2026-08-18; ask him to persist it
> as `EVOMI_API` for future sessions).

**Auth is passed one of two ways** (NOT `Authorization: Bearer`, NOT `?key=`):
- query param `?apikey=$EVOMI_API`, or
- header `x-apikey: $EVOMI_API`

## Public API

Base: `https://api.evomi.com/public`

### Generate proxy strings — `GET /generate`

Returns ready-to-use proxy strings. This is the main call.

| Param | Req | Notes |
|---|---|---|
| `product` | yes | `sdc` Shared Datacenter (**our default**), `rp` Premium Residential, `rpc` Core Residential (no adblock/ISP targeting), `mp` Mobile, `static-residential` (ignores filters) |
| `countries` | no | ISO codes, comma-sep, e.g. `US,DE,NL` |
| `city` / `region` / `isp` | no | extra targeting |
| `session` | no | `sticky` (normal session) or `hard` (hold IP as long as possible) |
| `lifetime` | no | sticky-session minutes, 1–1440 (default 30); N/A for `hard` |
| `amount` | no | 1–100 |
| `protocol` | no | `http` (default) or `socks5` |
| `format` | no | output format `1`/`2`/`3` |
| `prepend_protocol` | no | `false` to drop the `socks5://` prefix |
| `adblock` | no | not on `rpc` |

Returned string format: `user:pass@host:port` — targeting tokens are appended to the **password**
(`_country-US_session-ab12cd…`), same idea as IPRoyal.

```bash
KEY="${EVOMI_API:-$(cat scratchpad/evomi_key)}"
# one datacenter SOCKS5 proxy exiting in the US, sticky for 30 min
curl -s "https://api.evomi.com/public/generate?product=sdc&protocol=socks5&countries=US&session=sticky&amount=1&apikey=$KEY"
#  -> socks5://chendeyao0:PASS_country-US_session-XXXX@dcp.evomi.com:2002
```

### Usage — `GET /usage?product=<code>`

Consumption stats (MB) per product over the last few days; `success:true` with the key valid.
(It reports *usage*, not remaining balance — check the dashboard for balance.)

```bash
curl -s "https://api.evomi.com/public/usage?product=sdc&apikey=$KEY"
```

## Datacenter endpoints (product `sdc`)

| Protocol | Host | Port |
|---|---|---|
| HTTP | `dcp.evomi.com` | 2000 |
| HTTPS | `dcp.evomi-proxy.com` | 2001 |
| **SOCKS5** | `dcp.evomi.com` | **2002** |

- SOCKS5 is **TCP only** (no UDP).
- HTTPS uses `dcp.evomi-proxy.com` (that's the cert's hostname); a cert-verifying client rejects
  `dcp.evomi.com:2001`.
- For other products (`rp`/`mp`/…) don't guess hosts — let `/generate` return the correct host:port.

## Use it

```bash
# curl through the generated datacenter SOCKS5 proxy
PROXY=$(curl -s "https://api.evomi.com/public/generate?product=sdc&protocol=socks5&countries=US&apikey=$KEY")
curl -x "$PROXY" -sL https://ipv4.icanhazip.com     # PROXY already has socks5:// prefix
```

### Feed it to mobilerun (whole-device proxy)

mobilerun needs SOCKS5 host/port/user/password (see CLAUDE.md "Proxies (two-tier) & mobilerun").
Generate with `prepend_protocol=false`, split on `@` then `:`, and POST:

```bash
S=$(curl -s "https://api.evomi.com/public/generate?product=sdc&protocol=socks5&countries=US&prepend_protocol=false&apikey=$KEY")
USERPASS="${S%@*}"; HOSTPORT="${S##*@}"
curl -s -X POST "https://api.mobilerun.ai/v1/devices/$DEVICE_ID/proxy" \
  -H "Authorization: Bearer $MOBILERUN_API" -H "Content-Type: application/json" \
  -d "{\"socks5\":{\"host\":\"${HOSTPORT%:*}\",\"port\":${HOSTPORT##*:},\"user\":\"${USERPASS%%:*}\",\"password\":\"${USERPASS#*:}\"}}"
```

## Gotchas

- Auth is `?apikey=` **or** header `x-apikey:` — Bearer / `?key=` both return 401.
- Targeting tokens ride on the **password**, not the username.
- SOCKS5 datacenter port is **2002** (2000=HTTP, 2001=HTTPS on the `-proxy.com` host).
- SOCKS5 is TCP-only.
- `sdc` = Shared Datacenter (cheapest). `dcp` also appears in the usage enum (dedicated DC) —
  we use `sdc`.
- Tier policy: use Evomi (datacenter) for everything; escalate to IPRoyal residential/mobile only
  when a datacenter IP gets blocked or reputation matters.
