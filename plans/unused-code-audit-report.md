# Unused Code Audit Report

Date: 2026-05-01

## Scope

This audit implements the evidence-gathering plan from `plans/unused-code-audit-plan.md`.

The cleanup pass has now been implemented. Knip currently reports no unused files, dependencies, or exports with the project configuration in `knip.json`.

## Commands Run

- `git status --short`
- `cargo check` from `src-tauri`
- `rustup component add clippy`
- `cargo clippy --all-targets --all-features` from `src-tauri`
- `npm ls --depth=0`
- `npx --no-install knip`
- `npx --yes knip`
- `npx --yes --cache /private/tmp/gnosis-npm-cache knip`
- `npx --yes --cache /private/tmp/gnosis-npm-cache knip@5`
- `npm install --save-dev knip@5 --cache /private/tmp/gnosis-npm-cache`
- `npm run audit:unused`
- `npm uninstall @tauri-apps/plugin-opener`
- `npm test`
- `cargo test` from `src-tauri`
- `npm run build`
- `rg` checks for Tauri commands, JS invokes, dependencies, preview files, and legacy markers
- a local Node script comparing `tauri::generate_handler!` registrations with frontend command calls

## Tool Results

### Rust

`cargo check` passed cleanly.

`cargo clippy --all-targets --all-features` passed but reported style and maintainability warnings. It did not identify compiler-proven unused Rust code.

The Clippy warnings are cleanup candidates, not unused-code removal candidates:

- `src-tauri/src/ai/providers/gemini.rs`: needless borrows
- `src-tauri/src/ai/mod.rs`: useless `format!`
- `src-tauri/src/glossary_repo_sync.rs`: type complexity and needless borrow
- `src-tauri/src/project_import/chapter_editor/git_conflicts.rs`: unnecessary lazy evaluations and redundant closure
- `src-tauri/src/project_import/chapter_editor/images.rs`: collapsible `if`
- `src-tauri/src/project_import/chapter_editor/row_fields.rs`: items after test module
- `src-tauri/src/project_import/chapter_import.rs`: manual `is_multiple_of`
- `src-tauri/src/project_repo_sync.rs`: type complexity
- `src-tauri/src/repo_sync_shared.rs`: needless borrow
- `src-tauri/src/team_metadata_local/repair.rs`: manual `contains`
- `src-tauri/src/updater.rs`: large enum variant
- `src-tauri/src/lib.rs`: needless return and needless borrows
- `src-tauri/src/team_ai.rs`: needless `as_bytes`

### JavaScript

`knip` now works locally.

Changes made:

- Added `knip@5.88.1` as a dev dependency.
- Added `knip.json`.
- Added `npm run audit:unused`.

Why Knip 5:

- The latest Knip 6 line expects Node `^20.19.0 || >=22.12.0`.
- This repo currently runs Node `v20.12.2`.
- Knip 5 runs successfully on the current runtime.

The configured command is:

```sh
npm run audit:unused
```

The command exits with code `1` when unused-code findings exist. That is expected behavior.

Current configured findings after cleanup:

- 0 unused files
- 0 unused npm dependencies
- 0 unused exports

The config uses `ignoreExportsUsedInFile: true` so the report focuses on exports that are not consumed anywhere, instead of reporting every function that is used internally but exported unnecessarily.

## Implementation Outcome

Removed the configured unused-code findings:

- Removed the unused npm dependency `@tauri-apps/plugin-opener`. The Rust `tauri-plugin-opener` integration remains in place.
- Removed the unused `.broker-stage3/*` files.
- Removed unused frontend files:
  - `src-ui/app/user-flow.js`
  - `src-ui/lib/data.js`
  - `src-ui/screens/translate-history-sidebar.js`
  - `src-ui/app/repo-creation.js`
- Removed unused Tauri command surfaces:
  - `ping`
  - `create_team_setup_draft`
  - `inspect_gtms_project_editor_repo_sync_state`
  - `rename_local_gtms_glossary_repo`
  - the unused remote GitHub metadata record command wrappers
- Removed Knip-reported unused frontend exports and their now-unused helper code.
- Updated `src-ui/app/runtime.js` so Node tests can import modules that statically import runtime helpers without requiring `document` at module load time.

Verification after cleanup:

- `npm run audit:unused`: passed with no findings
- `npm test`: passed, 705 tests
- `cargo check`: passed
- `cargo test`: passed, 137 tests
- `npm run build`: passed

`npm run build` still reports the existing Vite warning that `src-ui/app/translate-flow.js` is both statically and dynamically imported, so the dynamic import cannot create a separate chunk. That warning is not caused by the unused-code removals.

## Original Findings Removed

The sections below preserve the original evidence used for the cleanup. The listed removal candidates have now been removed unless they are explicitly listed under "False Positives To Keep" or "Not A Removal Finding".

### High Confidence After One Verification Pass

These have no frontend call sites found by `rg`, `invoke(...)`, `invokeCommand(...)`, or known command-wrapper patterns. They are registered as Tauri commands, so Rust sees them as used even if the UI never calls them.

1. `ping`
   - Definition: `src-tauri/src/lib.rs:140`
   - Registered in `tauri::generate_handler!`
   - No frontend call site found.
   - Likely old smoke-test command.
   - Recommended next step: remove `ping` and its handler registration, then run `cargo check` and `npm run build`.

2. `create_team_setup_draft`
   - Definition: `src-tauri/src/drafts.rs:39`
   - Registered in `tauri::generate_handler!`
   - No frontend call site found.
   - Writes `.gnosis-tms/team-setups/...` drafts and commits them, which appears unrelated to the current GitHub App team setup flow.
   - Recommended next step: confirm the draft-based setup path is abandoned, then remove `src-tauri/src/drafts.rs`, the module import, and the handler registration.

3. `inspect_gtms_project_editor_repo_sync_state`
   - Definition: `src-tauri/src/project_repo_sync.rs:195`
   - Registered in `tauri::generate_handler!`
   - No frontend call site found.
   - Current UI appears to use `list_project_repo_sync_states` and `reconcile_project_repo_sync_states`.
   - Recommended next step: verify no planned UI uses single-repo inspection, then remove the command wrapper and any now-private dead helper code that `cargo check` exposes.

4. `rename_local_gtms_glossary_repo`
   - Definition: `src-tauri/src/glossary_storage.rs:356`
   - Registered in `tauri::generate_handler!`
   - No frontend call site found.
   - Current glossary rename path appears to use `rename_gtms_glossary`.
   - Recommended next step: verify local-only glossary rename is obsolete, then remove the command wrapper and handler registration.

### Likely Obsolete, Needs Product/Architecture Confirmation

These remote metadata commands have no frontend call sites. They may be old API surfaces superseded by the local team metadata repo path, but they touch GitHub/broker metadata and should be removed only after confirming they are not intentionally kept for migration or recovery.

- `list_gnosis_project_metadata_records`
  - Definition: `src-tauri/src/github/repos.rs:71`
- `list_gnosis_glossary_metadata_records`
  - Definition: `src-tauri/src/github/repos.rs:91`
- `upsert_gnosis_project_metadata_record`
  - Definition: `src-tauri/src/github/repos.rs:129`
- `delete_gnosis_project_metadata_record`
  - Definition: `src-tauri/src/github/repos.rs:147`
- `upsert_gnosis_glossary_metadata_record`
  - Definition: `src-tauri/src/github/repos.rs:183`
- `delete_gnosis_glossary_metadata_record`
  - Definition: `src-tauri/src/github/repos.rs:201`

Recommended next step: confirm local metadata repo commands are now the only supported metadata path. If yes, remove these command wrappers, their imports/exports, and the handler registrations. Then run `cargo check` to find any now-unused input/response structs.

### Dependency Candidate

`@tauri-apps/plugin-opener` in `package.json` appears unused by frontend module imports.

- Dependency line: `package.json:24`
- Frontend opens URLs via `window.__TAURI__.opener` in `src-ui/app/runtime.js`.
- The Rust plugin is still used and should stay: `src-tauri/src/lib.rs:473` calls `tauri_plugin_opener::init()`.

Recommended next step: remove only the npm package with `npm uninstall @tauri-apps/plugin-opener`, keep the Rust crate, then run `npm run build`, `npm test`, and a Tauri dev smoke check for external links.

### Knip File Findings

`npm run audit:unused` currently reports these unused files:

- `.broker-stage3/authorization.js`
- `.broker-stage3/install-routes.js`
- `.broker-stage3/server.js`
- `.broker-stage3/team-metadata-repo.js`
- `src-ui/app/user-flow.js`
- `src-ui/lib/data.js`
- `src-ui/screens/translate-history-sidebar.js`

Recommended next step:

- Treat `.broker-stage3/*` as a product/archive decision.
- `src-ui/app/user-flow.js` appears to be an obsolete barrel module; verify no external docs or manual imports reference it, then remove.
- `src-ui/lib/data.js` appears to be old dummy/mock data; verify no preview page still expects it, then remove.
- `src-ui/screens/translate-history-sidebar.js` appears superseded by the current history pane/shared renderer; verify no planned sidebar fallback depends on it, then remove.

### Knip Export Findings

`npm run audit:unused` currently reports 44 unused exports. Many are likely "remove the `export` keyword" cleanups rather than full code deletions.

Highest-value export cleanup groups:

- Old write-coordinator observer/debug helpers:
  - `subscribeGlossaryWriteState`
  - `getGlossaryWriteState`
  - `glossaryWriteIsActive`
  - `glossaryWriteScopeIsActive`
  - `subscribeProjectWriteState`
  - `getProjectWriteState`
  - `projectWriteIsActive`
  - `projectWriteScopeIsActive`
- Legacy team storage/setup exports:
  - `loadStoredGithubAppTeams`
  - `saveStoredGithubAppTeams`
  - `mergeTeams`
  - `teamLeaveIntentKey`
  - `teamPermanentDeleteIntentKey`
- Editor helper exports that should be reviewed carefully before changing:
  - `patchMountedEditorRow`
  - `invalidateEditorVirtualizationLayout`
  - `insertEditorChapterRow`
  - `rowsWithEditorRowLifecycleState`
  - `updateEditorRowFieldValue`

Recommended next step:

- For each unused export, first decide whether the function itself is unused or only over-exported.
- Prefer removing `export` before deleting code when the function is still used inside its defining module.
- For editor/virtualization files, follow `AGENTS.md` and avoid behavior changes unless separately verified.

### Product Cleanup Candidate

The download-page redesign previews remain in `previews/downloads-redesign/`.

These were useful during design comparison, but the chosen design has been promoted to the live downloads page. The preview files are not referenced by the app build.

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

Recommended next step: decide whether previews should be kept as design archive. If not, remove the directory in a separate cleanup commit. This was intentionally left out of the unused-code cleanup because it is a product/design archive decision rather than a Knip finding.

## False Positives To Keep

These looked unused in the first Tauri command comparison but are actually used through wrappers, dynamic command strings, or runtime refresh paths.

- `insert_gtms_editor_row_before`
- `insert_gtms_editor_row_after`
  - Called through a ternary command name in `src-ui/app/editor-row-structure-flow.js`.
- `refresh_broker_auth_session`
  - Called through `rawInvoke` in `src-ui/app/runtime.js`.
- `export_gtms_chapter_file`
  - Called through `invokeCommand` in `src-ui/app/project-export-flow.js`.
- `export_gtms_glossary_to_tmx`
  - Called through `invokeCommand` in `src-ui/app/glossary-export-flow.js`.
- `leave_organization_for_installation`
  - Called directly in `src-ui/app/team-flow/actions.js`.
- `soft_delete_gtms_chapter`
- `restore_gtms_chapter`
- `permanently_delete_gtms_chapter`
  - Called through command descriptors in `src-ui/app/project-chapter-flow.js`.

## Not A Removal Finding

Large files are readability/refactor candidates, not unused-code evidence. Splitting them should be handled separately and conservatively, especially editor virtualization and row rendering code.

Examples from the size scan:

- `src-ui/app/ai-review-and-settings.test.js`: 3854 lines
- `src-tauri/src/glossary_storage.rs`: 2249 lines
- `src-ui/styles/translate.css`: 2198 lines
- `src-tauri/src/project_import/chapter_import.rs`: 2137 lines
- `src-ui/app/project-chapter-flow.js`: 1409 lines
- `src-ui/app/translate-flow.js`: 1375 lines
- `src-ui/app/editor-ai-assistant-flow.js`: 1370 lines
- `src-tauri/src/ai/mod.rs`: 1359 lines

## Remaining Cleanup Decisions

- Decide whether to delete `previews/downloads-redesign/`. Those files are not a Knip finding and are best handled as a separate design-archive cleanup.
- Consider the Clippy style findings separately from unused-code cleanup.
- The build still has the existing Vite mixed static/dynamic import warning for `src-ui/app/translate-flow.js`; that is a chunking/readability follow-up, not unused-code evidence.
