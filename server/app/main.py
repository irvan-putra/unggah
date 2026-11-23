#!/usr/bin/env python3
"""Unggah OAuth relay: stateless exchange of a GitHub web-flow code for a user token.

Holds the GitHub App client secret so the static site never ships it. The browser
does everything else itself (ZIP unpack, diff, Git Data API calls go straight to
api.github.com). This service exposes exactly two routes:

  GET  /healthz       liveness, no details
  POST /oauth/token   {code, code_verifier, redirect_uri} -> GitHub's token JSON,
                      minus the refresh token (the browser keeps tokens in memory
                      only and discards them on reload/expiry by design)

Standard library only. No database, no disk, no logging of credential material.
"""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 8192
RATE_PER_MIN = int(os.environ.get("UNGGAH_RATE_PER_MIN", "10"))
GLOBAL_RATE_PER_MIN = int(os.environ.get("UNGGAH_GLOBAL_RATE_PER_MIN", "60"))
UPSTREAM_TIMEOUT = 10

CLIENT_ID = os.environ.get("UNGGAH_GITHUB_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("UNGGAH_GITHUB_CLIENT_SECRET", "")
TOKEN_URL = os.environ.get("UNGGAH_TOKEN_URL", "https://github.com/login/oauth/access_token")
ALLOWED_ORIGINS = {
    o.strip()
    for o in os.environ.get("UNGGAH_ALLOWED_ORIGINS", "https://vanipy.com").split(",")
    if o.strip()
}
ALLOWED_REDIRECT_URIS = {
    u.strip()
    for u in os.environ.get(
        "UNGGAH_ALLOWED_REDIRECT_URIS", "https://vanipy.com/unggah/"
    ).split(",")
    if u.strip()
}

_VERIFIER_RE = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")
_CODE_RE = re.compile(r"^[A-Za-z0-9_\-]{1,100}$")

_lock = threading.Lock()
_hits = {}  # key -> list of timestamps (pruned on use)
_global_hits = []


def _rate_ok(key, limit):
    now = time.monotonic()
    with _lock:
        lst = _hits.setdefault(key, [])
        lst[:] = [t for t in lst if now - t < 60]
        _global_hits[:] = [t for t in _global_hits if now - t < 60]
        if len(_global_hits) >= GLOBAL_RATE_PER_MIN or len(lst) >= limit:
            return False
        lst.append(now)
        _global_hits.append(now)
        if len(_hits) > 10000:  # bound memory on junk traffic
            _hits.clear()
        return True


class Handler(BaseHTTPRequestHandler):
    server_version = "unggah-relay"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # route + status only, never bodies
        pass

    def _client_key(self):
        xff = self.headers.get("X-Forwarded-For", "")
        return (xff.split(",")[0].strip() or self.client_address[0])

    def _origin(self):
        return self.headers.get("Origin", "")

    def _send(self, status, obj, origin=None):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def _cors_ok(self):
        origin = self._origin()
        return origin if origin in ALLOWED_ORIGINS else None

    def do_OPTIONS(self):
        origin = self._cors_ok()
        if self.path == "/oauth/token" and origin:
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Vary", "Origin")
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self._send(403, {"error": "forbidden"})

    def do_GET(self):
        if self.path == "/healthz":
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/oauth/token":
            self._send(404, {"error": "not found"})
            return
        origin = self._cors_ok()
        if not origin:
            self._send(403, {"error": "origin not allowed"})
            return
        if not _rate_ok(self._client_key(), RATE_PER_MIN):
            self._send(429, {"error": "rate limited"}, origin)
            return
        if not CLIENT_ID or not CLIENT_SECRET:
            self._send(503, {"error": "relay is not configured yet"}, origin)
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            self._send(415, {"error": "expected application/json"}, origin)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self._send(413, {"error": "bad body size"}, origin)
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            self._send(400, {"error": "invalid JSON"}, origin)
            return
        if not isinstance(payload, dict):
            self._send(400, {"error": "invalid JSON"}, origin)
            return
        code = payload.get("code")
        verifier = payload.get("code_verifier")
        redirect_uri = payload.get("redirect_uri")
        if (
            not isinstance(code, str)
            or not _CODE_RE.match(code)
            or not isinstance(verifier, str)
            or not _VERIFIER_RE.match(verifier)
            or redirect_uri not in ALLOWED_REDIRECT_URIS
        ):
            self._send(400, {"error": "invalid request fields"}, origin)
            return
        form = (
            "client_id=%s&client_secret=%s&code=%s&redirect_uri=%s&code_verifier=%s"
            % (
                urllib.parse.quote(CLIENT_ID, safe=""),
                urllib.parse.quote(CLIENT_SECRET, safe=""),
                urllib.parse.quote(code, safe=""),
                urllib.parse.quote(redirect_uri, safe=""),
                urllib.parse.quote(verifier, safe=""),
            )
        ).encode()
        req = urllib.request.Request(
            TOKEN_URL,
            data=form,
            headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as resp:
                out = json.loads(resp.read(MAX_BODY))
        except urllib.error.HTTPError as e:
            try:
                out = json.loads(e.read(MAX_BODY))
            except Exception:
                out = {"error": "upstream_error"}
            self._send(502, _sanitize(out), origin)
            return
        except Exception:
            self._send(502, {"error": "upstream unreachable"}, origin)
            return
        self._send(200, _sanitize(out), origin)


def _sanitize(out):
    """Pass GitHub's answer through, minus any long-lived credential."""
    if isinstance(out, dict):
        out.pop("refresh_token", None)
        out.pop("refresh_token_expires_in", None)
    return out


def main():
    port = int(os.environ.get("PORT", "8080"))
    if not CLIENT_ID or not CLIENT_SECRET:
        print("WARNING: UNGGAH_GITHUB_CLIENT_ID / UNGGAH_GITHUB_CLIENT_SECRET not set; /oauth/token will 503")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
