# Required Update Install Plan

## Problem

The app can show an `Update required` modal when repo sync detects data saved by a newer Gnosis TMS version. That path opens the UI prompt through `requireAppUpdate(...)`, but it does not run the native updater check first.

Native `install_app_update` currently expects a stored `PendingUpdate`, and that pending update is only populated by `check_for_app_update`. If the user clicks `Update now` from a required-update prompt that came from sync recovery, native install can fail with `No update is ready to install.` The UI then re-renders back to the same modal, which looks like the button did nothing.

## Goal

Make `Update now` work from every update prompt source:

- manual update check prompts
- required-update prompts from project repo sync
- required-update prompts from glossary repo sync
- required-update prompts from editor/background sync recovery

## Non-Goals

- Redesign release publishing.
- Change updater signing keys.
- Change required-version detection in project/glossary repos.
- Make required update prompts dismissible.

## Implementation Plan

### 1. Confirm the failure path

Add or update tests for the state where:

- `state.appUpdate.required === true`
- `state.appUpdate.promptVisible === true`
- no native `PendingUpdate` has been stored by `check_for_app_update`

Clicking or dispatching `install-app-update` should attempt to resolve and install an update instead of ending at `No update is ready to install.`

### 2. Pass the required version into native install

Update `src-ui/app/updater-flow.js` and the Tauri command signature for `install_app_update`.

When the UI calls native install, include the requested version when one is known:

- for required prompts, pass `state.appUpdate.version`
- for normal available prompts, pass `state.appUpdate.version` when present
- allow `null` only as a fallback for legacy or manual-check paths

This prevents required-update installs from accepting an older compatible release that still does not satisfy the repo's required app version.

### 3. Fix native install fallback

Update `src-tauri/src/updater.rs`.

Change `install_app_update` so it accepts an optional requested version and then:

1. Tries to take the stored `PendingUpdate`.
2. If one exists and it satisfies the requested version constraint, installs it.
3. If one exists but it does not satisfy the requested version constraint, discard it and resolve again.
4. If no usable pending update exists, resolve an update that satisfies the requested version.
5. If a compatible requested-version-or-newer update is available, installs that update.
6. If no compatible update satisfies the requested version, returns a clear user-facing error such as:
   - `Gnosis TMS {requiredVersion} is required, but it is not available for this platform yet.`
   - or the existing platform wait message with the required version included.

This keeps the manual-check path fast while making required-update prompts self-sufficient and version-correct.

Implementation notes:

- Add a small semantic version comparison helper in Rust, or reuse a crate already available through the Tauri dependency graph if practical.
- Treat prerelease/build metadata conservatively if support is unclear; current release tags are simple stable versions such as `0.3.1`.
- Prefer checking tag-specific `latest.json` for the requested version first, then newer compatible releases if needed.
- Do not fall back to an older release for a required-update prompt.

### 4. Improve UI install error visibility

Update `src-ui/app/updater-flow.js`.

When `installAppUpdate` fails:

- keep the modal open
- preserve `required: true` when the prompt is required
- show the native error clearly in the modal
- set a distinct visible failure state instead of returning to a visually unchanged `Update required` modal
- re-enable `Update now` only after the error has been rendered

Recommended behavior:

- while installing, `status: "installing"` and the primary button is disabled with `Installing...`
- on install failure, `status: "installError"` or another explicit install-failure status
- the modal title remains `Update required` or `Update available`
- an error paragraph appears directly above the actions, styled as an error
- the primary button label returns to `Update now` after the error is visible

### 5. Keep repeated clicks disabled during install

Verify the modal remains in the `Installing update` state while the native command is running.

The `Update now` button should not be clickable repeatedly until the native command resolves or fails.

### 6. Add tests

Add coverage for:

- required update install passes the required version to native install
- required update native install works without a prior manual update check
- required update install failure displays an error and keeps the prompt required
- normal available update install still works when `PendingUpdate` exists
- a pending update older than the requested version is rejected and refreshed
- no compatible update at or above the requested version returns a clear message instead of a no-op-looking prompt

Required test layers:

- Rust tests around updater fallback selection and requested-version filtering
- focused JS tests for `installAppUpdate` state transitions and error display
- existing updater-flow tests for current manual update behavior

If direct Tauri `Update` construction is difficult in Rust tests, extract the version-selection logic into small pure helpers and test those helpers directly. The fallback path should still have at least one native-side test proving an empty pending update does not immediately produce `No update is ready to install.`

### 7. Verify

Run:

```sh
cargo test
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/updater-flow.test.js src-ui/app/action-dispatcher.test.js
npm run build
```

If possible, also smoke test a release build by opening a required-update prompt without first using `Check for Updates`, then clicking `Update now`.

## Risk Notes

- The fallback install path performs network update resolution during `Update now`, so failure messages should distinguish no-compatible-update, network errors, and signature/install failures.
- Required update prompts may specify a required repo version that is newer than the latest compatible release for the user's platform. In that case the app should show a clear platform/wait message rather than looping or installing an older release.
- A manual update check may cache a pending update that is older than a later repo-required version. Required installs must validate the cached pending update before using it.
- Do not make required update prompts dismissible as part of this fix.
