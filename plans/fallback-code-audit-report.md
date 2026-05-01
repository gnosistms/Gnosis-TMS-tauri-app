# Fallback-Code Audit Report

Date: 2026-05-01

## Summary

This audit looked for fallback, legacy, and alternate-path code that is still reachable by imports or runtime branches, and therefore is not caught by Knip-style unused-code detection.

No code was removed.

Knip reports no static unused files, exports, or dependencies in the current working tree:

- `npm run audit:unused`: passed with no findings

The main audit findings are reachable-but-inactive or product-invisible paths:

- the GitHub App Auth Test screen and actions are wired but have no normal navigation route
- the old manual editor virtualizer path is bypassed for virtualized editor lists because the TanStack virtualizer flag is currently `true`
- glossary visible-layout reconciliation is disabled by a fixed `false` policy flag
- editor regression fixture/debug code is dev/test-oriented and inactive in normal production startup
- browser/localStorage fallback storage is inactive in the packaged Tauri app when the store plugin is available
- download redesign preview files are not part of the app build and now appear to be archive/design artifacts

## Commands Run

- `git status --short`
- `npm run audit:unused`
- `rg` searches for:
  - `fallback`
  - `legacy`
  - `compat`
  - `deprecated`
  - `temporary`
  - `TODO remove`
  - `remove later`
  - `feature flag`
  - `dev only`
  - `mock`
  - `preview`
  - `USE_`
  - `ENABLE_`
  - `DISABLE_`
  - fixed boolean constants
  - `if (false)` / `if (true)`
  - `import.meta.env`
  - `cfg(...)`
- targeted `rg` checks for:
  - `githubAppTest`
  - `EDITOR_USES_TANSTACK_VIRTUALIZER`
  - `EDITOR_RECONCILES_GLOSSARY_VISIBLE_LAYOUT`
  - `__gnosisDebug`
  - `editor-regression`
  - `MIGRATION_KEY`
  - `LEGACY_KEY_PREFIX`
  - `downloads-redesign`

## High Confidence Candidates

### 1. Download Redesign Preview Files

Status: unused by the current app build, likely design archive.

Files:

- `previews/downloads-redesign/index.html`
- `previews/downloads-redesign/option-1-utility.html`
- `previews/downloads-redesign/option-2-premium.html`
- `previews/downloads-redesign/option-3-minimal.html`
- `previews/downloads-redesign/option-4-editorial.html`
- `previews/downloads-redesign/option-5-centered.html`
- `previews/downloads-redesign/option-6-split-simple.html`
- `previews/downloads-redesign/option-7-release.html`
- `previews/downloads-redesign/option-8-sidebar.html`
- `previews/downloads-redesign/shared.css`

Evidence:

- The live downloads page has already been promoted elsewhere.
- `rg "downloads-redesign|option-2-premium"` only finds links within the preview directory and references in the previous unused-code report.
- These files are not imported by the Tauri app or Vite entry point.

Recommendation:

- Remove in a separate cleanup if we do not want to keep design archives in the repo.
- If we want to keep design history, move it under a clearly named archive/docs location.

## Medium Confidence Candidates

### 2. GitHub App Auth Test Screen And UI Actions

Status: wired, but not reachable through normal app navigation.

Files:

- `src-ui/screens/github-app-test.js`
- `src-ui/app/github-app-test-flow.js`
- `src-ui/app/actions/github-app-test-actions.js`
- CSS selectors in `src-ui/styles/content.css` and `src-ui/styles/responsive.css`
- render entry in `src-ui/main.js`

Evidence:

- `src-ui/main.js:108` includes a `githubAppTest` screen renderer.
- `src-ui/main.js:121` includes a title for `githubAppTest`.
- `src-ui/app/action-dispatcher.js` imports GitHub App test actions.
- `src-ui/app/offline-policy.js` includes GitHub App test actions.
- No normal navigation action, URL route, startup state, or visible nav item sets `state.screen = "githubAppTest"`.
- Targeted searches found no `data-nav="githubAppTest"` or equivalent route.

Important nuance:

- This is not fully dead code. `src-ui/main.js:669-670` still registers the GitHub App test listener and calls `loadGithubAppTestConfig(render)` during normal bootstrap.
- The native commands are still registered.
- The screen/actions appear product-invisible rather than statically unused.

Recommendation:

- Decide whether the GitHub App Auth Test screen is still a supported diagnostic page.
- If yes, make access explicit, probably dev-only or debug-only.
- If no, remove the screen, actions, styles, state, bootstrap config load, listener registration, and native test command surface together.

### 3. Old Manual Editor Virtualizer Path

Status: fallback engine bypassed for virtualized editor lists under the current policy.

Files:

- `src-ui/app/editor-scroll-policy.js`
- `src-ui/app/editor-virtualization.js`
- `src-ui/app/editor-virtual-list.js`

Evidence:

- `src-ui/app/editor-scroll-policy.js:4` sets `EDITOR_USES_TANSTACK_VIRTUALIZER = true`.
- `src-ui/app/editor-virtualization.js:414-427` returns early with `createEditorVirtualListController(...)` when virtualization is active.
- `src-ui/app/editor-virtual-list.js:268-285` only returns `null` when required DOM elements or the row-height cache are invalid. Those same prerequisites are already checked by `shouldVirtualize` before the TanStack controller is created.
- Therefore, for normal virtualized editor lists, the large manual virtualizer implementation after `src-ui/app/editor-virtualization.js:430` is not expected to run.

Important nuance:

- Do not remove `initializeEditorVirtualization` wholesale. The post-TanStack code also handles non-virtualized/small-list setup and controller plumbing.
- This needs a careful split: isolate the manual virtualized engine from the still-needed small-list behavior.
- This area is high-risk because of the repository virtualization rules in `AGENTS.md`.

Recommendation:

- Treat this as a targeted refactor, not a deletion pass.
- First separate the small-list/non-virtualized controller behavior from the old manual virtualized engine.
- Then remove only the manual virtualized branch after confirming large editor lists still use TanStack and small lists still preserve focus, image sizing, glossary sync, and scroll behavior.

### 4. Disabled Glossary Visible-Layout Reconciliation Branch

Status: inactive under the current policy.

Files:

- `src-ui/app/editor-scroll-policy.js`
- `src-ui/app/editor-virtualization.js`
- `src-ui/app/editor-virtual-list.js`

Evidence:

- `src-ui/app/editor-scroll-policy.js:2` sets `EDITOR_RECONCILES_GLOSSARY_VISIBLE_LAYOUT = false`.
- `src-ui/app/editor-virtual-list.js:595` explicitly skips layout reconciliation when the flag is false.
- `src-ui/app/editor-virtualization.js:413` reads the same false value for the older controller path.

Recommendation:

- Decide whether visible glossary sync is ever supposed to trigger layout reconciliation.
- If the intended current behavior is permanently "do not reconcile on glossary visible sync", remove the true branch and the policy flag.
- Because this touches editor layout and virtualization, verify scroll stability and row-height reconciliation before removal.

### 5. Editor Regression Fixture And Debug Harness

Status: inactive in normal production startup; useful for dev/manual testing.

Files:

- `src-ui/app/dev-runtime-flags.js`
- `src-ui/app/editor-regression-fixture.js`
- fixture branches in `src-ui/app/editor-row-structure-flow.js`
- debug API in `src-ui/main.js`

Evidence:

- `src-ui/app/dev-runtime-flags.js:45-52` returns no fixture unless `import.meta.env.DEV === true`.
- `src-ui/main.js:659-663` mounts the editor fixture only when dev runtime flags provide one.
- `src-ui/app/editor-row-structure-flow.js:81` and related branches handle `isEditorRegressionFixtureState(state)`.
- `src-ui/main.js:516-651` exposes `window.__gnosisDebug` unconditionally, including fixture helpers.

Recommendation:

- Keep if we still use these APIs for regression testing and manual debugging.
- If we want production builds cleaner, consider gating `window.__gnosisDebug` and fixture-only helpers behind `import.meta.env.DEV`.
- Do not remove until editor regression/debug workflows are replaced.

## Low Confidence / Keep Unless Separately Reviewed

### 6. Persistent Store Legacy Migration And Browser Fallback

Status: inactive or one-time in the packaged app, but probably intentional.

File:

- `src-ui/app/persistent-store.js`

Evidence:

- `src-tauri/src/lib.rs` initializes the Tauri store plugin, so `window.__TAURI__.store.load` should exist in the packaged app.
- `src-ui/app/persistent-store.js:101-107` falls back to legacy localStorage/memory only when the store loader is unavailable.
- `src-ui/app/persistent-store.js:112-127` migrates legacy localStorage entries only until `MIGRATION_KEY` is present.

Recommendation:

- Keep for now unless we are comfortable dropping browser-mode support and one-time migration for older installs.
- If removed later, first confirm all supported installs have migrated past `__gnosis_persistent_store_migrated_v1`.

### 7. Glossary Broker Route-Unavailable Fallback

Status: likely rare or obsolete if the broker routes are now deployed, but not safe to remove without service confirmation.

File:

- `src-ui/app/glossary-repo-flow.js`

Evidence:

- `src-ui/app/glossary-repo-flow.js:25-37` detects missing `/gnosis-glossaries` broker routes.
- `src-ui/app/glossary-repo-flow.js:621-655` falls back to local/metadata-backed glossary behavior if those routes are unavailable.

Recommendation:

- Confirm the production broker always supports glossary routes.
- If confirmed, this can become a medium-confidence removal candidate.
- Until then, keep it as a compatibility path for staged broker deployments or older environments.

### 8. Team AI Cached/Local Fallbacks

Status: rare path, but intentional resilience behavior.

File:

- `src-ui/app/team-ai-flow.js`

Evidence:

- `src-ui/app/team-ai-flow.js:345-354` uses the last known team AI settings when broker connectivity fails.
- `src-ui/app/team-ai-flow.js:518-522` allows an owner local API key fallback if broker-issued shared secrets are unavailable.

Recommendation:

- Keep unless the product decision is to require broker-backed team AI settings in all online/offline states.

### 9. Updater Compatible-Release Fallback

Status: rare path, but intentional release/update behavior.

File:

- `src-tauri/src/updater.rs`

Evidence:

- `src-tauri/src/updater.rs:64-66` disables update checks in debug builds.
- `src-tauri/src/updater.rs:339-354` falls back to older compatible GitHub releases when the latest release does not support the current platform.

Recommendation:

- Keep. This is not old fallback code; it supports staggered platform releases.

### 10. Broker Environment Override Fallback

Status: current production behavior uses the bundled non-secret broker URL when the env var is absent.

Files:

- `src-tauri/src/broker.rs`
- `src-tauri/src/insecure_github_app_config.rs`

Evidence:

- `src-tauri/src/broker.rs:10-15` uses `GITHUB_APP_BROKER_BASE_URL` if present and otherwise falls back to `INSECURE_GITHUB_APP_BROKER_BASE_URL`.
- `src-tauri/src/insecure_github_app_config.rs:1-9` documents this as an intentional non-secret production default.

Recommendation:

- Keep. Despite the function name, this is not unused fallback under the current packaged app configuration.

## Not Classified As Unused

### Non-OpenAI AI Providers

Status: not unused in current code.

Evidence:

- `src-ui/app/ai-provider-config.js:3` still exposes `["openai", "claude", "deepseek", "gemini"]`.
- Rust provider dispatch still supports all four providers.

Recommendation:

- If the product decision is truly "OpenAI only for now", that should be a separate feature-scope change. It is not current-configuration dead code because the UI still exposes the other providers.

### Legacy TMX Parsing

Status: keep.

Evidence:

- `src-tauri/src/glossary_storage.rs` has tests for legacy TMX without Gnosis props.

Recommendation:

- Keep unless we decide to stop importing older TMX files.

### Project Fallback Conflict Recovery

Status: keep.

Evidence:

- The project page exposes recovery for unresolved repo conflicts.
- This is rare recovery behavior, not obsolete fallback code.

Recommendation:

- Keep unless we replace the recovery workflow.

## Recommended Next Steps

1. Product decision: keep or remove `previews/downloads-redesign/`.
2. Product/diagnostic decision: keep, hide, or remove the GitHub App Auth Test screen.
3. Engineering decision: whether to refactor out the old manual virtualized editor engine now that TanStack virtualization is the configured path.
4. Engineering decision: whether `EDITOR_RECONCILES_GLOSSARY_VISIBLE_LAYOUT = false` is permanent.
5. If removing editor virtualization fallback code, do it separately and verify:
   - smooth scrolling
   - no blank gaps
   - spacer heights
   - active row focus
   - textarea and image-driven height reconciliation
6. If removing storage migration fallback, first confirm no supported installs still need localStorage migration.

