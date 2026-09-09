# China-accessible static hosting: Aliyun OSS Hong Kong + custom domain + GitOps (2026-09-09)

Context: the 教师工作台 React SPA (DE0CH/kate-workdesk) for a teacher in Shenzhen. Vercel
worked fine for us but `*.vercel.app` is GFW-blocked for her. Ended up on
**https://kate.deyaochen.com** = Aliyun OSS Hong Kong bucket, custom domain, HTTPS, no ICP 备案.

## Hosting facts that cost real time
- **HK region needs no 备案** and is ~10 ms from Shenzhen. 备案 is only for mainland
  servers/buckets. Mainland OSS also refuses to serve HTML on an un-备案'd domain.
- **Aliyun force-downloads HTML on the default OSS domain** (`Content-Disposition: attachment`,
  `x-oss-force-download: true`) — an anti-website-hosting policy, all regions. curl shows the
  headers; a browser hits "Download is starting". You cannot override it per object. The fix is
  a **custom domain bound to the bucket** — on a bound CNAME OSS serves HTML inline.
- New buckets come with **bucket-level Block Public Access = on** even when created with
  `--acl public-read`: objects 403 anonymously and per-object `--acl public-read` fails with
  "Put public object acl is not allowed". Account-level was off. Fix: `PUT /?publicAccessBlock`
  with `<BlockPublicAccess>false</BlockPublicAccess>` on the bucket (hand-signed OSS V1 call;
  ossutil 1.7 has no command for it). Then upload *without* `--acl` (objects inherit).
- `ossutil` (1.7.16, `https://gosspublic.alicdn.com/ossutil/1.7.16/ossutil64` — 1.7.19 404s)
  does the whole custom-domain flow: `bucket-cname --method put --item token` → add TXT
  `_dnsauth.<host>` = token → `bucket-cname --method put --item certificate <xml>` with
  the fullchain + private key inline → `website --method put` for index.html at `/`.
- Cert: **acme.sh + Cloudflare DNS-01** (`CF_Token=$CLOUDFLARE_API`, `--server letsencrypt`)
  issued in ~1 min. Cloudflare CNAME must be **DNS-only (grey cloud)** so traffic goes straight
  to OSS. Cert is 90 days and auto-renewal is NOT wired — it must be re-issued and re-bound.
- `pip install oss2` fails to build (crcmod) on the pods; use the ossutil binary instead.

## Supabase gotchas
- The dashboard login is behind an **hCaptcha the Browserbase solver can't clear** — sign-in
  hangs on "Signing in…" forever. Don't fight it: ask for a **Personal Access Token** and use
  the Management API (create project, `database/query` for DDL, `config/auth` for redirect
  URLs, `api-keys` for anon/service_role).
- **The Management API 403s Python urllib's default User-Agent** (curl works). Set a curl-like
  UA. (Same trap the original handoff recorded as "用 curl, urllib 被 WAF 403".)
- No project-scoped credential can run DDL: CI migrations need either the DB password or a
  PAT (account-wide). A tiny Management-API runner (`database/query`, ledger table) needs only
  the PAT and avoids the IPv6/pooler flakiness of `supabase db push` from GitHub runners.
- PATs can't be minted via API (dashboard only); Aliyun RAM users/keys CAN be minted via the
  RAM RPC API (`CreateUser`/`AttachPolicyToUser`/`CreateAccessKey`, HMAC-SHA1, `ram.aliyuncs.com`)
  — do this from an admin key to hand CI a scoped OSS-only key. A RAM user holds max 2 keys;
  `ListAccessKeys`+`DeleteAccessKey` orphans before minting.

## Ops traps
- `pkill -f <name>` / `pgrep -f <name>` inside an inline Bash command matches the command's
  own shell (exit 144). Put kill/restart logic in a **script file** and run `bash file.sh`.
- Transient `SSL: UNEXPECTED_EOF_WHILE_READING` to aliyuncs from the Mac (OpenClash path):
  just retry; wrap urlopen in a 3–4 attempt loop.
