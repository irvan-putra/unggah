// Worker tests: import the Worker module and drive its fetch handler with
// synthetic Requests against a loopback stub of GitHub's token endpoint.
// No Cloudflare account, no wrangler, no network beyond loopback.
// Run: node worker-tests/run.mjs
import http from "node:http";

const ORIGIN = "https://vanipy.com";

const stub = { lastForm: null, payload: { access_token: "ghu_test", token_type: "bearer", expires_in: 28800, refresh_token: "ghr_secret", refresh_token_expires_in: 15897600, scope: "" }, status: 200 };
const server = http.createServer(async (req, res) => {
  const parts = [];
  for await (const c of req) parts.push(c);
  stub.lastForm = Buffer.concat(parts).toString();
  res.writeHead(stub.status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(stub.payload));
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const { default: worker } = await import("../worker/src/worker.js");
const env = {
  UNGGAH_GITHUB_CLIENT_ID: "Iv1.testclient",
  UNGGAH_GITHUB_CLIENT_SECRET: "testsecret",
  UNGGAH_TOKEN_URL: base + "/token",
  UNGGAH_RATE_PER_MIN: "4",
  UNGGAH_GLOBAL_RATE_PER_MIN: "1000",
};

let failures = 0;
const t = async (name, fn) => { try { await fn(); console.log("ok - " + name); } catch (e) { failures++; console.log("FAIL - " + name + ": " + e.message); } };
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

function tokenReq(body, opts = {}) {
  return new Request("https://worker.test/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: opts.origin ?? ORIGIN, "CF-Connecting-IP": "203.0.113.9", ...(opts.headers || {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const goodBody = { code: "abc123", code_verifier: "v".repeat(50), redirect_uri: "https://vanipy.com/unggah/" };
// Fresh IP per call when the limiter must not interfere.
const call = (body, opts = {}) => worker.fetch(tokenReq(body, { ...opts, headers: { "CF-Connecting-IP": opts.ip || "198.51.100." + Math.floor(Math.random() * 250) } }), env);

await t("healthz", async () => {
  const r = await worker.fetch(new Request("https://worker.test/healthz"), env);
  eq(r.status, 200); eq((await r.json()).ok, true);
});

await t("happy path strips the refresh token, sets CORS + no-store", async () => {
  const r = await call(goodBody);
  eq(r.status, 200, "status");
  const j = await r.json();
  eq(j.access_token, "ghu_test");
  eq("refresh_token" in j, false, "refresh_token stripped");
  eq("refresh_token_expires_in" in j, false, "refresh expiry stripped");
  eq(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  eq(r.headers.get("Cache-Control"), "no-store");
  eq(stub.lastForm.includes("client_secret=testsecret"), true, "secret only upstream");
  eq(stub.lastForm.includes("code_verifier=" + "v".repeat(50)), true, "verifier upstream");
});

await t("bad origin rejected, no CORS header", async () => {
  const r = await call(goodBody, { origin: "https://evil.example" });
  eq(r.status, 403);
  eq(r.headers.get("Access-Control-Allow-Origin"), null);
});

await t("bad fields rejected", async () => {
  for (const [k, v] of [["code", ""], ["code_verifier", "short"], ["code_verifier", "v".repeat(50) + "!"], ["redirect_uri", "https://evil.example/"], ["redirect_uri", "https://vanipy.com/other/"]]) {
    const r = await call({ ...goodBody, [k]: v });
    eq(r.status, 400, k);
  }
});

await t("non-JSON and oversize rejected", async () => {
  const r1 = await worker.fetch(new Request("https://worker.test/oauth/token", { method: "POST", headers: { "Content-Type": "text/plain", Origin: ORIGIN, "CF-Connecting-IP": "198.51.100.251" }, body: "{}" }), env);
  eq(r1.status, 415);
  const r2 = await call("x".repeat(9000));
  eq(r2.status, 413);
});

await t("rate limit: 5th request in a minute from one IP gets 429", async () => {
  for (let i = 0; i < 4; i++) eq((await call(goodBody, { ip: "203.0.113.77" })).status, 200, "request " + i);
  eq((await call(goodBody, { ip: "203.0.113.77" })).status, 429);
});

await t("upstream failure maps to 502", async () => {
  stub.status = 500; stub.payload = { error: "boom" };
  const r = await call(goodBody);
  eq(r.status, 502);
  const j = await r.json();
  eq("refresh_token" in j, false);
  stub.status = 200; stub.payload = { access_token: "ghu_test", token_type: "bearer", refresh_token: "ghr_x" };
});

await t("unknown route 404, OPTIONS preflight only for allowed origin", async () => {
  eq((await call(goodBody, {})).status, 200);
  eq((await worker.fetch(new Request("https://worker.test/admin", { method: "POST" }), env)).status, 404);
  const ok = await worker.fetch(new Request("https://worker.test/oauth/token", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env);
  eq(ok.status, 204); eq(ok.headers.get("Access-Control-Allow-Methods"), "POST");
  const bad = await worker.fetch(new Request("https://worker.test/oauth/token", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env);
  eq(bad.status, 404);
});

await t("unconfigured relay answers 503", async () => {
  const r = await worker.fetch(tokenReq(goodBody), { ...env, UNGGAH_GITHUB_CLIENT_SECRET: "" });
  eq(r.status, 503);
});

server.close();
console.log(failures ? `\n${failures} FAILURES` : "\nAll worker tests passed.");
process.exit(failures ? 1 : 0);
