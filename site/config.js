"use strict";
/* Setup values. Empty until the owner registers the GitHub App (setup.html) and the relay is deployed (see site/README.md). */
window.UNGGAH_CONFIG = {
  API: "https://api.github.com",
  CLIENT_ID: "",   /* public client id of the owner's GitHub App (web flow + PKCE) */
  RELAY: "",       /* https URL of the stateless OAuth relay (server/ in this repo) */
  REAL_WRITES: false /* stays false until a real test repo is approved; loopback test servers are always allowed */
};
