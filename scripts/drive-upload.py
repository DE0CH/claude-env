#!/usr/bin/env python3
"""Byte-faithful Google Drive uploads for /Claude Records (no MCP connector, no base64).

Python 3 stdlib only. Uploads go through the Drive v3 resumable-upload API using an
OAuth refresh token, so any file (binary included, any size) uploads without passing
through the agent's context window.

Required env vars (in the environment config / ~/.secrets):
    GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN

One-time setup (run on the mac, not in a container):
    1. Google Cloud console -> create/reuse a project -> enable "Google Drive API"
       -> Credentials -> Create OAuth client ID -> type "Desktop app".
       (If the consent screen is in "Testing" mode, add your own Google account as a
       test user; refresh tokens for test users expire after 7 days unless the app
       is published, so set Publishing status to "In production".)
    2. python3 scripts/drive-upload.py auth --client-id ... --client-secret ...
       -> opens a browser consent URL, catches the redirect on localhost, prints the
       refresh token. Add all three values to the env config and ~/.secrets.

Usage:
    drive-upload.py FILE [FILE...] [--subfolder "yyyy-mm-dd <session title>"]
                    [--folder-id ID] [--name NAME]
    drive-upload.py auth --client-id ID --client-secret SECRET [--port 8765]

Default --folder-id is the "Claude Records" folder. --subfolder finds-or-creates a
child folder of it and uploads there. --name renames a single uploaded file.
"""

import argparse
import json
import mimetypes
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CLAUDE_RECORDS_FOLDER_ID = "1lwmr6JE_51udrvKdFpHlSi090O54VWdx"
TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
API = "https://www.googleapis.com/drive/v3"
UPLOAD_API = "https://www.googleapis.com/upload/drive/v3"
SCOPE = "https://www.googleapis.com/auth/drive"


def ssl_context():
    # In Anthropic containers outbound TLS is MITM'd; trust the injected CA bundle.
    for var in ("SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"):
        path = os.environ.get(var)
        if path and os.path.exists(path):
            return ssl.create_default_context(cafile=path)
    if os.path.exists("/root/.ccr/ca-bundle.crt"):
        return ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")
    return ssl.create_default_context()


def http(url, data=None, headers=None, method=None, raw=False):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, context=ssl_context()) as resp:
        body = resp.read()
        return resp, body if raw else (json.loads(body) if body else {})


def access_token():
    cid = os.environ.get("GDRIVE_CLIENT_ID")
    secret = os.environ.get("GDRIVE_CLIENT_SECRET")
    refresh = os.environ.get("GDRIVE_REFRESH_TOKEN")
    if not (cid and secret and refresh):
        sys.exit("GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET / GDRIVE_REFRESH_TOKEN not set "
                 "— see the setup instructions at the top of this script.")
    data = urllib.parse.urlencode({
        "client_id": cid, "client_secret": secret,
        "refresh_token": refresh, "grant_type": "refresh_token",
    }).encode()
    _, tok = http(TOKEN_URL, data=data,
                  headers={"Content-Type": "application/x-www-form-urlencoded"})
    return tok["access_token"]


def api_get(token, path, params):
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    _, body = http(url, headers={"Authorization": f"Bearer {token}"})
    return body


def api_post(token, path, obj):
    _, body = http(f"{API}{path}", data=json.dumps(obj).encode(),
                   headers={"Authorization": f"Bearer {token}",
                            "Content-Type": "application/json"})
    return body


def find_or_create_subfolder(token, parent_id, name):
    safe = name.replace("\\", "\\\\").replace("'", "\\'")
    q = (f"name = '{safe}' and '{parent_id}' in parents and "
         "mimeType = 'application/vnd.google-apps.folder' and trashed = false")
    hits = api_get(token, "/files", {"q": q, "fields": "files(id,name)"}).get("files", [])
    if hits:
        return hits[0]["id"]
    made = api_post(token, "/files", {
        "name": name, "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id]})
    return made["id"]


def upload_file(token, path, parent_id, name=None):
    name = name or os.path.basename(path)
    size = os.path.getsize(path)
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    meta = json.dumps({"name": name, "parents": [parent_id]}).encode()
    resp, _ = http(f"{UPLOAD_API}/files?uploadType=resumable", data=meta, raw=True,
                   headers={"Authorization": f"Bearer {token}",
                            "Content-Type": "application/json; charset=UTF-8",
                            "X-Upload-Content-Type": mime,
                            "X-Upload-Content-Length": str(size)})
    session_url = resp.headers["Location"]
    with open(path, "rb") as f:
        payload = f.read()
    for attempt in range(5):
        try:
            _, out = http(session_url, data=payload, method="PUT",
                          headers={"Content-Type": mime, "Content-Length": str(size)})
            return out
        except urllib.error.HTTPError as e:
            if e.code in (500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** attempt)
                continue
            raise


def cmd_auth(args):
    import http.server

    redirect = f"http://localhost:{args.port}"
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": args.client_id, "redirect_uri": redirect,
        "response_type": "code", "scope": SCOPE,
        "access_type": "offline", "prompt": "consent"})
    print(f"Open this URL in a browser (same machine):\n\n{url}\n")
    code_holder = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            code_holder["code"] = qs.get("code", [None])[0]
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"Done - return to the terminal.")

        def log_message(self, *a):
            pass

    with http.server.HTTPServer(("localhost", args.port), Handler) as srv:
        while "code" not in code_holder:
            srv.handle_request()
    if not code_holder["code"]:
        sys.exit("No auth code received.")
    data = urllib.parse.urlencode({
        "client_id": args.client_id, "client_secret": args.client_secret,
        "code": code_holder["code"], "grant_type": "authorization_code",
        "redirect_uri": redirect}).encode()
    _, tok = http(TOKEN_URL, data=data,
                  headers={"Content-Type": "application/x-www-form-urlencoded"})
    print("Add these to the environment config and ~/.secrets:\n")
    print(f"GDRIVE_CLIENT_ID={args.client_id}")
    print(f"GDRIVE_CLIENT_SECRET={args.client_secret}")
    print(f"GDRIVE_REFRESH_TOKEN={tok['refresh_token']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")
    auth = sub.add_parser("auth", help="one-time OAuth flow; prints the refresh token")
    auth.add_argument("--client-id", required=True)
    auth.add_argument("--client-secret", required=True)
    auth.add_argument("--port", type=int, default=8765)

    ap.add_argument("files", nargs="*", help="files to upload")
    ap.add_argument("--folder-id", default=CLAUDE_RECORDS_FOLDER_ID)
    ap.add_argument("--subfolder", help="find-or-create this child folder and upload there")
    ap.add_argument("--name", help="uploaded name (single file only)")
    args = ap.parse_args()

    if args.cmd == "auth":
        cmd_auth(args)
        return
    if not args.files:
        ap.error("no files given")
    if args.name and len(args.files) > 1:
        ap.error("--name only works with a single file")

    token = access_token()
    parent = args.folder_id
    if args.subfolder:
        parent = find_or_create_subfolder(token, parent, args.subfolder)
        print(f"subfolder: {args.subfolder} ({parent})")
    for path in args.files:
        out = upload_file(token, path, parent, args.name)
        print(f"uploaded: {path} -> {out.get('name')} (id {out.get('id')})")


if __name__ == "__main__":
    main()
