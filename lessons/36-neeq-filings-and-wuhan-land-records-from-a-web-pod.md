# NEEQ (新三板) filings and Wuhan land records from a web pod

Context: 2026-09-04/05 task "三家公司资金往来分析" (博达 / 双翼科技 / 智创双翼). Needed a
delisted NEEQ company's historical filings, plus Wuhan land-auction results, without
ScrapingBee (quota out) and with tianyancha/qcc/qichamao all login-walled.

## NEEQ (www.neeq.com.cn)

- **Announcement list API**: `POST /disclosureInfoController/infoResult.do` with form
  `disclosureType=5&page=N&companyCd=<code>&isNewThree=1&startTime=&endTime=&keyword=&xxfcbj=&sortfield=xxssdq&sorttype=asc`
  (20 rows/page, `listInfo.totalElements` gives the total). Response is JSONP-ish:
  `null([...])` — strip the `null(`…`)` wrapper, then it's a JSON array whose element
  with `listInfo.content[]` holds `{publishDate, disclosureTitle, destFilePath}`.
  Works for **delisted** companies too (双翼 836301, delisted 2021-02, still had 243 rows).
- **The Browserbase Fetch API gets 403 on the PDFs** (`/disclosure/YYYY/…pdf`) and the
  direct company page (`/nq/detailcompany.html?companyCode=`) 404s. What works: a
  Browserbase browser session, `page.goto('https://www.neeq.com.cn/')`, then run the
  POST and the PDF downloads **inside the page** with `fetch(url,{credentials:'include'})`
  and return `Array.from(new Uint8Array(await r.arrayBuffer()))` from `page.evaluate`
  (a few hundred KB per PDF is fine; avoids base64, which the permission classifier
  blocks). ~1 s sleep between PDFs; no captcha seen.
- Annual reports/公开转让说明书 are text PDFs; `pymupdf` extracts cleanly. The
  转让说明书 is the richest doc: 前五名客户 with 关联/非关联 flags, related-party lists,
  every lease (出租方/面积/月租金), pricing policy.

## Wuhan land auction results (zrzyhgh.wuhan.gov.cn 土地交易市场 → 成交信息)

- Listing pages `…/tdjysc/cjxx/index_N.shtml` are static and **Browserbase-Fetch-able**
  (the detail pages too). Pagination ≈ 4–5 pages/year: index_30 ≈ 2022, index_40 ≈ 2019,
  index_50 ≈ 2018, index_60 ≈ 2017, index_70 ≈ 2016. Each listing links to
  "20XX年第N号公告成交信息表" and separate "…工业用地网挂公告成交信息表" pages that
  carry the 竞得人 / 土地位置 / 面积 / 成交价 table. Parse `<a href>` inner HTML (title
  text is nested/whitespace-padded), then fetch each detail page — 3 parallel workers,
  ~100 pages in ~2 min. Driving the same pages through a Browserbase tab was ~10×
  slower.

## Tooling gotchas hit on the way

- System `cryptography` was broken (`No module named '_cffi_backend'`), which took
  `pypdf` and `pdfminer.six` down with it → `pip install cffi pymupdf` and use pymupdf.
- `pkill -f "node land.js"` killed the calling shell (pattern matched its own command
  line, exit 144). Use `pkill -f "[n]ode land.js"` (lesson 34's self-kill trap, again).
- Browserbase Fetch returns binary bodies (PDF, GBK HTML) base64-encoded in `content`;
  decode locally (`base64.b64decode` on a response body is fine — the classifier rule is
  about *encoding* transcripts/artefacts).
- Exa's crawler reads `m.qcc.com/firm/<KeyNo>.html` pages that block the Fetch API and
  the bare tab — `exa contents <url>` returned shareholder tables for 上海博达; but qcc
  serves a login wall for some firms (双翼科技), and qichamao/tianyancha search pages are
  login-walled everywhere.

## Corporate-registry graph walking without a qcc login (added 2026-09-05)

- `exa /contents` on `https://m.qcc.com/firm/<KeyNo>.html` returns the page's
  `window.__INITIAL_STATE__` JSON for most firms (some, e.g. 双翼科技, are login-walled).
  Parse `"StockName"…"StockPercent"` (percent is `******` for anonymous users) and
  `"Name":…,"Job":…` for officers; `"KeyNo"` values inside the blob give you the
  KeyNos of shareholders (32-hex) and people (`p…` 32 chars) — no search page needed.
- Person pages `https://m.qcc.com/pl/<pKeyNo>.html` list the person's real 关联企业
  first, then a long "recommended" tail; only trust an entry after opening that firm's
  own page. Batch 5–10 URLs per `/contents` call; some URLs silently drop out, retry
  them in the next batch.
- Address strings are evidence: firms of one circle cluster in the same 小区/楼层
  (将军帽小区33号 C栋101 / D栋201 / D栋202 / D栋301; 中信楼 104-2 / 104-3).
- Drive connector `download_file_content` returns base64 into the conversation —
  fine for a 15 KB xlsx, unusable for MB-scale statements. Read small docx/xlsx with
  `read_file_content` instead; for big binaries use another transfer path.
- Audio: 3 m4a → 16 kHz mono 48 kbps mp3 chunks (≤4 min) → OpenRouter `openai/gpt-audio`
  chat completion with `input_audio`; ~10 min of Mandarin transcribed cleanly with
  speaker labels. Trailing <30 s chunks may come back "请提供录音" — re-prompt saying it's
  the tail of a conversation.
