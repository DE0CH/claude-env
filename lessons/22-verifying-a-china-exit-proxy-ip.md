## Verifying a China-exit proxy IP (2026-08)

`ipv4.icanhazip.com` (and most western IP-echo services) are GFW-blocked — from a CN
exit the page just never loads; it is NOT a proxy failure. Use a China service instead:
**`https://myip.ipip.net`** is the best single check — one text line with IP + geo +
carrier (e.g. `当前 IP：120.239.79.167 来自于：中国 广东 广州 移动` = a China Mobile
cellular-pool IP). Alternatives: `www.cip.cc`, `ip.3322.net`. IPRoyal residential
`_country-cn` does hand out real CN carrier (移动/联通/电信) IPs.
