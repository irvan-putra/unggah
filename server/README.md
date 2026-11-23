# Unggah OAuth relay (NEO App service)

The smallest possible server side for Unggah web's GitHub sign-in. Stateless:
no database, no bucket, no disk. Python standard library only, runs in ~30 MB.

GitHub's token-exchange endpoint needs the app client secret and has no CORS
headers, so the static site cannot do the exchange itself. This relay holds the
secret and exposes exactly one working route. Everything else (ZIP unpack,
diff, blob/tree/commit writes) stays in the browser and goes straight to
api.github.com. Design rationale: `../site/README.md`.

## Routes

- `GET /healthz` — `{"ok": true}`, nothing else.
- `POST /oauth/token` — `{code, code_verifier, redirect_uri}` from the browser.
  Exchanges at GitHub with the client secret and returns GitHub's JSON **minus
  the refresh token** (the browser keeps tokens in memory only and discards
  them on reload/expiry by design; a refresh token would defeat that).
- Everything else: 404. `OPTIONS` preflight answered only for allowed origins.

## Guardrails

- `Origin` must be in `UNGGAH_ALLOWED_ORIGINS`; `redirect_uri` must be in
  `UNGGAH_ALLOWED_REDIRECT_URIS`. Both exact-match.
- Strict field validation (PKCE verifier charset/length per RFC 7636, code
  charset, 8 KB body cap, JSON only).
- Rate limits: per client IP (`UNGGAH_RATE_PER_MIN`, default 10/min) and global
  (`UNGGAH_GLOBAL_RATE_PER_MIN`, default 60/min). Exchanges are never retried
  automatically (codes are single-use).
- No logging of bodies, codes, verifiers, or tokens — route + status only.
- `Cache-Control: no-store` on every response.

## Configuration (env vars)

| Var | Required | Meaning |
| --- | --- | --- |
| `UNGGAH_GITHUB_CLIENT_ID` | yes | GitHub App client id (public value, also in `site/config.js`). |
| `UNGGAH_GITHUB_CLIENT_SECRET` | yes | GitHub App client secret. Owner pastes it into the portal directly; never in the repo or chat. |
| `UNGGAH_ALLOWED_ORIGINS` | no | Comma-separated origins, default `https://vanipy.com`. |
| `UNGGAH_ALLOWED_REDIRECT_URIS` | no | Comma-separated OAuth callback URLs, default `https://vanipy.com/unggah/`. Must match the GitHub App's callback URL list. |
| `UNGGAH_TOKEN_URL` | no | Upstream token endpoint, default `https://github.com/login/oauth/access_token` (overridden in tests). |
| `PORT` | no | Default 8080. |

## Deploy on NEO App (owner's account)

Dockerfile app from this repo, root directory `server/`, one always-on
replica, 0.5 vCPU + 256 MB (the approved allocation; measured headroom is
large for this workload). No database, no bucket, no volume. Bind nothing;
set the env vars above. Updating is stop-then-start (NEO rolling updates and
single-writer services do not mix — lesson from the jin service, 2026-11-23;
this service has no lease, but recreate keeps deploys predictable).

## Local development

```
UNGGAH_GITHUB_CLIENT_ID=x UNGGAH_GITHUB_CLIENT_SECRET=y python app/main.py
```

Tests (no network, stub upstream): `python3 -m unittest discover -s tests -v`
