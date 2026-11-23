// Unggah OAuth relay as a Cloudflare Worker: same contract as server/app/main.py.
// Stateless, no storage, no logging of credential material.
//
// Routes:
//   GET  /healthz      -> {"ok": true}
//   POST /oauth/token  -> {code, code_verifier, redirect_uri} exchanged at GitHub
//                         with the client secret; refresh token stripped from the
//                         answer (browser keeps tokens in memory only by design).
//
// Config: UNGGAH_GITHUB_CLIENT_ID (var), UNGGAH_GITHUB_CLIENT_SECRET (secret),
// optional vars UNGGAH_ALLOWED_ORIGINS / UNGGAH_ALLOWED_REDIRECT_URIS
// (comma-separated), UNGGAH_RATE_PER_MIN, UNGGAH_TOKEN_URL (tests only).

const MAX_BODY = 8192;
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CODE_RE = /^[A-Za-z0-9_\-]{1,100}$/;

// Best-effort rate limiting: this Map is per isolate, and Cloudflare runs many
// isolates, so it throttles casual abuse, not a determined flood. The Python
// relay's limiter is exact; here it is a circuit breaker, documented as such.
const hits = new Map();
const globalHits = [];

function rateOk(key, limit, globalLimit) {
  const now = Date.now();
  const prune = arr => {
    let i = 0;
    while (i < arr.length && now - arr[i] >= 60000) i++;
    arr.splice(0, i);
  };
  const lst = hits.get(key) || [];
  prune(lst);
  prune(globalHits);
  if (lst.length >= limit || globalHits.length >= globalLimit) return false;
  lst.push(now);
  globalHits.push(now);
  hits.set(key, lst);
  if (hits.size > 10000) hits.clear();
  return true;
}

function json(status, obj, origin) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return new Response(JSON.stringify(obj), { status, headers });
}

function cfg(env) {
  const split = s => (s || "").split(",").map(x => x.trim()).filter(Boolean);
  return {
    clientId: env.UNGGAH_GITHUB_CLIENT_ID || "",
    clientSecret: env.UNGGAH_GITHUB_CLIENT_SECRET || "",
    tokenUrl: env.UNGGAH_TOKEN_URL || "https://github.com/login/oauth/access_token",
    origins: split(env.UNGGAH_ALLOWED_ORIGINS).length ? split(env.UNGGAH_ALLOWED_ORIGINS) : ["https://vanipy.com"],
    redirects: split(env.UNGGAH_ALLOWED_REDIRECT_URIS).length ? split(env.UNGGAH_ALLOWED_REDIRECT_URIS) : ["https://vanipy.com/unggah/"],
    ratePerMin: parseInt(env.UNGGAH_RATE_PER_MIN || "10", 10),
    globalRatePerMin: parseInt(env.UNGGAH_GLOBAL_RATE_PER_MIN || "60", 10),
  };
}

export default {
  async fetch(request, env) {
    const c = cfg(env);
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const okOrigin = c.origins.includes(origin) ? origin : null;

    if (request.method === "GET" && url.pathname === "/healthz") {
      return json(200, { ok: true });
    }
    if (request.method === "OPTIONS" && url.pathname === "/oauth/token" && okOrigin) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": okOrigin,
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "600",
          "Vary": "Origin",
        },
      });
    }
    if (request.method !== "POST" || url.pathname !== "/oauth/token") {
      return json(404, { error: "not found" });
    }
    if (!okOrigin) return json(403, { error: "origin not allowed" });
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!rateOk(ip, c.ratePerMin, c.globalRatePerMin)) return json(429, { error: "rate limited" }, okOrigin);
    if (!c.clientId || !c.clientSecret) return json(503, { error: "relay is not configured yet" }, okOrigin);
    if ((request.headers.get("Content-Type") || "").split(";")[0].trim() !== "application/json") {
      return json(415, { error: "expected application/json" }, okOrigin);
    }
    const raw = await request.text();
    if (!raw || raw.length > MAX_BODY) return json(413, { error: "bad body size" }, okOrigin);
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json(400, { error: "invalid JSON" }, okOrigin);
    }
    if (
      !payload || typeof payload !== "object" ||
      typeof payload.code !== "string" || !CODE_RE.test(payload.code) ||
      typeof payload.code_verifier !== "string" || !VERIFIER_RE.test(payload.code_verifier) ||
      !c.redirects.includes(payload.redirect_uri)
    ) {
      return json(400, { error: "invalid request fields" }, okOrigin);
    }
    const form = new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      code: payload.code,
      redirect_uri: payload.redirect_uri,
      code_verifier: payload.code_verifier,
    });
    let out, upstream;
    try {
      upstream = await fetch(c.tokenUrl, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      out = await upstream.json();
    } catch {
      return json(502, { error: "upstream unreachable" }, okOrigin);
    }
    if (out && typeof out === "object") {
      delete out.refresh_token;
      delete out.refresh_token_expires_in;
    }
    return json(upstream.ok ? 200 : 502, out, okOrigin);
  },
};
