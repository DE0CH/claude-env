---
name: annas-archive
description: "Search and download books, papers, and other files from Anna's Archive (the shadow-library aggregator) via its fast-download API. Use whenever a task needs to find or fetch a book / textbook / novel / magazine / comic / scientific paper by title or author, mentions Anna's Archive / annas-archive / libgen / sci-hub, or needs an ebook or PDF pulled down by md5. Command-line only (scripts/annas.py) — no MCP server."
compatibility: "Needs the Anna's Archive fast-download API key in env var `ANNA_API`, plus the `curl_cffi` and `beautifulsoup4` Python packages. Works where outbound TLS is NOT MITM-intercepted (e.g. Deyao's Mac). In a Claude-on-the-web pod the egress gateway resets curl_cffi's browser-TLS impersonation, which DDoS-Guard requires — see 'Container limitation' below."
---

# Anna's Archive (command line)

`scripts/annas.py` wraps Anna's Archive: **search** the site and **download** files by md5
through the `dyn/api/fast_download.json` fast-download API. CLI only — the dissertation repo runs
this as an MCP server, but here we deliberately use just the command line (Deyao's preference).

## Credentials / environment

Per the repo secrets policy, reference the env var directly, never print it.

- **`ANNA_API`** — the Anna's Archive fast-download API key (from an Anna's Archive membership).
  The script reads `ANNA_API` (falling back to `ANNAS_KEY` for parity with the dissertation repo).
- The site domain defaults to `https://annas-archive.pk`; override with `ANNAS_BASE` if that
  mirror is down (e.g. `annas-archive.se`, `annas-archive.org` — though those may be blocked in
  a pod, see below).

## Commands

```bash
# Search — prints "<md5>  <title>" lines (up to 10 hits)
python3 scripts/annas.py search "Munkres Topology" --type nonfiction

# --type ∈ {book (default), fiction, nonfiction, magazine, comic, article}
#   article routes through the Sci-Hub source (scientific papers)

# Download by md5 into a directory (created if missing; default ".")
python3 scripts/annas.py get <md5> ~/Downloads

# Resolve the download URL + see quota WITHOUT downloading (free for an md5 already
# fetched today — see quota accounting below)
python3 scripts/annas.py url <md5>
```

`get` prints the saved path, byte size, and downloads-left-today. Pass an **explicit**
`output_dir` — the default `.` is wherever the command runs from.

## Quota accounting (empirically verified)

Anna's quota tracks **distinct md5s**, not raw API calls. The fast-download response carries
`recently_downloaded_md5s` (the day's history) and `downloads_done_today = len(that list)`.

- Retrying the **same** md5 (e.g. a different `--domain-index` to dodge a TLS error or 404) is
  **free** after the first call for that md5 that day — it does not decrement `downloads_left`.
- Calling for a **new** md5 costs one slot (typically 25/day).
- So mirror-hopping to recover a bad download is free; only probe **new** md5s deliberately.

## TLS / mirror errors → retry a different `--domain-index`

Each md5 is served from several CDN mirror combinations, selected by `--domain-index` /
`--path-index`. Some are temporarily broken (404, hang, corrupt file, or a broken cert chain
giving "self signed certificate in certificate chain").

Recovery: retry the **same md5** with `--domain-index 1`, then `2`, … (free, per above).
Bump one knob at a time, and only in response to a real failure — never probe speculatively.

**On a TLS error, keep certificate verification ON.** The script only follows `https://` URLs
and refuses `http://` ones. Do **not** disable verification, add `verify=False`, or fetch the
URL through a cert-ignoring tool — a persistent TLS failure means the file is not safe; recover
only via `--domain-index`, and surface a persistent failure to Deyao.

## Container limitation (Claude-on-the-web pods)

`annas-archive.pk` sits behind **DDoS-Guard**, which only a real browser TLS fingerprint passes
— that is why the script uses `curl_cffi` with `impersonate="chrome"`. In a web-container pod the
Anthropic **egress gateway MITMs all outbound TLS** and **resets** the impersonated handshake
(`curl: (35) Recv failure: Connection reset by peer`); dropping the impersonation instead lands on
DDoS-Guard's `403` challenge wall. Both paths fail — this is an environment conflict, not a bug,
and it matches the egress-gateway notes in `lessons.md`.

- **Where it works:** any environment without a TLS-MITM gateway — in particular Deyao's Mac (the
  proven setup; the dissertation repo runs the same code there).
- **In a pod:** if a download is genuinely needed, fall back to fetching through **Browserbase**
  (repo policy for blocked web content) rather than fighting the gateway. Do not disable TLS
  verification to get around it.

## Dependencies

`curl_cffi` and `beautifulsoup4` (both pip-installed). If either is missing:

```bash
pip install curl_cffi beautifulsoup4
```

These are not persisted across pod sessions, so reinstall them if a fresh pod is missing them.
