#!/usr/bin/env python3
"""Single-document WYSIWYG markdown editor server (pairs with cf-tunnel).

Serves scripts/md-editor/ (the Toast UI Editor page + vendored assets) and
exposes ONE markdown file for editing with autosave:

    GET  /doc   -> the file's text (text/plain) + X-Doc-Version header
    POST /doc   -> body replaces the file (atomic write). Send the version you
                   loaded in X-Doc-Version; a mismatch returns 409 with the
                   current text so the page can reload instead of clobbering
                   edits made from the container side.

Usage:
    python3 scripts/md-editor-server.py --file /path/to/OKR.md \
        [--port 8899] [--dir scripts/md-editor]

Stdlib only; binds 127.0.0.1 (cf-tunnel's agent forwards to it).
"""

import argparse
import os
import posixpath
import sys
import tempfile
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MIME = {
    ".html": "text/html; charset=utf-8", ".css": "text/css",
    ".js": "text/javascript", ".json": "application/json",
    ".png": "image/png", ".svg": "image/svg+xml",
    ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "md-editor/1.0"
    content_dir = "."
    doc_path = ""

    def _send(self, code, body, ctype="text/plain; charset=utf-8", extra=None):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _version(self):
        try:
            return str(os.stat(self.doc_path).st_mtime_ns)
        except FileNotFoundError:
            return "0"

    def _read_doc(self):
        try:
            with open(self.doc_path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            return ""

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/doc":
            return self._send(200, self._read_doc(),
                              extra={"X-Doc-Version": self._version()})
        rel = posixpath.normpath(urllib.parse.unquote(path)).lstrip("/")
        if rel.startswith(".."):
            return self._send(404, "not found")
        full = os.path.join(self.content_dir, rel) if rel else self.content_dir
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            return self._send(404, "not found")
        ctype = MIME.get(os.path.splitext(full)[1], "application/octet-stream")
        with open(full, "rb") as f:
            return self._send(200, f.read(), ctype)

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        if path != "/doc":
            return self._send(404, "not found")
        length = int(self.headers.get("Content-Length") or 0)
        if length < 0 or length > 16 * 1024 * 1024:
            return self._send(400, "bad length")
        body = self.rfile.read(length)
        expected = self.headers.get("X-Doc-Version")
        current = self._version()
        if expected and expected != current:
            return self._send(409, self._read_doc(),
                              extra={"X-Doc-Version": current})
        d = os.path.dirname(os.path.abspath(self.doc_path)) or "."
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".md-editor-", dir=d)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(body)
            os.replace(tmp, self.doc_path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        print(f"SAVED {len(body)} bytes -> {self.doc_path}", flush=True)
        return self._send(200, "ok", extra={"X-Doc-Version": self._version()})

    def log_message(self, fmt, *args):
        msg = fmt % args
        if "/doc" in msg and "GET" in msg:
            return  # polling noise
        sys.stderr.write(f"{self.address_string()} {msg}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True, help="markdown file to edit")
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--dir", default=os.path.join(os.path.dirname(__file__), "md-editor"))
    a = ap.parse_args()
    Handler.doc_path = os.path.abspath(os.path.expanduser(a.file))
    Handler.content_dir = os.path.abspath(os.path.expanduser(a.dir))
    if not os.path.exists(Handler.doc_path):
        open(Handler.doc_path, "a").close()
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"md-editor: editing {Handler.doc_path}, serving {Handler.content_dir} "
          f"on http://127.0.0.1:{a.port}/", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
