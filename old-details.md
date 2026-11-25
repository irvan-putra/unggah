# Old details (archived before refresh)

Archived on 2026-11-25 during the repo details refresh. The sections below record what the repository's public details said immediately before the refresh.

## About description (before)

(empty)

## Website field (before)

(empty)

## README.md (before)

# Unggah (Android)

An Android (Kotlin) app that lets you push a ZIP file to a GitHub repo using real `git` over **SSH**.

![Unggah screenshot](docs/screenshot.jpg)

## Capabilities

- **Generate SSH key** inside the app and copy the public key for GitHub
- **Push ZIP → GitHub**:
  - Unzips a selected ZIP
  - Creates a commit
  - Pushes to `git@github.com:<owner>/<repo>.git` on the chosen branch
- **Persist settings**
  - Remembers GitHub owner/repo/branch/commit message
  - Keeps the generated SSH key on device
  - Supports Android backup/restore + **Export backup / Import backup**
- **Debugging tools**
  - “Copy log” button for easy paste
  - “View history” screen with full log history + copy/clear
  - Extra diagnostics for push rejections (ahead/behind, remote update status)
- **UI**
  - Home rocket animation
  - Push screen shows a big, slow, front overlay rocket while pushing

## Unggah web

The browser version lives in `site/` (https://vanipy.com/unggah/): same idea — pick a ZIP, see the exact diff against a branch, commit — but fully client-side, with GitHub App sign-in (web flow + PKCE, per-repo grants, token in tab memory only). The tiny sign-in relay is in `server/`. See `site/README.md` for the architecture and `server/README.md` for deployment.

## Run on your phone (Android Studio)

1. Open this folder in **Android Studio**
2. Let Gradle sync
3. Connect your Android phone via USB and enable **Developer options → USB debugging**
4. Click **Run ▶** and pick your device

## Build an APK

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

## First-time GitHub setup

1. In the app: **Generate SSH key** → **Copy public key**
2. In GitHub: **Settings → SSH and GPG keys → New SSH key**
3. Back in the app: fill owner/repo/branch and push

---

Built with AI assistance (Instinct, trae.ai and others). Not everything has been reviewed by Irvan.
