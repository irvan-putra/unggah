# Unggah OAuth relay - Cloudflare Worker

Same relay as `../server/` (same routes, same guardrails), running as a
Cloudflare Worker. Fits the free tier easily: the only billable traffic is the
sign-in exchange (100k requests/day free), and there are no static assets.

Built as the backup path while NEO App's registry has an outage (2026-11-23);
either host can serve the site - the site config just points `RELAY` at one.

## Differences from the Python relay

- Rate limiting is per-isolate and best-effort (Cloudflare runs many isolates);
  it throttles casual abuse. The Python relay's limiter is exact. Everything
  else - origin/redirect allowlists, field validation, refresh-token stripping,
  no credential logging - is identical and covered by the same behavior tests.

## Deploy (owner's one-time steps, ~10 minutes)

No Cloudflare account exists yet; these steps create everything.

1. Sign up free at https://dash.cloudflare.com/sign-up (email + password, no card).
2. On any computer with Node.js:
   ```
   cd worker
   npx wrangler login        # opens Cloudflare's own authorization page in the browser
   npx wrangler secret put UNGGAH_GITHUB_CLIENT_SECRET   # paste the GitHub App client secret when prompted (never in chat, never in this repo)
   npx wrangler deploy
   ```
3. The deploy prints the live URL: `https://unggah-relay.<your-subdomain>.workers.dev`.
   Hand that URL to Instinct (it is not secret); it goes into `site/config.js` as `RELAY`.

No account id, zone, or secret is committed; `wrangler.toml` carries only the
public client id and allowlists.

## Tests

`node worker-tests/run.mjs` (repo root) drives the Worker's fetch handler
against a loopback stub of GitHub's token endpoint - no Cloudflare account or
wrangler needed. Mirrors the Python relay's test suite behavior-for-behavior.
