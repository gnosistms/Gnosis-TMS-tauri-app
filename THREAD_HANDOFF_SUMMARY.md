# Thread Handoff Summary

This file is the current handoff for restarting work in a fresh thread.

## Repo

- App repo: `/Users/hans/Desktop/GnosisTMS`
- Broker repo: `/Users/hans/Desktop/gnosis-tms-github-app-broker`

## Current app repo state

- Branch: `main`
- HEAD: `a8079a20ea3a0916ebdb83a3f9fed069abf181d3`
- Working tree: clean

Recent app commits:

- `a8079a2` `Support macOS and Windows releases`
- `26d59cc` `Prepare v0.1.1 release`
- `91525af` `Add updates feature`

## Tauri updater / release setup

The app now has Tauri updater plumbing wired for packaged release builds.

Important files:

- `/Users/hans/Desktop/GnosisTMS/src-tauri/src/updater.rs`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/src/lib.rs`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/Cargo.toml`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/tauri.conf.json`
- `/Users/hans/Desktop/GnosisTMS/src-ui/app/updater-flow.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/teams/index.js`
- `/Users/hans/Desktop/GnosisTMS/.github/workflows/release-tauri.yml`
- `/Users/hans/Desktop/GnosisTMS/TAURI_UPDATER_SETUP.md`

Updater feed URL used by release builds:

- `https://github.com/gnosistms/Gnosis-TMS-tauri-app/releases/latest/download/latest.json`

Behavior:

- packaged release builds check for updates
- local dev does not self-update
- updater UI currently surfaces from the Teams screen

## Supported release platforms

Current release workflow targets:

- macOS Apple Silicon (`aarch64-apple-darwin`)
- macOS Intel (`x86_64-apple-darwin`)
- Windows (`windows-x86_64`)

Linux is intentionally not in scope right now.

## Version / tag state

Release version was bumped to `0.1.1` in:

- `/Users/hans/Desktop/GnosisTMS/package.json`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/Cargo.toml`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/Cargo.lock`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/tauri.conf.json`

The `v0.1.1` tag has already been pushed.

## GitHub auth / secrets state

`gh` CLI is installed on this machine and authenticated as:

- `gnosistms`

Verified scopes:

- `repo`
- `workflow`
- `read:org`
- `gist`

GitHub Actions secrets that were set on the repo:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## Local secret storage

Do not commit actual secret material.

Current local updater private key path:

- `/Users/hans/Desktop/GnosisTMS/.gnosis-tms/secrets/tauri-updater.key`

Notes:

- `.gnosis-tms/secrets/` is gitignored in `/Users/hans/Desktop/GnosisTMS/.gitignore`
- the original `/private/tmp/gnosis-tms-updater.key` copy was deleted
- this handoff intentionally does not store the actual password or private key contents

## Current GitHub Actions run

The release workflow triggered by `v0.1.1` is currently:

- status: `in_progress`
- run id: `23889877708`
- url: `https://github.com/gnosistms/Gnosis-TMS-tauri-app/actions/runs/23889877708`

## If continuing in a fresh thread

Start here:

1. Read this file.
2. Check the current release run status:
   - `gh run view 23889877708`
3. If needed, inspect the release workflow:
   - `/Users/hans/Desktop/GnosisTMS/.github/workflows/release-tauri.yml`
4. If the run failed, inspect logs and patch the workflow or bundle config.
5. If the run succeeded, verify:
   - GitHub Release assets exist
   - `latest.json` is present on the release
   - a packaged older build detects the update

## Broker note

Broker cleanup and permission-flow changes were already completed and pushed in the broker repo.
If broker work comes up again, inspect the broker repo separately rather than assuming app repo changes are involved.

## Secret tracking docs

Current secret-handling docs:

- `/Users/hans/Desktop/GnosisTMS/UPDATER_KEY_MANAGEMENT.md`
- `/Users/hans/Desktop/GnosisTMS/SECRET_INVENTORY.md`
