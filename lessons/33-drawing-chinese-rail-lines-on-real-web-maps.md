## Drawing Chinese rail lines on real web maps (2026-08-26, 坪山新线报告)

- **CARTO basemap tiles now require an API key** — `basemaps.cartocdn.com` renders an
  "API KEY REQUIRED / carto.com/basemaps/apikey" watermark over every tile. Use
  `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (keyless, loads fine for viewers);
  dark mode via CSS `filter: invert(1) hue-rotate(180deg)` on `.leaflet-tile`.
- **GCJ-02 offset trap**: coordinates from Chinese sources (高德/百度 pages, apps) are
  GCJ-02/BD-09 encrypted and land ~300–600 m off on an OSM (WGS-84) basemap. Never mix
  them in raw. Get WGS-84 coords from OSM itself / Wikipedia coordinates.
- **Overpass API is the gold source for under-construction Chinese rail**: OSM already
  carries the real alignments as `railway=construction` ways with Chinese names
  (深大城际线 11 ways, 深惠城际铁路大鹏支线 12 ways) plus station/stop nodes. Query
  `overpass-api.de/api/interpreter` with `--data-urlencode data@file.ql`; the egress
  gateway resets a fraction of connections — retry with backoff (kumi.systems mirror
  returned 500). Way-splits in the geometry mark station locations (platform segments) —
  usable to infer unmapped stations (e.g. 大鹏站). 深汕高铁 has NO OSM alignment yet —
  station-to-station dashed lines with an explicit caveat is the honest fallback.
- **Never invent station positions**: first draft guessed 聚龙站 southwest of 坪山 —
  it's actually northeast (22.731, 114.377, 龙田街道) — and Deyao caught the lines "not
  even overlapping". All three new lines really do meet at 深圳坪山站 (22.7104, 114.3222):
  深大城际 has a 坪山站 (2台4线) at the hub before terminating at 聚龙 (official 11-station
  list: T4枢纽/机场东/黄麻布/石岩中心/龙胜/民治北/五和/白坭坑/大运/坪山/聚龙, gov source
  szlhq.gov.cn), and 大鹏支线's 坪山站 wraps the 深大 mainline there.
- **Verifying a deployed page from a pod**: local Playwright gets ERR_CONNECTION_RESET
  through the egress gateway even for vercel.app — screenshot through a Browserbase
  session instead (REST `X-BB-API-Key` + Playwright `connectOverCDP`; the `browse` CLI
  is NOT installed in web pods, plain REST works; global playwright lives at
  /opt/node22/lib/node_modules). ScrapingBee screenshots were unavailable: **monthly
  quota exhausted 2026-08-26 ("Monthly API calls limit reached: 1000")** — Deyao pinged.
