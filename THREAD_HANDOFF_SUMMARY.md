# Thread Handoff Summary

This file is the current handoff for restarting work in a fresh thread.

## Repo

- App repo: `/Users/hans/Desktop/GnosisTMS`
- Broker repo: `/Users/hans/Desktop/gnosis-tms-github-app-broker`

## Current app repo state

- Branch: `main`
- HEAD changes have advanced well beyond the old updater setup commit; if resuming, use `git log --oneline -n 12` instead of relying on the stale SHA that was previously recorded here.
- Working tree: clean
- Local branch may temporarily be ahead of `origin/main` when packaging tweaks are prepared but not yet pushed.

Recent app commits:

- `052f4e5` `Add custom macOS DMG background and window layout`
- `6995bad` `Add mac signing and notarization workflow setup`
- `916193e` `Prepare v0.1.3 release`
- `000efb3` `Update release actions to Node 24 versions`
- `bcf3409` `Prepare v0.1.2 release`
- `a6a83c0` `Add updater plugin config and secret progress notes`

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

Release versions progressed like this:

- `v0.1.1`: failed because the tag pointed to a commit before `plugins.updater` was present in `tauri.conf.json`
- `v0.1.2`: succeeded for macOS and Windows release publishing
- `v0.1.3`: current release intended to test Apple signing/notarization workflow

Current app version has been bumped to `0.1.3` in:

- `/Users/hans/Desktop/GnosisTMS/package.json`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/Cargo.toml`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/Cargo.lock`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/tauri.conf.json`

Pushed tags:

- `v0.1.1`
- `v0.1.2`
- `v0.1.3`

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
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY`
- `APPLE_API_KEY_CONTENT`

## Apple signing / notarization state

The mac release pipeline was extended to sign and notarize macOS builds.

Workflow file:

- `/Users/hans/Desktop/GnosisTMS/.github/workflows/release-tauri.yml`

Local Apple signing artifacts created during setup:

- `/Users/hans/Desktop/GnosisTMS/Certificates.p12`
- `/Users/hans/Desktop/GnosisTMS/developerID_application.cer`
- `/Users/hans/Desktop/GnosisTMS/CertificateSigningRequest.certSigningRequest`
- `/Users/hans/Desktop/GnosisTMS/signingCerts/AuthKey_K97CK8B339.p8`

These are gitignored via:

- `/Users/hans/Desktop/GnosisTMS/.gitignore`

Installed mac signing identity on this Mac:

- `Developer ID Application: Ngo Minh Ngoc (DMM8533PS6)`

App Store Connect notarization identifiers:

- `Issuer ID`: `69a6de80-191b-47e3-e053-5b8c7c11a4d1`
- `Key ID`: `K97CK8B339`

## DMG branding state

Mounted DMG branding work now uses stock Tauri macOS DMG support rather than a custom workflow script.

Implemented:

- branded install background image at `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/background.png`
- DMG layout config in `/Users/hans/Desktop/GnosisTMS/src-tauri/tauri.conf.json`
- mounted volume icon uses the existing app icon from `/Users/hans/Desktop/GnosisTMS/src-tauri/icons/icon.icns`

Important details:

- Tauri's DMG bundler already passes a volume icon into `bundle_dmg.sh` and writes `.VolumeIcon.icns` inside the mounted image
- a direct local debug DMG bundle succeeded with the new background and volume icon flow
- a full local `npm run tauri -- build --bundles dmg --debug` run also succeeded after the DMG config change
- the downloaded `.dmg` file icon itself is still not the reliable target; the supported branding target is the mounted volume icon

If continuing this work later:

1. Inspect `/Users/hans/Desktop/GnosisTMS/src-tauri/tauri.conf.json`
2. Inspect `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/background.png`
3. Re-run a local DMG build if needed:
   - `npm run tauri -- build --bundles dmg --debug`
4. If a future release needs this branding, cut a new release tag after pushing the commit containing the DMG config/background asset

## Local secret storage

Do not commit actual secret material.

Current local updater private key path:

- `/Users/hans/Desktop/GnosisTMS/.gnosis-tms/secrets/tauri-updater.key`

Notes:

- `.gnosis-tms/secrets/` is gitignored in `/Users/hans/Desktop/GnosisTMS/.gitignore`
- the original `/private/tmp/gnosis-tms-updater.key` copy was deleted
- this handoff intentionally does not store the actual password or private key contents

## Current GitHub Actions runs

Important recent release runs:

- `v0.1.1`
  - run id: `23889877708`
  - result: failed / obsolete
  - reason: missing `plugins.updater` config in the tagged commit
- `v0.1.2`
  - run id: `23893693762`
  - result: succeeded
  - note: mac artifacts were published, but this was before Apple signing/notarization workflow setup
- `v0.1.3`
  - run id: `23904153754`
  - result: current run to inspect for signed/notarized mac artifacts
  - url: `https://github.com/gnosistms/Gnosis-TMS-tauri-app/actions/runs/23904153754`

## If continuing in a fresh thread

Start here:

1. Read this file.
2. Check the current release run status:
   - `gh run view 23904153754`
3. If needed, inspect the release workflow:
   - `/Users/hans/Desktop/GnosisTMS/.github/workflows/release-tauri.yml`
4. If the run failed, inspect logs and patch the workflow or signing/notarization setup.
5. If the run succeeded, verify:
   - GitHub Release assets exist
   - `latest.json` is present on the release
   - mac downloaded app no longer shows the “damaged / move to trash” Gatekeeper warning
   - Windows release still publishes successfully
   - a packaged older build detects the update

## Broker note

Broker cleanup and permission-flow changes were already completed and pushed in the broker repo.
If broker work comes up again, inspect the broker repo separately rather than assuming app repo changes are involved.

## Secret tracking docs

Current secret-handling docs:

- `/Users/hans/Desktop/GnosisTMS/UPDATER_KEY_MANAGEMENT.md`
- `/Users/hans/Desktop/GnosisTMS/SECRET_INVENTORY.md`

Current secret progress:

- step 1 complete: Tauri updater key stored in Apple Passwords
- step 2 complete: GitHub App private key regenerated, stored in Apple Passwords, deployed, and old keys removed after verification
- step 3 complete: `GITHUB_APP_CLIENT_SECRET` stored in Apple Passwords, deployed, and old client secret removed after verification
- step 4 complete: `BROKER_STATE_SECRET` regenerated, stored in Apple Passwords, and deployed
- Apple mac signing certificate exported as `.p12` and stored in GitHub Actions
- Apple notarization API key stored in GitHub Actions

Primary recovery source for non-recoverable secrets:

- Apple Passwords entries:
  - `Gnosis TMS Tauri Updater Key`
  - `Gnosis TMS GitHub App Private Key`
  - `Gnosis TMS GitHub App Client Secret`
  - `Gnosis TMS Broker State Secret`

GitHub can re-show/reference:

- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_CLIENT_ID`

GitHub cannot reliably re-show later:

- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_CLIENT_SECRET`
- `BROKER_STATE_SECRET`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_CONTENT`

Primary local files to keep out of git:

- `/Users/hans/Desktop/GnosisTMS/.gnosis-tms/secrets/tauri-updater.key`
- `/Users/hans/Desktop/GnosisTMS/Certificates.p12`
- `/Users/hans/Desktop/GnosisTMS/developerID_application.cer`
- `/Users/hans/Desktop/GnosisTMS/CertificateSigningRequest.certSigningRequest`
- `/Users/hans/Desktop/GnosisTMS/signingCerts/AuthKey_K97CK8B339.p8`
