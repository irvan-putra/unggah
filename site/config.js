"use strict";
/* Setup values. Empty until the owner registers the GitHub App (setup.html) and the relay is deployed (see site/README.md). */
window.UNGGAH_CONFIG = {
  API: "https://api.github.com",
  CLIENT_ID: "Iv23liyHXcr16ew3LsB8",   /* public client id of the owner's GitHub App (web flow + PKCE) */
  RELAY: "https://oad25td.app.neoapp.id",       /* https URL of the stateless OAuth relay (server/ in this repo) */
  REAL_WRITES: true /* live since 2026-11-23 for the approved sapi test write; loopback test servers are always allowed */
};
