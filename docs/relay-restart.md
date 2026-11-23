# Restart the Unggah web relay

## Current state (2026-11-24)

The NEO service is stopped, not deleted. The project, app, image, domain and environment configuration are retained. `site/config.js` has `REAL_WRITES: false`: public-repo comparison still works, while GitHub sign-in and commits are hidden/blocked. The Android app is unaffected.

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
