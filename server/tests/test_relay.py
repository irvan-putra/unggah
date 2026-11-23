"""Relay tests: no network. A stub upstream plays GitHub's token endpoint."""
import json
import os
import threading
import unittest
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ORIGIN = "https://vanipy.com"


class StubUpstream(BaseHTTPRequestHandler):
    last_form = None
    payload = {"access_token": "ghu_test", "token_type": "bearer", "expires_in": 28800,
               "refresh_token": "ghr_secret", "refresh_token_expires_in": 15897600, "scope": ""}
    status = 200

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0"))
        StubUpstream.last_form = self.rfile.read(n).decode()
        body = json.dumps(StubUpstream.payload).encode()
        self.send_response(StubUpstream.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def serve(handler):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d" % srv.server_address[1]


def post(url, obj, origin=ORIGIN, ctype="application/json", raw=None):
    data = raw if raw is not None else json.dumps(obj).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Content-Type": ctype, "Origin": origin, "X-Forwarded-For": "203.0.113.9"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read()), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read()), dict(e.headers)


class RelayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.up, cls.up_url = serve(StubUpstream)
        os.environ.update({
            "UNGGAH_GITHUB_CLIENT_ID": "Iv1.testclient",
            "UNGGAH_GITHUB_CLIENT_SECRET": "testsecret",
            "UNGGAH_TOKEN_URL": cls.up_url + "/token",
            "UNGGAH_RATE_PER_MIN": "4",
            "UNGGAH_GLOBAL_RATE_PER_MIN": "1000",
        })
        import importlib
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
        import main
        importlib.reload(main)
        cls.main = main
        cls.srv, cls.base = serve(main.Handler)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.up.shutdown()

    def setUp(self):
        with self.main._lock:
            self.main._hits.clear()
            self.main._global_hits.clear()
        StubUpstream.status = 200

    def token_post(self, **kw):
        body = {"code": "abc123", "code_verifier": "v" * 50,
                "redirect_uri": "https://vanipy.com/unggah/"}
        body.update(kw)
        return post(self.base + "/oauth/token", body)

    def test_healthz(self):
        with urllib.request.urlopen(self.base + "/healthz", timeout=5) as r:
            self.assertEqual(json.loads(r.read()), {"ok": True})

    def test_happy_path_strips_refresh_token(self):
        status, out, hdrs = self.token_post()
        self.assertEqual(status, 200)
        self.assertEqual(out["access_token"], "ghu_test")
        self.assertNotIn("refresh_token", out)
        self.assertNotIn("refresh_token_expires_in", out)
        self.assertEqual(hdrs.get("Access-Control-Allow-Origin"), ORIGIN)
        self.assertEqual(hdrs.get("Cache-Control"), "no-store")
        self.assertIn("testsecret", StubUpstream.last_form)  # secret only upstream
        self.assertIn("code_verifier=" + "v" * 50, StubUpstream.last_form)

    def test_bad_origin_rejected(self):
        status, _, _ = self.token_post()
        self.assertEqual(status, 200)
        status, out, hdrs = post(self.base + "/oauth/token",
                                 {"code": "x", "code_verifier": "v" * 50,
                                  "redirect_uri": "https://vanipy.com/unggah/"},
                                 origin="https://evil.example")
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", hdrs)

    def test_bad_fields_rejected(self):
        cases = [dict(code=""), dict(code_verifier="short"),
                 dict(code_verifier="v" * 50 + "!"),
                 dict(redirect_uri="https://evil.example/"),
                 dict(code="abc", redirect_uri="https://vanipy.com/other/")]
        for kw in cases:
            self.setUp()  # field validation must not depend on rate-limit budget
            self.assertEqual(self.token_post(**kw)[0], 400, kw)

    def test_non_json_and_size(self):
        status, _, _ = post(self.base + "/oauth/token", {}, ctype="text/plain")
        self.assertEqual(status, 415)
        status, _, _ = post(self.base + "/oauth/token", {}, raw=b"x" * 9000)
        self.assertEqual(status, 413)

    def test_rate_limit(self):
        for _ in range(4):
            self.assertEqual(self.token_post()[0], 200)
        self.assertEqual(self.token_post()[0], 429)

    def test_upstream_failure_maps_502(self):
        StubUpstream.status = 500
        StubUpstream.payload = {"error": "boom"}
        status, out, _ = self.token_post()
        self.assertEqual(status, 502)
        self.assertNotIn("refresh_token", out)

    def test_unknown_route_404(self):
        status, _, _ = post(self.base + "/admin", {})
        self.assertEqual(status, 404)

    def test_unconfigured_503(self):
        cid, sec = self.main.CLIENT_ID, self.main.CLIENT_SECRET
        self.main.CLIENT_ID, self.main.CLIENT_SECRET = "", ""
        try:
            self.assertEqual(self.token_post()[0], 503)
        finally:
            self.main.CLIENT_ID, self.main.CLIENT_SECRET = cid, sec


if __name__ == "__main__":
    unittest.main()
