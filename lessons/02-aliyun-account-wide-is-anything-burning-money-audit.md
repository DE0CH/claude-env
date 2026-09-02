## Aliyun account-wide "is anything burning money" audit (2026-08-21)

Don't stop at listing service instances — query BssOpenApi with the ADMIN key for the
authoritative answer: `QueryAccountBalance` + `QueryBillOverview` (BillingCycle=YYYY-MM)
give per-product month totals, and `DescribeInstanceBill` (BillingDate=…, Granularity=DAILY)
proves whether anything accrued *today*. Host `business.aliyuncs.com`, version 2017-12-14,
same ACS3-HMAC-SHA256 signing as ecp_call.py (just parameterize the host). Gotchas: the
eds-aic SG endpoint returns `ProfileRegion.Unsupported` when the account never activated
the product there (that's "nothing exists", not an error to debug); HK/EU cloud phones are
listed via the cn-shanghai endpoint with `BizRegionId=`; the auto-created OSS screenshot
bucket (`cloudphone-saved-bucket-*`) keeps billing ~¥0.0000002/day forever after a phone
PoC — harmless, but it's why the daily bill never reads exactly zero.
