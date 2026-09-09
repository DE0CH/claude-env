#!/usr/bin/env python3
"""Tiny stateless command executor. Runs inside the workspace container,
binds 127.0.0.1:8080 (Caddy on the host fronts it with TLS + X-API-Key).

POST /exec
  - body is JSON  {"cmd": "...", "cwd": "/root/work", "timeout": 600}  (Content-Type: application/json)
  - or body is the raw shell script (any other Content-Type)
  -> 200 {"exit": int, "stdout": str, "stderr": str}
GET /health -> {"ok": true, "host": "<hostname>"}
"""
import json
import os
import socket
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WORK = os.environ.get("EXEC_WORKDIR", "/root/work")
DEFAULT_TIMEOUT = 900


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            return self._send(200, {"ok": True, "host": socket.gethostname()})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/exec":
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(n) if n else b""
        body = raw.decode("utf-8", "replace")
        cmd, cwd, timeout = body, WORK, DEFAULT_TIMEOUT
        if self.headers.get("Content-Type", "").startswith("application/json"):
            try:
                d = json.loads(body or "{}")
            except Exception as e:
                return self._send(400, {"error": f"bad json: {e}"})
            cmd = d.get("cmd", "")
            cwd = d.get("cwd") or WORK
            timeout = int(d.get("timeout", DEFAULT_TIMEOUT))
        if not cmd.strip():
            return self._send(400, {"error": "empty command"})
        try:
            os.makedirs(cwd, exist_ok=True)
        except Exception:
            cwd = WORK
        try:
            p = subprocess.run(
                ["bash", "-lc", cmd], cwd=cwd,
                capture_output=True, timeout=timeout,
            )
            return self._send(200, {
                "exit": p.returncode,
                "stdout": p.stdout.decode("utf-8", "replace"),
                "stderr": p.stderr.decode("utf-8", "replace"),
            })
        except subprocess.TimeoutExpired as e:
            return self._send(200, {
                "exit": 124,
                "stdout": (e.stdout or b"").decode("utf-8", "replace"),
                "stderr": (e.stderr or b"").decode("utf-8", "replace") + f"\n[timed out after {timeout}s]",
            })

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8080), Handler).serve_forever()
