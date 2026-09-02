## Cloud phone outside China + Play Store installs + proxy (2026-08)

Follow-up to the eds-aic harness: run a phone OUTSIDE mainland China so it
reaches Google Play, install apps without MobileNext, and fit a China-resident
proxy. Findings:

### Provisioning a non-mainland phone (Part 1)

- **PostPaid (hourly, ~0.3元/h) is whitelist-only outside the mainland.**
  `CreateAndroidInstanceGroup ChargeType=PostPaid` in cn-hongkong /
  ap-southeast-1 / eu-central-1 all fail `PostPaid.RegionNotAllowed`
  ("please apply for whitelist"). Only mainland regions (e.g. cn-shanghai)
  create PostPaid without a ticket.
- **Outside the mainland you must use PrePaid (~monthly).** `ChargeType=PrePaid
  Period=1 PeriodUnit=Month AutoPay=False` creates an UNPAID order (no charge)
  that Deyao pays in the console; roughly 65–100元/month for acp.basic.small.
  `AutoPay=True` bills immediately from account balance.
- **Region/stock:** HK and Frankfurt (eu-central-1) have acp.basic.small stock;
  Singapore (ap-southeast-1) showed it in DescribeSpec but `CheckResourceStock`
  returned empty (out of stock). Check stock with param **AcpSpecId** (NOT
  InstanceGroupSpec) via CheckResourceStock. HK is the natural pick: closest,
  reaches Google, low latency to CN proxies.
- eds-aic has no DescribePrice; the RAM user (AliyunECDFullAccess) can't call
  BssOpenApi GetOrderDetail (NotAuthorized) — get prices from the console.

### Installing Play Store apps without MobileNext (Part 1)

The reliable, scriptable replacement is **apkeep** (`cargo install apkeep`,
v1.0.0 builds fine in the container; no prebuilt via the session's GitHub proxy
but crates.io works). Backends: `apk-pure` (default, no auth — proven: pulled a
12 MB APK from the container in seconds), `google-play`, `f-droid`,
`huawei-app-gallery`.

- **True Play Store downloads** need `-d google-play` + a token:
  `apkeep -a <pkg> -d google-play -e <email> -t <aas_token> .` (long-lived AAS
  token from a Google account), or `--auth-token ya29.… --accept-tos` using a
  short-lived AUTH token from Aurora's dispenser. **Anonymous dispensers are
  flaky** (Cloudflare-fronted, account-pool exhaustion — auroraoss.com/api/auth
  returned an HTML challenge, not a token). For reliability, mint an AAS token
  once from a dedicated throwaway Google account and put it in
  `~/.config/apkeep/apkeep.ini`; then apkeep needs no dispenser.
- apkeep in the container → transfer APK to the phone. On-phone `curl` +
  `pm install -r` (existing `install_apk_from_url`) needs a public URL the phone
  can reach — host via the cf-tunnel, or an OSS presigned URL. Or run Aurora
  Store ON the phone (arm64 APK `com.aurora.store` from apk-pure, anonymous
  login) for an interactive Play client. apk-pure APKs install directly with no
  Google account at all — simplest when a Play mirror is acceptable.

### Fitting a proxy to the phone (Part 2) — YES, natively

eds-aic has a **built-in transparent SOCKS5 proxy** in the policy group
(`NetRedirectPolicy`) — no root hackery on the phone. Confirmed live:
`ModifyPolicyGroup` accepts it (HTTP 200) and it round-trips in `ListPolicyGroups`.
Fields: `NetRedirect on|off`, `CustomProxy on|off`, `ProxyType socks5` (only
socks5), `HostAddr` (**must be a literal IPv4**, hostnames rejected), `Port`,
`ProxyUserName`/`ProxyPassword`, and `Rules[]` — up to 100 `{Target, RuleType}`
where RuleType is `domain` (e.g. `*.weixin.qq.com`) or `prc` (app package). Empty
Rules routes ALL traffic; rules let you send only Chinese apps through the CN
exit while Google Play stays on the phone's real IP. Driver:
`scripts/ecp.py proxy-set <pg-id> <ip> <port> [--user U --password P]
[--rule domain:*.x.com] [--rule prc:com.pkg]` / `proxy-show` / `proxy-off`.

### China-resident IP proxies (Part 3)

Genuine mainland residential IPs are scarce and often relabeled HK/TW. Notes:
- **PIA S5 Proxy has NO mainland China** (excluded by local policy) despite a
  huge global SOCKS5 pool — don't count on it. Google's Jan-2026 botnet takedown
  also disrupted several proxy pools.
- Providers that DO advertise genuine mainland CN Telecom/Unicom/Mobile
  residential with SOCKS5 + user:pass: **Oxylabs** (China residential/ISP,
  socks5, ~$4–8/GB), **IPRoyal** (dedicated CN IPs, socks5, recommends socks5
  for the GFW), **SOAX** (~31k CN IPs), **Shifter** (11M CN IPs), **ABCProxy**
  (~$0.8/GB — but Trustpilot flags some repackaged datacenter IPs). Verify
  authenticity per-IP before trusting (fraud/ASN score, whois → real CN ISP).
- **Fitting to eds-aic:** the SOCKS5 hop is phone(HK)→provider gateway, and
  the CN exit is selected via username params (`user-country-cn-session-…`),
  which fits ProxyUserName (1–256 chars, no CJK/space). `HostAddr` needs the
  gateway as an **IPv4** — pick a provider that gives an IP endpoint, or pin a
  stable gateway IP. The GFW's un-obfuscated-socks5 blocking mainly hits
  outbound-from-CN, so an inbound HK→gateway→CN-exit path is usually fine but
  can be flaky; prefer providers with stable CN routing.
