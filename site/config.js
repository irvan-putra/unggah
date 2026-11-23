"use strict";
/* Setup values. Empty until the owner registers the GitHub App (setup.html) and the relay is deployed (see site/README.md). */
window.UNGGAH_CONFIG = {
  API: "https://api.github.com",
  CLIENT_ID: "Iv23liyHXcr16ew3LsB8",   /* public client id of the owner's GitHub App (web flow + PKCE) */
  RELAY: "https://oad25td.app.neoapp.id",       /* https URL of the stateless OAuth relay (server/ in this repo) */
  APP_INSTALL: "https://github.com/apps/unggah-web/installations/new", /* where users grant the app access to chosen repos */
  REAL_WRITES: false /* relay paused to stop hosting charges, 2026-11-24; loopback tests remain allowed */
};
