// Site logic tests against a loopback mock of GitHub + the relay. No network.
// Run: node site-tests/run.mjs
import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// Browser shims the site scripts expect.
const store = new Map();
globalThis.window = globalThis;
globalThis.sessionStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
for (const f of ["zip.js", "git.js"]) eval(readFileSync(join(here, "..", "site", f), "utf8"));
const G = window.UnggahGit, Z = window.UnggahZip;

const blobSha1 = data => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data])).digest("hex");
const oldData = Buffer.from("old content\n");
const state = { blobs: [], tree: null, commit: null, refUpdated: null, relayBody: null };

async function readBody(req) { const parts = []; for await (const c of req) parts.push(c); return Buffer.concat(parts); }
const server = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  const u = new URL(req.url, "http://x");
  if (req.method === "POST" && u.pathname === "/oauth/token") {
    state.relayBody = JSON.parse(body.toString() || "{}");
    if (state.relayBody.code === "badcode") return json(200, { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." });
    return json(200, { access_token: "ghu_mock", token_type: "bearer", expires_in: 28800 });
  }
  if (req.headers.authorization !== "Bearer ghu_mock" && req.headers.authorization !== "Bearer testtok") return json(401, { message: "Bad credentials" });
  if (u.pathname === "/user") return json(200, { login: "octotest" });
  if (u.pathname === "/repos/o/r/git/ref/heads/main") return json(200, { object: { sha: "c1" } });
  if (u.pathname === "/repos/o/r/git/commits/c1") return json(200, { tree: { sha: "t1" } });
  if (u.pathname === "/repos/o/r/git/trees/t1") return json(200, { tree: [{ path: "old.txt", mode: "100644", type: "blob", sha: blobSha1(oldData) }] });
  if (req.method === "POST" && u.pathname === "/repos/o/r/git/blobs") {
    const b = JSON.parse(body.toString()); const data = Buffer.from(b.content, "base64");
    const sha = blobSha1(data); state.blobs.push(sha); return json(201, { sha });
  }
  if (req.method === "POST" && u.pathname === "/repos/o/r/git/trees") { state.tree = JSON.parse(body.toString()); return json(201, { sha: "t2" }); }
  if (req.method === "POST" && u.pathname === "/repos/o/r/git/commits") { state.commit = JSON.parse(body.toString()); return json(201, { sha: "c2" }); }
  if (req.method === "PATCH" && u.pathname === "/repos/o/r/git/refs/heads/main") { state.refUpdated = JSON.parse(body.toString()); return json(200, {}); }
  json(404, { message: "Not Found: " + req.method + " " + u.pathname });
});

await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const t = async (name, fn) => { try { await fn(); console.log("ok - " + name); } catch (e) { failures++; console.log("FAIL - " + name + ": " + e.message); } };
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

// Build a stored (uncompressed) zip in memory: hello.txt + sub/exec.sh (exec bit).
function buildZip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.path), data = f.data;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); // version needed
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); // csize, usize (method 0 = stored)
    lh.setUint16(26, name.length, true);
    central.push({ name, data, off, mode: f.exec ? 0o100755 : 0o100644 });
    parts.push(Buffer.from(lh.buffer), Buffer.from(name), Buffer.from(data)); off += 30 + name.length + data.length;
  }
  let cdSize = 0; const cds = [];
  for (const c of central) {
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint32(20, c.data.length, true); ch.setUint32(24, c.data.length, true); // csize, usize
    ch.setUint16(28, c.name.length, true);
    ch.setUint32(38, (c.mode << 16) >>> 0, true); ch.setUint32(42, c.off, true);
    cds.push(Buffer.from(ch.buffer), Buffer.from(c.name)); cdSize += 46 + c.name.length;
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, central.length, true); eocd.setUint16(10, central.length, true);
  eocd.setUint32(12, cdSize, true); eocd.setUint32(16, off, true);
  return Buffer.concat([...parts, ...cds, Buffer.from(eocd.buffer)]);
}

const cfg = { API: base, CLIENT_ID: "Iv1.test", RELAY: base, REAL_WRITES: true };

await t("zip: parses stored entries, exec bit, top folder strip", async () => {
  const buf = buildZip([
    { path: "pkg/hello.txt", data: new TextEncoder().encode("hi\n") },
    { path: "pkg/sub/run.sh", data: new TextEncoder().encode("#!/bin/sh\n"), exec: true },
  ]);
  const files = await Z.readZip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  eq(files.length, 2, "file count"); eq(files.stripped, "pkg", "stripped");
  eq(files[0].path, "hello.txt"); eq(files[1].exec, true, "exec bit");
});

await t("sign-in: start URL has state + S256 challenge, finish returns token once", async () => {
  const url = await G.signInStart(cfg, "http://127.0.0.1/cb");
  const q = new URL(url).searchParams;
  eq(url.startsWith("https://github.com/login/oauth/authorize?"), true, "authorize host");
  eq(q.get("client_id"), "Iv1.test"); eq(q.get("code_challenge_method"), "S256");
  eq((q.get("code_challenge") || "").length, 43, "challenge length");
  eq(q.get("redirect_uri"), "http://127.0.0.1/cb");
  let threw = false;
  try { await G.signInFinish(cfg, new URLSearchParams("code=abc&state=wrong")); } catch { threw = true; }
  eq(threw, true, "wrong state rejected");
  const url2 = await G.signInStart(cfg, "http://127.0.0.1/cb");
  const st2 = new URL(url2).searchParams.get("state");
  const got = await G.signInFinish(cfg, new URLSearchParams(`code=abc&state=${st2}`));
  eq(got.token, "ghu_mock"); eq(got.expiresIn, 28800);
  eq(typeof state.relayBody.code_verifier, "string", "verifier sent to relay"); // 'state' here is the mock's shared object, not shadowed in this test
  threw = false;
  try { await G.signInFinish(cfg, new URLSearchParams(`code=abc&state=${st2}`)); } catch { threw = true; }
  eq(threw, true, "state is single-use");
});

await t("sign-in: relay error surfaces cleanly", async () => {
  const url = await G.signInStart(cfg, "http://127.0.0.1/cb");
  const st = new URL(url).searchParams.get("state");
  let msg = "";
  try { await G.signInFinish(cfg, new URLSearchParams(`code=badcode&state=${st}`)); } catch (e) { msg = e.message; }
  eq(msg.includes("incorrect or expired"), true, "error passthrough");
});

await t("compare + commit end to end against mock API", async () => {
  const gh = new G.GH(base, "ghu_mock");
  const files = await Z.readZip((b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))(buildZip([
    { path: "hello.txt", data: new TextEncoder().encode("hi\n") },
    { path: "old.txt", data: new TextEncoder().encode("new content\n") },
  ])));
  const snap = await gh.snapshot("o", "r", "main");
  const pl = await G.plan(snap, files, false);
  eq(pl.add.length, 1, "one add"); eq(pl.modify.length, 1, "one modify"); eq(pl.remove.length, 0, "no removes");
  const sha = await G.commitPlan(gh, cfg, "o", "r", "main", snap, pl, "test commit");
  eq(sha, "c2"); eq(state.refUpdated.force, false, "no force push");
  eq(state.commit.parents[0], "c1", "parent"); eq(state.tree.base_tree, "t1", "base tree");
  eq(state.blobs.length, 2, "two blobs uploaded");
  const paths = state.tree.tree.map(e => e.path).sort();
  eq(JSON.stringify(paths), JSON.stringify(["hello.txt", "old.txt"]), "tree paths");
});

await t("removals require explicit entries and carry sha null", async () => {
  const gh = new G.GH(base, "ghu_mock");
  const files = await Z.readZip((b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))(buildZip([
    { path: "hello.txt", data: new TextEncoder().encode("hi\n") },
  ])));
  const snap = await gh.snapshot("o", "r", "main");
  const pl = await G.plan(snap, files, true);
  eq(pl.remove.length, 1, "old.txt marked removed");
  await G.commitPlan(gh, cfg, "o", "r", "main", snap, pl, "rm");
  const rm = state.tree.tree.find(e => e.path === "old.txt");
  eq(rm.sha, null, "removal entry has null sha");
});

await t("real writes stay blocked off-loopback when REAL_WRITES is false", async () => {
  const gh = new G.GH("https://api.github.com", "x");
  let msg = "";
  try { await G.commitPlan(gh, { REAL_WRITES: false }, "o", "r", "main", { commitSha: "c", treeSha: "t" }, { add: [{ path: "a", data: new Uint8Array([1]) }], modify: [], remove: [] }, "m"); }
  catch (e) { msg = e.message; }
  eq(msg.includes("switched off"), true, "blocked");
});

server.close();
console.log(failures ? `\n${failures} FAILURES` : "\nAll site tests passed.");
process.exit(failures ? 1 : 0);
