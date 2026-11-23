"use strict";
const $ = id => document.getElementById(id), cfg = Object.assign({}, window.UNGGAH_CONFIG), G = window.UnggahGit;
let files = null, snap = null, pl = null, token = null, tokenExp = 0, gh;
const qs = new URLSearchParams(location.search);
/* Test hook: only a loopback API address may be substituted, and only it may receive a test token. */
if (qs.get("api") && G.isLoopback(qs.get("api"))) { cfg.API = qs.get("api"); token = qs.get("token") || null; }
gh = new G.GH(cfg.API, token);
const loop = G.isLoopback(cfg.API);
const redirectUri = location.origin + location.pathname;

function signedIn() { return !!token; }
function authUi() {
  const canSignIn = cfg.REAL_WRITES && cfg.CLIENT_ID && cfg.RELAY;
  $("signin").hidden = !canSignIn || signedIn();
  $("signout").hidden = !signedIn() || loop;
  $("signed1").hidden = !signedIn();
  $("st1").className = signedIn() ? "done" : "";
  if (loop) $("state").textContent = "Test mode: talking to a local mock server, not GitHub.";
  else if (signedIn()) $("state").textContent = $("state").dataset.msg || "Signed in.";
  else if (canSignIn) $("state").textContent = "Sign in with GitHub to compare and commit. Compare also works signed out on public repos.";
  else $("state").textContent = "Compare works on public repos. Committing is switched off until the GitHub sign-in is set up, so this page cannot change any repo yet.";
}
function expired() { return tokenExp && Date.now() > tokenExp; }
async function afterSignIn(t, expiresIn) {
  token = t; tokenExp = expiresIn ? Date.now() + expiresIn * 1000 : 0;
  gh.token = token;
  try { const me = await gh.req("GET", "/user"); $("state").dataset.msg = "Signed in as @" + me.login + (expiresIn ? " (session lasts about " + Math.round(expiresIn / 3600) + " hours, this tab only)" : ""); }
  catch { $("state").dataset.msg = "Signed in."; }
  authUi(); upd();
}
$("signin").onclick = async () => {
  try { location.href = await G.signInStart(cfg, redirectUri); }
  catch (err) { $("state").textContent = err.message; }
};
$("signout").onclick = () => { token = null; tokenExp = 0; gh.token = null; delete $("state").dataset.msg; authUi(); };

(async () => {
  try {
    const got = await G.signInFinish(cfg, qs);
    if (got) { history.replaceState(null, "", location.pathname); await afterSignIn(got.token, got.expiresIn); }
  } catch (err) { history.replaceState(null, "", location.pathname); $("state").textContent = "Sign-in failed: " + err.message; }
  authUi();
})();

function upd() { $("cmp").disabled = !(files && /^[\w.-]+\/[\w.-]+$/.test($("repo").value.trim())); }
$("repo").oninput = upd;
$("zip").onchange = async e => {
  const f = e.target.files[0]; files = null; $("res").hidden = true; if (!f) return; $("zn").textContent = " " + f.name;
  try { files = await UnggahZip.readZip(await f.arrayBuffer()); $("zn").textContent = ` ${f.name}: ${files.length} files${files.stripped ? " (top folder \"" + files.stripped + "\" removed)" : ""}`; }
  catch (err) { $("zn").textContent = " " + err.message; }
  upd();
};
function line(cls, sign, t) { const li = document.createElement("li"); li.className = cls; li.textContent = sign + " " + t; return li; }
$("cmp").onclick = async () => {
  $("cmp").disabled = true; $("res").hidden = true; $("cst").textContent = "";
  try {
    const [owner, repo] = $("repo").value.trim().split("/"), branch = $("br").value.trim() || "main";
    gh.token = token; snap = await gh.snapshot(owner, repo, branch); pl = await G.plan(snap, files, $("del").checked);
    $("sum").textContent = `${pl.add.length} added, ${pl.modify.length} changed, ${pl.remove.length} removed, ${pl.same.length} unchanged`;
    const ul = $("list"); ul.replaceChildren();
    pl.add.forEach(f => ul.append(line("a", "+", f.path))); pl.modify.forEach(f => ul.append(line("m", "~", f.path))); pl.remove.forEach(f => ul.append(line("r", "-", f.path)));
    $("rmc").hidden = !pl.remove.length; $("rmok").checked = false; $("res").hidden = false;
    $("commit").disabled = !(pl.add.length + pl.modify.length + pl.remove.length) || !(loop || (cfg.REAL_WRITES && signedIn()));
    if (!$("commit").disabled || (loop || (cfg.REAL_WRITES && signedIn()))) $("cst").textContent = "";
    else $("cst").textContent = cfg.REAL_WRITES ? "Sign in with GitHub to commit." : "Committing is switched off in this build.";
  } catch (err) {
    $("res").hidden = false; $("list").replaceChildren(); $("commit").disabled = true;
    $("sum").textContent = "Could not compare: " + (err.status === 401 ? "sign-in expired, please sign in again." : err.message);
    if (err.status === 401) { token = null; tokenExp = 0; gh.token = null; authUi(); }
  }
  upd();
};
$("commit").onclick = async () => {
  if (pl.remove.length && !$("rmok").checked) { $("cst").textContent = "Tick the removal confirmation first, or untick the removal option and compare again."; return; }
  if (!signedIn() && !loop) { $("cst").textContent = "Sign in with GitHub first."; return; }
  if (expired()) { $("cst").textContent = "Sign-in expired, please sign in again."; return; }
  $("commit").disabled = true;
  try {
    const [owner, repo] = $("repo").value.trim().split("/"), branch = $("br").value.trim() || "main";
    gh.token = token; const sha = await G.commitPlan(gh, cfg, owner, repo, branch, snap, pl, $("msg").value || "Update from Unggah web", (d, t) => { $("cst").textContent = `Uploading ${d} of ${t}...`; });
    $("cst").textContent = "Committed " + sha.slice(0, 7) + ".";
  } catch (err) {
    if (err.status === 403 && /not accessible by integration/i.test(err.message || "")) {
      $("cst").textContent = "The Unggah app cannot write to this repo yet. ";
      const a = document.createElement("a"); a.href = cfg.APP_INSTALL; a.textContent = "Open GitHub to grant it this repo";
      a.target = "_blank"; a.rel = "noopener"; $("cst").append(a, ", then commit again (no need to sign in again).");
    } else {
      $("cst").textContent = "Not committed: " + (err.status === 401 ? "sign-in expired, please sign in again." : err.message);
    }
  }
};
