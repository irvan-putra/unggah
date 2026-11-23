# Unggah web (site/)

Update a GitHub repo from a ZIP, entirely in the browser. Live at https://vanipy.com/unggah/ .

## How it works

- `zip.js` unpacks the ZIP in the browser (100 MB unpacked cap, 25 MB per file, path-safety checks, top-folder strip, `.git`/`__MACOSX`/`.DS_Store` filtered).
- `git.js` hashes every file as a git blob, diffs against the live branch through the Git Data API (`snapshot`), shows the exact add/change/remove plan (`plan`), and on confirm uploads blobs, writes a tree, creates a commit and moves the branch ref (`commitPlan`, never force-pushes).
- API calls go **straight from the browser to api.github.com** (GitHub supports CORS). Nothing but the sign-in exchange touches any other server.
- Compare works signed out on public repos. Committing needs sign-in.

## Sign-in (GitHub App web flow + PKCE)

1. `signInStart` generates `state` + a PKCE `code_verifier` (kept in `sessionStorage`, single use), and sends the browser to GitHub's own authorize page.
2. GitHub returns `?code&state` to this page. `signInFinish` checks the state, then posts `{code, code_verifier, redirect_uri}` to the relay (`server/` in this repo).
3. The relay holds the app client secret, calls GitHub's token endpoint, and returns the user token **with the refresh token stripped**.
4. The token lives in a JS variable only: never localStorage, never a cookie. Reload or close the tab and it is gone; it expires in about 8 hours anyway.

The page never asks for a password or a personal access token. Each user installs the GitHub App on the repos they choose (GitHub's install page), so the token can only touch those repos.

## Why a relay at all

GitHub's token-exchange endpoint requires the app's client secret and sends no CORS headers, so a static page cannot complete the exchange. The relay is the smallest possible fix: one stateless route (`POST /oauth/token`), strict origin/redirect allowlists, per-IP rate limits, no storage, no credential logging. Two interchangeable implementations: `server/` (Python, for NEO App) and `worker/` (Cloudflare Workers); see their READMEs.

## One-time owner setup

1. Open `setup.html` on the live site, create the GitHub App on GitHub's own page, put the client secret straight into the relay's environment (never in chat, never in this repo), and put the client id in `config.js`.
2. Deploy `server/` (see its README), put its URL in `config.js` as `RELAY`.
3. Flip `REAL_WRITES` to `true` only after a real test commit to an approved test repo succeeds.

## Tests

`node site-tests/run.mjs` (repo root): loopback mock of GitHub + relay, no network — ZIP parsing, the full compare/commit sequence, removals, sign-in success/state-mismatch/single-use/error paths, and the REAL_WRITES guard.
