# Thread Handoff Summary

This file is the current handoff for restarting work in a fresh thread.

## Current Product Work Snapshot

This handoff is stale for old release-packaging details below, but the latest app work worth preserving for a fresh thread is:

- storage roots are now installation-first under:
  - `/Users/hans/Library/Application Support/com.gnosis.tms/installations/installation-<id>/projects`
  - `/Users/hans/Library/Application Support/com.gnosis.tms/installations/installation-<id>/glossaries`
- the old `project-repos/` and `glossary-repos/` Application Support roots are deprecated leftovers and can be deleted once migration is confirmed
- glossary creation now uses a bundled language-code list in app source, not an OS/runtime lookup
- glossary list rows currently order actions as `Open`, `Download`, `Rename`, `Delete`
- glossary empty-state cards now have improved eyebrow/title spacing with a smaller section-title scale
- the glossary term modal was redesigned from comma-separated term inputs into ranked source/target variant lists:
  - source and target variants are stored as ordered arrays
  - array order is intentional and means highest-likelihood to lowest-likelihood
  - item `0` is the primary wording shown first in the editor
  - the same modal shell is used for both `New Term` and `Edit Term`
  - notes and footnote remain secondary fields below the ranked term lists
- the Projects `Add Files` action now opens the file picker directly from the click path instead of waiting for an extra render tick first
- the Translate editor now preserves its scroll position when the page is refreshed

If resuming glossary/editor work in a fresh thread, inspect these files first:

- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/glossary-term-editor-modal.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-flow.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/app/actions/glossary-actions.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/styles/modals.css`
- `/Users/hans/Desktop/GnosisTMS/PROJECT_STORAGE_SPEC.md`
- `/Users/hans/Desktop/GnosisTMS/GLOSSARY_IMPLEMENTATION_PLAN.md`

## Repo

- App repo: `/Users/hans/Desktop/GnosisTMS`
- Broker repo: `/Users/hans/Desktop/gnosis-tms-github-app-broker`

## Current app repo state

- Branch: `main`
- HEAD changes have advanced well beyond the old updater setup commit; if resuming, use `git log --oneline -n 12` instead of relying on the stale SHA that was previously recorded here.
- Working tree should be clean after the latest packaging/notes commit.
- `main` may be ahead of the latest pushed release tag; not every committed packaging tweak is necessarily released yet.

Recent app commits:

- most recent local commit should include:
  - the `icons:sync` automation
  - the `660x400` + stripped-`pHYs` DMG background fix
  - updated handoff/setup notes
- `7883324` `Prepare v0.1.8 release with rounded mac volume icon`
- `75f26af` `Track DMG background Affinity source`
- `a3a4e23` `Prepare v0.1.7 release`
- `b6723d5` `Prepare v0.1.6 release with zipped mac downloads`
- `ab5d081` `Fix Cargo lock for v0.1.5 release`
- `6bcfb82` `Add custom DMG file icons to macOS release workflow`
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
- `v0.1.3`: succeeded with Apple signing/notarization workflow
- `v0.1.4`: succeeded
- `v0.1.5`: succeeded, but the raw downloaded mac `.dmg` still lost its Finder icon
- `v0.1.6`: next release switches mac GitHub download assets to zipped DMGs so the extracted `.dmg` keeps its custom Finder icon
- `v0.1.7`: succeeded with the new DMG background and tracked Affinity source, but the mounted volume icon was still square because `icon.icns` had not yet been regenerated before tagging
- `v0.1.8`: succeeded with the rounded mounted volume icon fix; this is the first tagged release that should have the rounded mounted disk image icon
- `v0.1.9`: succeeded with the `660x400` background cleanup, but the final sharpness fix moved beyond PNG and into a TIFF-backed DMG background workflow that is newer than this tag
- `v0.1.10`: next release should publish the TIFF-backed DMG background workflow that rendered correctly in local Finder testing
- `v0.1.11`: next release republishes the TIFF-backed workflow with refreshed DMG background artwork exported from Affinity

Current app version has been bumped to `0.1.11` in:

- `/Users/hans/Desktop/GnosisTMS/package.json`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/Cargo.toml`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/Cargo.lock`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/tauri.conf.json`

Current `main` / release-prep version is now `0.1.11`, including the refreshed TIFF DMG background artwork.

Pushed tags:

- `v0.1.1`
- `v0.1.2`
- `v0.1.3`
- `v0.1.4`
- `v0.1.5`
- `v0.1.6`
- `v0.1.7`
- `v0.1.8`
- `v0.1.9`
- `v0.1.10`
- `v0.1.11`

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

DMG branding now has two separate layers and this distinction matters:

### 1. Mounted volume / installer window

This uses stock Tauri macOS DMG support.

Implemented:

- branded install background image now delivered to Finder as:
  - `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/background.tiff`
- editable Affinity source at `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/background.af`
- exported PNG sources:
  - `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/background.png`
  - `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/background@2x.png`
- generated Retina TIFF used by Finder:
  - `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/background.tiff`
- DMG layout config in `/Users/hans/Desktop/GnosisTMS/src-tauri/tauri.conf.json`
- mounted volume icon uses the existing app icon from `/Users/hans/Desktop/GnosisTMS/src-tauri/icons/icon.icns`
- single-source rounded icon artwork at:
  - `/Users/hans/Desktop/GnosisTMS/src-tauri/icons/mac icon-iOS-Default-1024x1024@1x.png`
- local/CI sync script for generated icon assets:
  - `/Users/hans/Desktop/GnosisTMS/src-tauri/icons/sync-generated-icons.sh`

Important details:

- Tauri's DMG bundler passes a volume icon into `bundle_dmg.sh` and writes `.VolumeIcon.icns` inside the mounted image
- a direct local debug DMG bundle succeeded with the background and mounted volume icon flow
- a full local `npm run tauri -- build --bundles dmg --debug` run also succeeded after the DMG config change
- the rounded mounted volume icon comes from regenerating `/Users/hans/Desktop/GnosisTMS/src-tauri/icons/icon.icns` from:
  - `/Users/hans/Desktop/GnosisTMS/src-tauri/icons/mac icon-iOS-Default-1024x1024@1x.png`
- the app icon / mounted DMG volume icon / Windows-generated icons can now be regenerated together from that same source by running:
  - `npm run icons:sync`
- the GitHub Actions release workflow now runs:
  - `npm run icons:sync`
  before building, so future mac releases should not miss an `icon.icns` refresh the way `v0.1.7` did
- `v0.1.7` was tagged before that `icon.icns` refresh, which is why the mounted disk image icon was still square there
- `v0.1.8` includes the rounded mounted volume icon fix

### DMG background sizing / Retina lesson

This should not be relearned:

- Finder does **not** treat the DMG background like an `@2x` Retina asset
- when `background.png` was increased to `1320x800` while the DMG window stayed `660x400`, Finder rendered it oversized instead of scaling it down
- there is no discovered Finder setting to "scale background to window"

The final local solution that rendered correctly was:

- keep two exported background PNGs:
  - `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/background.png` at `660x400`
  - `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/background@2x.png` at `1320x800`
- build a multi-representation TIFF:

```bash
tiffutil -cathidpicheck src-tauri/dmg/background.png src-tauri/dmg/background@2x.png -out src-tauri/dmg/background.tiff
```

- point `/Users/hans/Desktop/GnosisTMS/src-tauri/tauri.conf.json` to:
  - `dmg/background.tiff`

What was verified locally:

- the TIFF contained both `660x400` and `1320x800` image representations
- `npm run tauri -- build --bundles dmg --debug` succeeded with the TIFF path
- the mounted Finder DMG window looked correct using the TIFF background
- the TIFF path is now what should ship in `v0.1.10`

If continuing in a fresh thread, inspect:

- `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/background.png`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/background@2x.png`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/background.tiff`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/tauri.conf.json`
- then decide whether to cut the next release tag

### 2. Downloaded `.dmg` file icon in Finder

This is **not** the same thing as the mounted volume icon.

The working method was verified locally and should not be forgotten:

- use the same flattened PNG exported from Apple Icon Composer that now serves as the icon source of truth:
  - `/Users/hans/Desktop/GnosisTMS/src-tauri/icons/mac icon-iOS-Default-1024x1024@1x.png`
- run `sips -i` on that PNG
- run `DeRez -only icns` on the PNG to extract icon resources
- run `Rez -append` to write those icon resources into the final `.dmg` file
- run `SetFile -a C` on the final `.dmg`

Working helper script:

- `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/apply-dmg-file-icon.sh`

The crucial lesson:

- `.VolumeIcon.icns` only controls the mounted volume icon
- it does **not** solve the Finder icon of the downloaded `.dmg` file itself
- the downloaded file icon required the separate `sips` + `DeRez` + `Rez` + `SetFile -a C` path
- but it now uses the same single source PNG as the generated app icons

## Downloads site

Static GitHub Pages downloads site has been added under:

- `/Users/hans/Desktop/GnosisTMS/docs/index.html`
- `/Users/hans/Desktop/GnosisTMS/docs/styles.css`
- `/Users/hans/Desktop/GnosisTMS/docs/app.js`
- `/Users/hans/Desktop/GnosisTMS/docs/CNAME`

Setup doc:

- `/Users/hans/Desktop/GnosisTMS/DOWNLOADS_PAGE_SETUP.md`

Purpose:

- host `downloads.gnosis-tms.com` on GitHub Pages
- fetch the latest GitHub release dynamically
- recommend the right installer for Windows or macOS
- still show manual download links

Current asset matching rules in the static page:

- Mac Apple Silicon ZIP: `/_aarch64\.zip$/`
- Mac Intel ZIP: `/_x64\.zip$/`
- Windows MSI: `/_x64_en-US\.msi$/`
- Windows EXE setup: `/_x64-setup\.exe$/`

Reason the page uses ZIPs for Mac:

- direct GitHub-downloaded `.dmg` files lose the custom Finder file icon metadata
- zipped DMGs preserve that icon after the user unzips on macOS

Release workflow state:

- `.github/workflows/release-tauri.yml` now patches the built mac DMGs with the custom file icon
- after patching, the workflow re-signs the DMG, re-notarizes it, staples it, wraps it in a mac-created `.zip`, deletes the raw mac `.dmg` asset from the GitHub release, and uploads the `.zip` with `gh release upload --clobber`

Local proof that the method works:

- a throwaway test file at `/private/tmp/gnosis-dmg-icon-test-2.dmg` showed the custom icon in Finder
- `GetFileInfo` showed the DMG with the custom-icon flag:
  - `attributes: avbstClinmedz`

Transport lesson that should not be relearned:

- a raw downloaded `.dmg` from GitHub Releases lost the custom Finder icon metadata
- a mac-created `.zip` containing the patched DMG preserved the icon when extracted with macOS tools
- command-line `unzip` did **not** preserve the icon
- Archive Utility / Finder / `ditto -x -k` preserved it

Git hygiene:

- the raw Icon Composer package folder should not be committed
- `.gitignore` now ignores:
  - `src-tauri/icons/*.icon/`

If continuing DMG icon work later:

1. Inspect `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/apply-dmg-file-icon.sh`
2. Inspect `/Users/hans/Desktop/GnosisTMS/src-tauri/icons/mac icon-iOS-Default-1024x1024@1x.png`
3. Inspect `/Users/hans/Desktop/GnosisTMS/.github/workflows/release-tauri.yml`
4. If needed, rerun a local proof test against a copied DMG:
   - `bash src-tauri/dmg/apply-dmg-file-icon.sh /tmp/test.dmg 'src-tauri/icons/mac icon-iOS-Default-1024x1024@1x.png'`
   - `xcrun GetFileInfo /tmp/test.dmg`
5. Then cut a new release tag and verify the downloaded GitHub Release DMG in Finder

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
  - result: succeeded
  - url: `https://github.com/gnosistms/Gnosis-TMS-tauri-app/actions/runs/23904153754`
- `v0.1.4`
  - run id: `23907852874`
  - result: succeeded
- `v0.1.5`
  - run id: `23923310661`
  - result: succeeded, but the raw downloaded mac `.dmg` still lost its Finder icon
  - url: `https://github.com/gnosistms/Gnosis-TMS-tauri-app/actions/runs/23923310661`
  - lesson: publish a zipped DMG for mac downloads instead of the raw `.dmg`
- `v0.1.6`
  - run id: `23931811773`
  - result: succeeded
  - url: `https://github.com/gnosistms/Gnosis-TMS-tauri-app/actions/runs/23931811773`
  - note: this is the first release where GitHub-hosted mac downloads are zipped DMGs so the extracted `.dmg` keeps its custom Finder icon
- `v0.1.7`
  - run id: `23934715648`
  - result: succeeded
  - url: `https://github.com/gnosistms/Gnosis-TMS-tauri-app/actions/runs/23934715648`
  - note: includes updated DMG background assets, but mounted volume icon still square
- `v0.1.8`
  - run id: `23936264104`
  - result: succeeded
  - url: `https://github.com/gnosistms/Gnosis-TMS-tauri-app/actions/runs/23936264104`
  - note: includes the rounded mounted volume icon fix; does **not** include the later local-only `background.png` resize/`pHYs` cleanup
- `v0.1.9`
  - run id: `23937601172`
  - result: succeeded
  - url: `https://github.com/gnosistms/Gnosis-TMS-tauri-app/actions/runs/23937601172`
  - note: includes the corrected `660x400` PNG background, but the newer local TIFF DMG background test came after this release

## If continuing in a fresh thread

Start here:

1. Read this file.
2. Check the current release run status:
   - `gh run view 23923310661`
3. If needed, inspect the release workflow:
   - `/Users/hans/Desktop/GnosisTMS/.github/workflows/release-tauri.yml`
4. If the run failed, inspect logs and patch the workflow or signing/notarization setup.
5. If the run succeeded, verify:
   - GitHub Release assets exist
   - `latest.json` is present on the release
   - mac downloaded app no longer shows the “damaged / move to trash” Gatekeeper warning
   - downloaded `.dmg` file itself now shows the custom Finder icon
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
