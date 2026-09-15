# Making a YouTube video castable to a China hotel TV

Task shape: Deyao is in a mainland-China hotel and wants to watch a YouTube video on the room
TV. The room TV is a Chinese casting box (投屏 — e.g. TCL box at Hilton Garden Inn) that speaks
**DLNA + AirPlay + 乐播/Lebo**, but **NOT Google Cast**. So YouTube's own cast button never
finds it (Google Cast is a closed protocol *and* Google is GFW-blocked). Verified working
2026-09-15.

## The winning architecture (DLNA URL-handoff)

Casting via DLNA = the phone is only a **remote control**: it hands the TV an **HTTP URL** and
the TV **fetches the video itself** over its own internet connection. So you split two roles:

- **Control point** — MUST be on the hotel LAN (the phone). Discovers the TV via SSDP and
  sends `SetAVTransportURI`+`Play`. Use the **Web Video Caster** iOS/Android app: tap the CAST
  icon → pick the room device (room number, e.g. 2712) → **Browser** → paste the video URL →
  cast. (Do NOT use its "Phone files" — that serves from the phone over the LAN and hits hotel
  client-isolation.)
- **Media origin** — anywhere the TV can reach over the internet. Host the MP4 at an
  **in-China origin** so the TV streams it fast with no GFW hop. This also sidesteps hotel
  guest-isolation for the big transfer; only the tiny control packets cross the LAN.

## CRITICAL pitfall: YouTube downloads are FRAGMENTED MP4 → won't play

A YouTube-downloaded MP4 is usually a **fragmented MP4 (DASH)**: top-level atoms look like
`ftyp / moov / moof / mdat / moof / mdat …` repeating. Native phone players sometimes tolerate
it, but **simple downloaders and DLNA TV boxes choke on it** — the symptom is "the video is
broken, won't even download/play." It is NOT corrupt (a full `ffmpeg -f null` decode passes).

**Fix = stream-copy remux to a progressive MP4** (no re-encode, ~90s for 1.5GB):
```bash
ffmpeg -v warning -y -i in.mp4 -map 0:v:0 -map 0:a:0 -c copy -movflags +faststart out.mp4
```
Afterwards the atoms are `ftyp / moov / free / mdat` (single moov+mdat, moov first =
faststart). A stray `bin_data` (timecode) data track may survive the map — harmless; add `-dn`
if a strict player still complains.

Check fragmentation by walking top-level boxes (range-read 16 bytes, read size+type, seek by
size): if you see repeating `moof/mdat`, it's fragmented. Confirm the fix: `moov` must appear
in the first ~64KB and before `mdat`.

## Hosting: Aliyun OSS cn-shenzhen, default endpoint (no 备案, no domain, no ports)

Best origin for a mainland hotel = **Aliyun OSS in cn-shenzhen** (mainland, no border hop).
Deyao's worries about needing a domain / opening 80/443 DON'T apply if you use the **default
OSS endpoint** — 备案 is only required to bind a *custom domain* to a mainland bucket; the
built-in `https://<bucket>.oss-cn-shenzhen.aliyuncs.com/<key>` needs no filing, no domain, no
ports (Aliyun already serves it on 80 & 443). The mainland "force-download HTML" quirk
(lesson 38) is irrelevant for MP4 — media players ignore Content-Disposition.

Recipe (keys `ALIBABA_CLOUD_ACCESS_KEY_ID_ADMIN` / `_SECRET_ADMIN`, `oss2` pip pkg):
1. `bucket.create_bucket()`; then `bucket.put_bucket_public_access_block(False)` (new mainland
   buckets ship with Block-Public-Access ON); then `bucket.put_bucket_acl(BUCKET_ACL_PUBLIC_READ)`.
2. Upload the **remuxed** file with `oss2.resumable_upload(..., headers={"Content-Type":
   "video/mp4","Content-Disposition":"inline"}, num_threads=4, part_size=50MB)`; then
   `put_object_acl(key, OBJECT_ACL_PUBLIC_READ)`.
3. Verify from the pod: `curl -I` → 200 + `Accept-Ranges: bytes`; a `Range: bytes=0-…` GET →
   **206** (seeking); `moov` in the first 64KB. Plain `http://` on the same host also works
   (fallback for picky DLNA players).

Transfer note: streaming Germany-Hetzner → pod → Shenzhen-OSS ran ~60 MB/s down, ~5 MB/s up
(≈5 min for 1.45 GB up). The 1080p H.264-High + AAC codec is already TV-safe — no transcode.

## Cleanup
One-time host: delete the bucket/object when done (Deyao will say). It's a public-but-obscure
URL; fine for a public YouTube video, reconsider ACL for anything private (use a presigned URL
instead).
