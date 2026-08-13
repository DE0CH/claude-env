#!/usr/bin/env python3
"""Local content server for the cf-tunnel workflow (see tunnel.md).

Serves a directory of HTML/content AND accepts private data submissions
that land on local disk only — never in the chat transcript.

Usage:
    python3 scripts/content-server.py [--port 8899] [--dir ~/tunnel-share] \
        [--drop ~/drop] [--token SECRET]

Routes (all prefixed with /<token>/ when --token is set):
    GET  /            -> index of the content dir (or its index.html)
    GET  /<path>      -> static file from the content dir
    GET  /drop        -> HTML form (textarea + file upload)
    POST /drop        -> saves each field/file to the drop dir; prints ONLY
                         the saved filenames to stdout, never the contents

Stdlib only; no dependencies.
"""

import argparse
import datetime
import email.parser
import email.policy
import html
import os
import posixpath
import secrets as pysecrets
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FORM_PAGE = """<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>drop</title>
<style>
  body {{ font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }}
  textarea {{ width: 100%; height: 12rem; font-family: monospace; }}
  input, button {{ font-size: 1rem; margin: .5rem 0; }}
  button {{ padding: .5rem 1.5rem; }}
</style>
<h2>Private drop</h2>
<p>Anything submitted here is written to local disk on the runner and is
<strong>not</strong> shown in the chat transcript.</p>
<form method="post" action="{action}" enctype="multipart/form-data">
  <p><label>Label (optional): <input name="label" placeholder="e.g. api-key"></label></p>
  <p><textarea name="text" placeholder="Paste text/data here"></textarea></p>
  <p><input type="file" name="file" multiple></p>
  <p><button type="submit">Send</button></p>
</form>
"""


class Handler(BaseHTTPRequestHandler):
    server_version = "content-server/1.0"

    # set by main()
    content_dir = "."
    drop_dir = "."
    token = ""

    # ---- helpers ----------------------------------------------------------

    def _route(self):
        """Strip the token prefix; return the inner path or None if bad token."""
        path = urllib.parse.urlsplit(self.path).path
        if not self.token:
            return path
        prefix = "/" + self.token
        if path == prefix:
            return "/"
        if path.startswith(prefix + "/"):
            return path[len(prefix):]
        return None

    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _save(self, label, payload):
        ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        safe = "".join(c for c in (label or "unnamed") if c.isalnum() or c in "._-") or "unnamed"
        name = f"{ts}-{safe}-{pysecrets.token_hex(3)}"
        os.makedirs(self.drop_dir, exist_ok=True)
        dest = os.path.join(self.drop_dir, name)
        with open(dest, "wb") as f:
            f.write(payload)
        os.chmod(dest, 0o600)
        return dest

    # ---- static files ------------------------------------------------------

    def _serve_static(self, path):
        rel = posixpath.normpath(urllib.parse.unquote(path)).lstrip("/")
        if rel.startswith(".."):
            return self._send(404, "not found")
        full = os.path.join(self.content_dir, rel) if rel else self.content_dir
        if os.path.isdir(full):
            index = os.path.join(full, "index.html")
            if os.path.isfile(index):
                full = index
            else:
                entries = sorted(os.listdir(full))
                links = "".join(
                    f'<li><a href="{html.escape(posixpath.join(path, e))}">{html.escape(e)}</a></li>'
                    for e in entries
                )
                return self._send(200, f"<!doctype html><ul>{links}</ul>")
        if not os.path.isfile(full):
            return self._send(404, "not found")
        ctype = "text/html; charset=utf-8"
        for ext, t in {
            ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
            ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
            ".txt": "text/plain; charset=utf-8", ".pdf": "application/pdf",
        }.items():
            if full.endswith(ext):
                ctype = t
        with open(full, "rb") as f:
            return self._send(200, f.read(), ctype)

    # ---- HTTP methods ------------------------------------------------------

    def do_GET(self):
        path = self._route()
        if path is None:
            return self._send(404, "not found")
        if path == "/drop":
            action = (("/" + self.token) if self.token else "") + "/drop"
            return self._send(200, FORM_PAGE.format(action=action))
        return self._serve_static(path)

    def do_POST(self):
        path = self._route()
        if path != "/drop":
            return self._send(404, "not found")
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 512 * 1024 * 1024:
            return self._send(400, "bad length")
        body = self.rfile.read(length)
        ctype = self.headers.get("Content-Type", "")
        saved = []
        if ctype.startswith("multipart/form-data"):
            msg = email.parser.BytesParser(policy=email.policy.default).parsebytes(
                b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + body
            )
            label = ""
            parts = []
            for part in msg.iter_parts():
                name = part.get_param("name", header="content-disposition")
                payload = part.get_payload(decode=True) or b""
                if name == "label":
                    label = payload.decode(errors="replace").strip()
                elif name == "file" and part.get_filename():
                    parts.append((part.get_filename(), payload))
                elif name == "text" and payload.strip():
                    parts.append(("text", payload))
            for fname, payload in parts:
                saved.append(self._save(f"{label}-{fname}" if label else fname, payload))
        elif ctype.startswith("application/x-www-form-urlencoded"):
            fields = urllib.parse.parse_qs(body.decode(errors="replace"))
            label = (fields.get("label") or [""])[0]
            text = (fields.get("text") or [""])[0]
            if text:
                saved.append(self._save(label or "text", text.encode()))
        else:
            saved.append(self._save("raw", body))
        for dest in saved:
            print(f"DROP saved: {dest}", flush=True)
        return self._send(
            200,
            "<!doctype html><p>Saved "
            + (", ".join(html.escape(os.path.basename(s)) for s in saved) or "nothing")
            + ". You can close this tab.</p>",
        )

    def log_message(self, fmt, *args):
        # default access log, but never log query strings (may carry data)
        sys.stderr.write(
            "%s - %s\n" % (self.address_string(), fmt % args)
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--dir", default=os.path.expanduser("~/tunnel-share"))
    ap.add_argument("--drop", default=os.path.expanduser("~/drop"))
    ap.add_argument("--token", default="", help="require this path prefix on all URLs")
    args = ap.parse_args()

    os.makedirs(args.dir, exist_ok=True)
    os.makedirs(args.drop, exist_ok=True)
    Handler.content_dir = os.path.abspath(os.path.expanduser(args.dir))
    Handler.drop_dir = os.path.abspath(os.path.expanduser(args.drop))
    Handler.token = args.token.strip("/")

    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    base = f"http://127.0.0.1:{args.port}" + (("/" + Handler.token) if Handler.token else "")
    print(f"serving {Handler.content_dir} at {base}/", flush=True)
    print(f"drop form at {base}/drop -> saves into {Handler.drop_dir}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
