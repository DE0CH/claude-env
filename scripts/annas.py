"""Anna's Archive search + download, command line only.

Requires the ANNA_API env var (Anna's Archive fast-download API key) and the
curl_cffi + beautifulsoup4 packages.
"""
import argparse
import os
import urllib.parse
from pathlib import Path
from typing import Literal

from curl_cffi import requests
from bs4 import BeautifulSoup

BASE = os.environ.get("ANNAS_BASE", "https://annas-archive.pk")


def _api_key() -> str:
    key = os.environ.get("ANNA_API") or os.environ.get("ANNAS_KEY")
    if not key:
        raise RuntimeError("ANNA_API env var is not set (Anna's Archive API key)")
    return key


TYPE_PARAMS = {
    "book": {},
    "fiction": {"content": "book_fiction"},
    "nonfiction": {"content": "book_nonfiction"},
    "magazine": {"content": "magazine"},
    "comic": {"content": "book_comic"},
    "article": {"src": "scihub"},
}

ContentType = Literal["book", "fiction", "nonfiction", "magazine", "comic", "article"]


def search(query: str, type: ContentType = "book", limit: int = 10) -> list[dict]:
    params = {"q": query, **TYPE_PARAMS[type]}
    r = requests.get(
        f"{BASE}/search?{urllib.parse.urlencode(params)}",
        impersonate="chrome",
        timeout=30,
    )
    r.raise_for_status()
    seen, out = set(), []
    for a in BeautifulSoup(r.text, "html.parser").select("a[href^='/md5/']"):
        md5 = a["href"].removeprefix("/md5/")
        title = a.get_text(strip=True)
        if md5 and title and md5 not in seen:
            seen.add(md5)
            out.append({"md5": md5, "title": title})
            if len(out) >= limit:
                break
    return out


def _fast_download_meta(md5: str, domain_index: int | None, path_index: int | None) -> dict:
    key = _api_key()
    params: dict = {"md5": md5, "key": key}
    if domain_index is not None:
        params["domain_index"] = domain_index
    if path_index is not None:
        params["path_index"] = path_index
    return requests.get(
        f"{BASE}/dyn/api/fast_download.json",
        params=params,
        impersonate="chrome",
        timeout=30,
    ).json()


def download(md5: str, output_dir: str = ".", domain_index: int | None = None, path_index: int | None = None) -> dict:
    meta = _fast_download_meta(md5, domain_index, path_index)
    if not meta.get("download_url"):
        raise RuntimeError(f"no download_url in response: {meta}")
    url = meta["download_url"]
    if not url.startswith("https://"):
        raise RuntimeError(f"refusing non-https download URL: {url!r}")
    name = urllib.parse.unquote(url.rsplit("/", 1)[-1]) or f"{md5}.bin"

    out_dir = Path(output_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / name

    r = requests.get(url, impersonate="chrome", timeout=300, stream=True)
    r.raise_for_status()
    with open(out_path, "wb") as f:
        for chunk in r.iter_content(65536):
            f.write(chunk)

    info = meta.get("account_fast_download_info", {})
    return {
        "path": str(out_path.resolve()),
        "bytes": out_path.stat().st_size,
        "downloads_left_today": info.get("downloads_left"),
    }


def get_url(md5: str, domain_index: int | None = None, path_index: int | None = None) -> dict:
    """Resolve the fast-download URL and quota info without downloading the file."""
    meta = _fast_download_meta(md5, domain_index, path_index)
    info = meta.get("account_fast_download_info", {})
    return {
        "download_url": meta.get("download_url"),
        "downloads_left_today": info.get("downloads_left"),
        "downloads_done_today": info.get("downloads_done_today"),
        "recently_downloaded_md5s": info.get("recently_downloaded_md5s"),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(prog="annas.py", description="Anna's Archive search + download")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_search = sub.add_parser("search", help="search Anna's Archive")
    p_search.add_argument("query", nargs="+", help="search terms")
    p_search.add_argument("--type", choices=list(TYPE_PARAMS), default="book")

    p_get = sub.add_parser("get", help="download a file by md5")
    p_get.add_argument("md5")
    p_get.add_argument("output_dir", nargs="?", default=".")
    p_get.add_argument("--domain-index", type=int, default=None)
    p_get.add_argument("--path-index", type=int, default=None)

    p_url = sub.add_parser("url", help="fetch the download URL + quota without downloading")
    p_url.add_argument("md5")
    p_url.add_argument("--domain-index", type=int, default=None)
    p_url.add_argument("--path-index", type=int, default=None)

    args = parser.parse_args()

    if args.cmd == "search":
        for hit in search(" ".join(args.query), type=args.type):
            print(f"{hit['md5']}  {hit['title']}")
    elif args.cmd == "get":
        result = download(args.md5, output_dir=args.output_dir, domain_index=args.domain_index, path_index=args.path_index)
        print(f"{result['path']}  ({result['bytes']:,} bytes, {result['downloads_left_today']} downloads left today)")
    elif args.cmd == "url":
        result = get_url(args.md5, domain_index=args.domain_index, path_index=args.path_index)
        print(f"download_url: {result['download_url']}")
        print(f"downloads_left_today: {result['downloads_left_today']}")
        print(f"downloads_done_today: {result['downloads_done_today']}")
