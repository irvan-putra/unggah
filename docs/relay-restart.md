# Restart the Unggah web relay

## Stopped-service snapshot (2026-11-24)

At the time of this snapshot, the NEO service was stopped, not deleted. The identifiers below apply only while that project still exists. If it has since been deleted, use the from-scratch section instead; a deleted project cannot be restarted. `site/config.js` has `REAL_WRITES: false`: public-repo comparison still works, while GitHub sign-in and commits are hidden/blocked. The Android app is unaffected.

- Project: `8dce1326-8261-4645-b030-b33ebc21e987`
- App: `ae7331a8-8540-4874-980b-89430f5226f4`
- Service: `unggah`
- Relay: https://oad25td.app.neoapp.id
- Site: https://vanipy.com/unggah/

## Restart only after approving hosting charges

1. In NEO App, open the existing Unggah service and Start it with **one replica, 0.5 vCPU, 256 MB**. Do not create a new app, database, bucket or volume. This resumes paid compute. Keep the existing environment variables and client secret; never copy secrets into this repo.
2. Check the lifecycle API reports `running`, desired/current/ready replicas all `1`, and no terminating pods. Verify `GET https://oad25td.app.neoapp.id/healthz` returns HTTP 200 and `{"ok":true}`. Check an unauthorized origin is still rejected.
3. Set `REAL_WRITES: true` in `site/config.js`, commit and push. Wait for GitHub Pages to deploy, then confirm the served config and rendered phone page show GitHub sign-in and the repo-grant steps.
4. Sign in on GitHub, grant the app access only to the intended repo, compare a small ZIP and make an approved test commit. Verify the commit and its author on GitHub. If this fails, set `REAL_WRITES: false` again while investigating.

The existing GitHub App is https://github.com/apps/unggah-web. Existing repo grants need not be recreated unless revoked.

## API operations

Use the existing project-scoped NEO token as a Bearer credential. Never place it in source, command history or logs. Base URL: `https://portal.app.neoapp.id/api/v1`.

- Read state: `GET /projects/8dce1326-8261-4645-b030-b33ebc21e987/services/unggah/lifecycle`
- Start: `POST` to that lifecycle path with `{"action":"start","replicas":1,"idempotencyKey":"<unique-operation-id>"}`.
- Stop: `POST` to that lifecycle path with `{"action":"stop","idempotencyKey":"<unique-operation-id>"}`. Wait until `stopped`, all replica counts zero and `terminatingPods: 0`.
- Inspect retained settings: `GET /apps/ae7331a8-8540-4874-980b-89430f5226f4`.
- Usage: `GET /projects/8dce1326-8261-4645-b030-b33ebc21e987/usage`.

## Stop again

Stop the existing service, do not delete it. Set `REAL_WRITES: false`, keep the paused steps visible, and verify the relay no longer answers successfully. Check the NEO lifecycle and later usage samples: historical charges remain and the usage display may lag the stop. Do not treat an old usage sample as proof that metering has stopped. After any future deployment, re-check lifecycle state so a stopped service is not accidentally restarted.


## Rebuild from scratch after project deletion

Deleting the NEO project does not delete this repository or the GitHub App. It does remove the hosted service and its environment configuration. The old project/app IDs and relay domain above are historical references, not settings to reuse for a new deployment.

### 1. Approve hosting and create the replacement

The previous allocation was about **Rp32,000 per month before tax**, at one replica, 0.5 vCPU and 256 MB RAM. Verify NEO's current price before approving a replacement. Starting/deploying the replacement resumes paid compute; these instructions do not authorize a purchase. No database, bucket or persistent volume is needed.

In the official NEO App portal, create a new project, then a web app from this repository with:

| Setting | Value |
| --- | --- |
| Source repository | `https://github.com/irvan-putra/unggah` |
| Branch | `main` |
| Build type | Dockerfile |
| Build context / root directory | `server` |
| Dockerfile path (within context) | `Dockerfile` |
| Service type | Web |
| Port | `8080` |
| Replicas | `1` |
| CPU limit | `0.5` vCPU |
| Memory limit | `256M` |
| Billing mode | Unbundled, verify the displayed price |
| TLS | Enabled on the assigned HTTPS domain |
| Storage / managed resources | None |

Record the new project ID, app ID, service name and assigned HTTPS domain. A token scoped to the deleted project may not access the replacement; if API access is needed, create a project-scoped token through the owner's official portal and keep it out of the repo.

### 2. Restore environment configuration securely

Use the existing GitHub App if it still exists. Do not create a second GitHub App unnecessarily. In NEO's environment settings, configure these names (secret values must never be committed or sent through chat):

- `UNGGAH_GITHUB_CLIENT_ID`: the GitHub App's public client ID.
- `UNGGAH_GITHUB_CLIENT_SECRET`: mark as secret; obtain it from the owner's secure copy or generate a replacement on GitHub's own App settings page if the old secret is unavailable. Do not expose it to this site's browser code.
- `UNGGAH_ALLOWED_ORIGINS`: the exact origin hosting the page, without a path.
- `UNGGAH_ALLOWED_REDIRECT_URIS`: the exact full page callback URL, including its trailing slash. This must also be permitted in the GitHub App settings.
- `PORT`: `8080` (already the Dockerfile default).

Keep the existing upstream token endpoint and rate-limit defaults unless deliberately changing them. Do not put user access tokens or the NEO API token in these public site files. For configuration details and route behavior, see `server/README.md`.

### 3. Verify the new relay before opening sign-in

Keep `REAL_WRITES: false` while deploying and checking the relay. Run the local tests before deployment: `python3 -m unittest discover -s server/tests -v` and `node site-tests/run.mjs` from the repo root.

Wait for a successful NEO deployment. Check the new service's lifecycle reports `running`, desired/current/ready replicas all `1`, and `terminatingPods: 0`. Fetch `/healthz` on the newly assigned HTTPS domain and require HTTP 200 with `{"ok":true}`. Confirm an unauthorized origin cannot exchange tokens. A passing health check alone does not prove GitHub sign-in works.

### 4. Reconnect the static page and test a write

1. In `site/config.js`, set `RELAY` to the **new** HTTPS relay origin, without a trailing path. Confirm `CLIENT_ID` matches the GitHub App and `APP_INSTALL` still points to that app's installation page. Keep `API` set to GitHub's API.
2. Verify the GitHub App's callback URL matches the deployed page URL and the relay's redirect allowlist. Replacing only the relay host does not require changing the page's callback URL.
3. Set `REAL_WRITES: true` only when ready for an approved live test. Commit and push the page configuration to `main`; wait for the `pages-site` workflow to succeed. When changing cached configuration/UI assets, update their version suffixes in `site/index.html` together, then check a fresh phone-sized page load.
4. Sign in on GitHub, grant the app access only to the intended test repo, select a small ZIP, compare, review the exact changes, and make the approved test commit. Verify the resulting commit, files and author on GitHub. Existing repo grants remain usable unless revoked.
5. If the live test fails, set `REAL_WRITES: false` again and deploy that change before investigating. Do not leave the page offering a dead sign-in.

After **every deployment**, check the actual lifecycle and replica counts again. A deploy can change a service's running state; never assume a previously stopped service stayed stopped. When pausing, stop it, verify all pods are gone, disable real writes, and compare later organization usage samples for unchanged quantities. Historical charges do not disappear on deletion.
