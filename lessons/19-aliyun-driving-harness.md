## Aliyun 无影云手机 (eds-aic Cloud Phone) driving harness (2026-08)

PoC done end-to-end from a web container (create → install WeChat → tap/type/
screenshot). Use `scripts/ecp.py` (built on the hand-signed `scripts/ecp_call.py`;
the official alibabacloud SDK wheels don't build in the container). Facts:

- **Cheapest spec `acp.basic.small`** (2c/4G/32G), PostPaid + `PeriodUnit=Hour`
  ≈ 0.38元/h, stock in cn-shanghai-l. CreateAndroidInstanceGroup → RUNNING in
  ~1 min. Delete the group (`ecp.py delete ag-...`) to stop billing.
- **Root shell, no ADB needed**: `RunSyncCommand` (≤3 s wall, WaitTime≤3000ms)
  runs as root. Screen is 720x1280. `RunCommand` + `DescribeInvocations` for
  long commands (APK downloads, pm install).
- **Screenshots**: `CreateScreenshot` → poll `DescribeTasks` (TaskIds.N) →
  `Result` field holds a signed OSS URL; whole cycle ~5-10 s. Auto-creates
  bucket `cloudphone-saved-bucket-<region>-<uid>`.
- **APK install: download ON the phone** (`curl` exists, root, China network —
  dldir1v6.qq.com 248MB in seconds) to `/data/local/tmp` + `pm install -r`.
  `SendFile(UploadType=DOWNLOAD_URL, AutoInstall=true)` is a trap: left a
  0-byte file AND AutoInstall's pm install can't read /sdcard (SELinux denies
  system_server on fuse). No preinstalled app store on the stock image.
- **`input text` is ASCII-only** (typed digits fine); Chinese needs clipboard/IME.
- WeChat 8.0.56 arm64 APK URL came from weixin.qq.com via ScrapingBee (1 credit,
  no JS): grep the download page for `.apk` URLs.
- API metadata without docs-scraping: `api.aliyun.com/meta/v1/products/eds-aic/
  versions/2023-09-30/apis/<Action>/api.json` (and `overview.json` for the full
  120-action list) — param schemas + response shapes, fetchable with plain curl.
