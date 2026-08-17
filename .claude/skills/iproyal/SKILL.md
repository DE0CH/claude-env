---
name: iproyal
description: "Use IPRoyal residential proxies — point curl / requests / yt-dlp at a raw rotating or sticky residential endpoint, with country/city/state/ISP geo-targeting, the High-End Pool (clean-IP) selector, SOCKS5, and China entry nodes. Also covers the IPRoyal management API (balance, proxy-list generation, sub-users, orders, usage reports). Use whenever a task needs a residential proxy IP for scraping, geo-access, or media/YouTube downloads where a datacenter IP gets bot-blocked, or mentions IPRoyal."
compatibility: "Needs the proxy credentials (`IPROYAL_PROXY_USER` + `IPROYAL_PROXY_PASS`, from a dashboard order) to make proxy requests; the management API additionally needs `IPROYAL_API` (Bearer token from dashboard Settings → API). Only needs `curl` (and optionally `python3`)."
allowed-tools: Bash
---

# IPRoyal residential proxies

IPRoyal gives you **raw residential proxy endpoints** — point your own tools (`curl`, python `requests`, `yt-dlp`, Playwright) straight at `geo.iproyal.com` with a username/password. Nothing to install; no browser needed. Residential IPs get past the datacenter-IP bans that hit scraping and YouTube from cloud pods.

Two separate things, do not confuse them:

| | What it is | Where it comes from | Used for |
|---|---|---|---|
| **Proxy credentials** | a `username` + `password` | dashboard order (Configuration → Proxy Access), or a sub-user created via the API | **making proxy requests** (this skill's main job) |
| **API token** | a Bearer token | dashboard **Settings → API** | the **management API** (balance, generating proxy lists, sub-users, orders, reports) |

**Source of truth:** IPRoyal publishes LLM-readable docs — index at [docs.iproyal.com/llms.txt](https://docs.iproyal.com/llms.txt); every page is raw markdown by appending `.md` to its URL (e.g. [proxy/location.md](https://docs.iproyal.com/proxies/residential/proxy/location.md)). Fetch the relevant `.md` for anything not covered here. GitBook also answers questions dynamically: `GET <page>.md?ask=<question>`.

## Credentials / environment

Per this repo's secrets policy, credentials live in **environment variables** — reference them directly, never print them:

- `IPROYAL_PROXY_USER` / `IPROYAL_PROXY_PASS` — the residential proxy login (from a dashboard order). Required to make requests.
- `IPROYAL_API` — the management-API Bearer token (dashboard Settings → API). Only needed for the management API.

If you don't have proxy credentials but do have `IPROYAL_API` and the account has traffic, you can mint testable credentials by creating a **sub-user** via the API (returns a username/password) — see [Management API](#management-api).

## Quick start

The endpoint is `geo.iproyal.com` (auto-selects the best entry region). **All targeting/rotation config is packed into the password**, appended as `_key-value` tokens — the username stays clean.

```bash
# rotating residential IP, US / California, over HTTP(S)
curl -x "http://$IPROYAL_PROXY_USER:${IPROYAL_PROXY_PASS}_country-us_state-california@geo.iproyal.com:12321" \
     -sL https://ipv4.icanhazip.com

# SOCKS5 (note the different port), Germany
curl -x "socks5://$IPROYAL_PROXY_USER:${IPROYAL_PROXY_PASS}_country-de@geo.iproyal.com:32325" \
     -sL https://ipv4.icanhazip.com
```

Python `requests`:
```python
import os, requests
u, p = os.environ["IPROYAL_PROXY_USER"], os.environ["IPROYAL_PROXY_PASS"]
pw = p + "_country-us_city-newyork"           # tokens go on the password
proxy = f"http://{u}:{pw}@geo.iproyal.com:12321"
r = requests.get("https://ipv4.icanhazip.com", proxies={"http": proxy, "https": proxy})
print(r.text)
```

yt-dlp (residential IP fixes 429/datacenter bans — see the YouTube caveat at the bottom):
```bash
yt-dlp --proxy "http://$IPROYAL_PROXY_USER:${IPROYAL_PROXY_PASS}_country-us@geo.iproyal.com:12321" <url>
# SOCKS5 variant:
yt-dlp --proxy "socks5://$IPROYAL_PROXY_USER:${IPROYAL_PROXY_PASS}_country-us@geo.iproyal.com:32325" <url>
```

Always sanity-check the exit before trusting a location: `curl -x ... -sL https://ipv4.icanhazip.com` then look it up.

## Endpoints, protocols & ports

| Host | Meaning |
|---|---|
| `geo.iproyal.com` | **auto region** — use this in almost all cases |
| `proxy.iproyal.com` | Germany entry region |
| `us.proxy.iproyal.com` | US entry region |
| `sg.proxy.iproyal.com` | Singapore entry region |

| Protocol | Port | Scheme |
|---|---|---|
| HTTP/HTTPS | **12321** | `http://` |
| SOCKS5 | **32325** | `socks5://` |

- Residential proxies are **TCP only**. Per-node `alternative_ports` exist (from `/access/entry-nodes`) if the default port is blocked.
- `socks5h://` (remote DNS through the proxy) is *not* mentioned in IPRoyal's docs — they show `socks5://`. Use `socks5h://` only if you specifically need proxy-side DNS; it's standard cURL, just undocumented here.

## Targeting tokens (append to the password)

Chain tokens directly, each as `_key-value`, e.g. `…password_country-de_city-berlin_session-a1b2c3d4_lifetime-10m`.

| Feature | Token | Value / notes |
|---|---|---|
| Region | `_region-` | `africa`, `arabstates`, `asiapacific`, `europe`, `middleeast`, `northamerica`, `southlatinamerica` |
| Country | `_country-` | ISO alpha-2; **comma-separated = pick one at random**, e.g. `_country-dk,it,ie` |
| City | `_city-` | city name; **must also set `_country-`** |
| State (US) | `_state-` | state name; **must set `_country-us`** |
| ISP | `_isp-` | provider slug; chain to a city. **Gated: verified ID + $1,000 spend** |
| Country set | `_set-` | named set (e.g. `nikeeu`, `zalando`) from `/access/country-sets` |
| Geolocation | `_geolocation-` | `LAT,LON,RADIUS[,strict]`; RADIUS in miles, **min 10**; `strict` fails if none in radius |
| **High-End Pool** | `_streaming-` | `1` — cleaner/faster pool (see below). **Subscription required** |
| Skip static ISP | `_skipispstatic-` | `1` — contact support to enable |
| IP-skip list | `_skipipslist-` | ULID of a list (contact support to enable) |

### Rotation vs sticky sessions
- **Rotating (default):** add nothing — new IP every request. Optional `_forcerandom-1` widens the location pool / improves performance.
- **Sticky:** `_session-<8 alphanumeric chars>` holds one IP. Add `_lifetime-<duration>` (min `1s`, max `7 days`, single unit — `5s`, `10m`, `20h`, `24h`). Same session string = same IP within the window.
- **Killswitch:** `_killswitch-1` makes a dropped sticky IP return **HTTP 410** instead of silently rotating to a new one — use it when a stable IP matters more than always getting a response.

```bash
# sticky IP for 10 minutes, Brazil
curl -x "http://$IPROYAL_PROXY_USER:${IPROYAL_PROXY_PASS}_country-br_session-sgn34f3e_lifetime-10m@geo.iproyal.com:12321" -sL https://ipv4.icanhazip.com
```

## High-End Pool — the clean-IP selector

Add `_streaming-1` to the password. It grants "the swiftest and most reliable proxies" at the cost of a **smaller pool**. This is IPRoyal's IP-quality toggle. **It requires an active subscription** — on pure pay-as-you-go credits you're on the general pool.

```bash
curl -x "http://$IPROYAL_PROXY_USER:${IPROYAL_PROXY_PASS}_country-br_streaming-1@geo.iproyal.com:12321" -sL http://example.com
```

## China entry nodes

Alternative gateways for connecting **from China / nearby** — same ports and credentials, just swap the host:

| Region | Host |
|---|---|
| US | `us.xpt9k2wq.com` |
| Europe | `eu.xpt9k2wq.com` |
| Singapore | `sg.xpt9k2wq.com` |
| Hong Kong | `hk.xpt9k2wq.com` |
| Australia | `au.xpt9k2wq.com` |

```bash
curl -x "http://$IPROYAL_PROXY_USER:$IPROYAL_PROXY_PASS@sg.xpt9k2wq.com:12321" -sL https://ipv4.icanhazip.com
```

**Limit:** geo-routing is **not** supported through these nodes — `_country-`/`_region-`/etc. won't work on `*.xpt9k2wq.com`.

## Proxy response codes

| Code | Meaning | Action |
|---|---|---|
| 500 | Internal error | retry; if persistent, contact support |
| 503 | No exits available | your filters (country/city) match nothing — loosen them |
| 504 | Exit connection failed | usually transient — retry |
| 410 | Killswitch tripped | sticky IP gone and `_killswitch-1` was set |

## IP whitelisting (credential-free auth)

Instead of `user:pass`, whitelist your source IP against a stored config, then connect with just `HOST:PORT`. Manage in the dashboard (Configuration → Whitelisting IPs) or via the Whitelists API. Handy for fixed-IP hosts; not useful from ephemeral pods whose egress IP changes.

## Management API

- **Base URL:** `https://resi-api.iproyal.com/v1`
- **Auth:** header `Authorization: Bearer $IPROYAL_API`
- Token from dashboard **Settings → API** (resettable there). The legacy Postman API is dead as of 2025-09-15 — only this base URL works.
- Identify sub-users / whitelists / skip-lists by their **`hash`** (ULID); ignore the legacy `id` field.

Most useful calls:

```bash
# available traffic (GB) + account hash
curl -s https://resi-api.iproyal.com/v1/me -H "Authorization: Bearer $IPROYAL_API"
# -> {"available_traffic":32.6,"subusers_count":13,"residential_user_hash":"01H..."}

# what countries/cities/states/ISPs you can target, with the exact prefixes
curl -s https://resi-api.iproyal.com/v1/access/countries -H "Authorization: Bearer $IPROYAL_API"

# generate ready-to-use proxy strings (formats existing creds/sub-user; location needs its prefix)
curl -s -X POST https://resi-api.iproyal.com/v1/access/generate-proxy-list \
  -H "Authorization: Bearer $IPROYAL_API" -H "Content-Type: application/json" \
  -d '{"format":"{hostname}:{port}:{username}:{password}","hostname":"geo.iproyal.com","port":"http|https","rotation":"sticky","location":"_country-sg","proxy_count":5,"username":"'"$IPROYAL_PROXY_USER"'","password":"'"$IPROYAL_PROXY_PASS"'","lifetime":"2h"}'

# create a sub-user (returns its own username/password + allocated GB) — a clean way to mint testable creds
curl -s -X POST https://resi-api.iproyal.com/v1/residential-subusers \
  -H "Authorization: Bearer $IPROYAL_API" -H "Content-Type: application/json" \
  -d '{"username":"scraper1","password":"a-strong-pass","traffic":1.0}'

# usage report as CSV
curl -s "https://resi-api.iproyal.com/v1/residential/data-usage-report?hash=<HASH>&date_from=2026-01-01&date_to=2026-01-31&measurement_unit=GB&rounding_decimal=2" \
  -H "Authorization: Bearer $IPROYAL_API" -o usage.csv
```

Other endpoints (see the `.md` docs for exact bodies): `GET/POST /residential/orders`, `GET /residential/orders/calculate-pricing`, `GET/DELETE/POST /residential/subscription…`, sub-user CRUD + `give-traffic`/`take-traffic` under `/residential-subusers/{hash}`, whitelist CRUD under `/residential-users/{residential_user_hash}/whitelist-entries`, IP-skip lists under `/residential-users/{residential_user_hash}/ips-skipping`, and `DELETE /sessions` to reset sticky sessions. Note the docs label some updates `UPDATE` but the actual verb is `PUT`.

## Gotchas

- **All config goes on the PASSWORD, not the username.** The username is your plain login; every `_key-value` is appended to the password.
- **High-End Pool = `_streaming-1`** (odd name), and it needs an **active subscription** — not available on pure PAYG credits.
- **Session IDs are exactly 8 alphanumeric chars**; lifetime min 1s / max 7 days, single time unit.
- **Ports differ by protocol:** HTTP/HTTPS `12321`, SOCKS5 `32325`.
- **China nodes drop geo-routing** — location tokens are ignored on `*.xpt9k2wq.com`.
- **Gated features:** ISP targeting (verified ID + $1,000 spend), skip-static-ISP and IP-skipping (contact support). Some domains (Yahoo/LinkedIn/Live, `.gov`, PlayStation, certain banks) are blocked until identity/spend verification.
- **YouTube:** a residential IP fixes the 429/datacenter ban, but **not** YouTube's "sign in to confirm you're not a bot" PO-token wall. For reliable YouTube specifically, a server-side downloader (loader.to) still beats DIY yt-dlp-through-proxy; use the proxy for general scraping and geo-access.
