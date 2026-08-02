# Sentry Unresolved-Issue Handling Plan — 2026-08-01

**Organization / project:** `gnosis-tms` / `javascript`
**Snapshot date:** 2026-08-01
**Current release represented in the newest events:** `gnosis-tms@0.8.80`
**Scope:** 30 unresolved Sentry groups, reduced to four fix tracks, one investigation
track, already-fixed cleanup, and expected/external-noise cleanup.

Related plans and prior analysis:

- [`sentry-unresolved-cleanup-2026-07-08-plan.md`](sentry-unresolved-cleanup-2026-07-08-plan.md)
- [`sentry-code-review-2026-07-23.md`](sentry-code-review-2026-07-23.md)
- [`sentry-index-lock-and-store-fixes-2026-07-23.md`](sentry-index-lock-and-store-fixes-2026-07-23.md)

> Sentry's `userCount` is currently not a useful prioritization signal because the app
> does not set a Sentry user. Use `environment`, `release`, `install_id`, event count,
> recency, and whether the operation blocks user work. Keep installation identifiers
> out of committed fixtures and plan updates.

## Goals

1. Fix current, actionable product defects without conflating them with external
   outages or expected control flow.
2. Recover cleanly from interrupted local repository bootstrap and incomplete
   migrations.
3. Reduce Sentry noise so new production regressions remain visible.
4. Resolve already-fixed and stale groups only after verifying their last affected
   release.
5. Ship focused changes with regression coverage, then resolve fix groups in the
   release that contains the fixes.

## Non-goals

- Do not change product permissions merely to suppress a permission error.
- Do not disable user actions while background synchronization is running.
- Do not bypass the shared repo-write/query architecture.
- Do not report expected cancellation, validation, offline, authentication-expiry,
  permission-denial, or conflict states as product defects.
- Do not store Sentry access tokens in the repository, plans, shell history files, or
  test fixtures. Rotate the token used for this triage before execution begins.

## Disposition Snapshot

| Disposition | Sentry groups | Planned handling |
|---|---|---|
| Fix: project Git authentication | `27`, `28` | Treat as one production sync defect; verify token injection on fetch and pull |
| Fix: metadata bootstrap recovery | `23`, `24`, `25`, `G`, `26` | Treat as one cascading failure rooted in an incomplete/concurrent clone |
| Fix: image-path migration completion | `1X` | Repair resolvable paths once and commit a durable manual-repair report for unresolved rows |
| Fix: development listener crash | `22` | Guard Tauri event registration in browser-only development |
| Investigate before fixing | `17`, `Z`, `1V` | Measure/verify; fix only if the operation is actually stuck or the failure recurs |
| Already fixed; verify then resolve | `1H`, `1T`, `1Q`, `5` | Confirm no events after the release containing `a3f3dc87` |
| Expected/external; resolve or filter | `29`, `1R`, `1S`, `1M`, `1G`, `1J`, `20`, `1Y`, `1K`, `1P`, `1N`, `21`, `1W`, `1Z` | Resolve stale groups; add only missing reporting classifications |

## Execution Rules

- Update this plan as each work package moves from investigation to implementation.
- Use one focused commit per logical change. Do not mix Sentry status mutations with
  unrelated source changes.
- Before every Sentry bulk update, issue the equivalent read-only query and verify the
  exact group IDs returned.
- Never resolve a fix group merely because a patch exists locally. Resolve it in the
  release that actually ships the fix, then monitor for recurrence.
- Preserve glossary/QA-list parity wherever a shared repo-resource behavior changes.
- Run backend Git work through the existing bundled-Git and repo-lock helpers.

---

## Phase 0 — Access Safety and Baseline

- [ ] Revoke/rotate the token used during the 2026-08-01 triage.
- [ ] If API access is still needed, create a short-lived least-privilege token and
  provide it only through an ephemeral environment variable or approved connector.
- [ ] Re-fetch the 30 unresolved groups immediately before implementation and record,
  outside the repository, each group's ID, count, latest event time, environment,
  release, and scrubbed `install_id` classification.
- [ ] Confirm `0.8.80` is still the newest published release before using it as the
  regression baseline.
- [ ] Check for events newer than this plan. Newly recurring production events may
  change the priority order below.

**Exit criterion:** the working list is current, the exposed token is invalid, and no
credential has been written to the worktree.

## Phase 1 — Close Already-Fixed Groups

Groups: `JAVASCRIPT-1H`, `JAVASCRIPT-1T`, `JAVASCRIPT-1Q`, `JAVASCRIPT-5`.

Commit `a3f3dc87` added shared Git serialization/stale-lock recovery, repaired
persistent-store reload behavior, and raised the `repoMaintenance` overdue threshold.

- [ ] Identify the first release containing `a3f3dc87`.
- [ ] Verify each group's latest event predates that release; inspect all environments,
  not just the latest event.
- [ ] If a group has a post-fix event, remove it from this phase and reopen its root-cause
  investigation.
- [ ] Resolve groups with no post-fix events as already fixed.
- [ ] Add a short Sentry activity note naming the fixing commit/release; do not include
  local paths or installation IDs.

**Exit criterion:** all four groups are either resolved with evidence or promoted back
to an active investigation.

## Phase 2 — Fix the Browser-Development Listener Crash

Group: `JAVASCRIPT-22` (`listenForEvent is not a function`, 4,115 development events
on `0.8.80`).

Likely source:

- `src-ui/app/project-transfer-flow.js`
- `src-ui/app/runtime.js`
- `src-ui/app/project-transfer-flow.test.js`

Implementation:

- [ ] Add a regression test that runs listener registration with no Tauri event API.
- [ ] Make `registerProjectTransferListeners` treat an unavailable listener as the
  supported browser-development case and return without marking listeners registered.
- [ ] Preserve normal Tauri registration, single-registration, and recovery behavior.
- [ ] Verify listener-registration rejection can be retried and does not leave a stale
  promise or registered flag.
- [ ] Confirm first-run crash reporting no longer emits this error during `npm run dev`.

Verification:

- [ ] Run the focused project-transfer tests.
- [ ] Run `npm test`.
- [ ] Start the browser-only development server and verify a clean initial load.
- [ ] Run a Tauri development smoke test to ensure progress events still register.

**Release/Sentry:** ship as a focused frontend fix and resolve `22` in that release.
Because this is development-only, it should not delay a production hotfix for Phases 3
or 4.

## Phase 3 — Fix Project Git Authentication on Fetch/Pull

Groups: `JAVASCRIPT-27` and `JAVASCRIPT-28` (production `0.8.80`, same installation,
`could not read Username for 'https://github.com': terminal prompts disabled`).

Likely source:

- `src-ui/app/editor-background-sync.js`
- `src-ui/app/runtime.js` session refresh path
- `src-tauri/src/project_repo_sync.rs`
- `src-tauri/src/repo_sync_shared.rs`
- broker/installation-token loading helpers

Investigation:

- [ ] Pull the complete scrubbed events and confirm whether fetch and pull failed in one
  operation or separate attempts.
- [ ] Reproduce with a private repository and an expired, refreshed, and valid broker
  session. Never log the token or authenticated URL.
- [ ] Trace `requireBrokerSession()` through the invoke retry and
  `load_git_transport_token()` to `GitTransportAuth::from_token()`.
- [ ] Verify fetch, pull/rebase, push, clone, and retry all receive the same non-empty
  transport authentication configuration.
- [ ] Determine whether authentication was absent, stale after a session refresh, or
  lost on a specific Git subprocess path.

Implementation:

- [ ] Add a regression test at the lowest shared Git-command/auth boundary that can
  assert authenticated configuration without exposing a credential.
- [ ] Fix the shared boundary if multiple commands are affected; avoid one-off fixes in
  fetch or pull call sites.
- [ ] Preserve `GIT_TERMINAL_PROMPT=0` and prevent credentials from appearing in command
  arguments, errors, process listings, or Sentry messages.
- [ ] Return `AUTH_REQUIRED:` when credentials are genuinely expired or unavailable so
  the existing frontend refresh/sign-in flow handles the condition.
- [ ] Classify ordinary connectivity failures separately from authentication failures.

Verification:

- [ ] Run focused Rust Git/auth tests and `cargo test`.
- [ ] Test fetch/pull against a private repository with a valid session.
- [ ] Test expired-session refresh and explicit sign-in recovery.
- [ ] Test offline behavior and confirm it does not become an authentication prompt.
- [ ] Smoke-test push as well as fetch/pull to detect shared-boundary regressions.

**Release/Sentry:** resolve both groups in the fixing release under one root-cause note.
Consider a shared fingerprint only if separate fetch/pull groups continue to provide no
distinct diagnostic value.

## Phase 4 — Make Team-Metadata Bootstrap Atomic and Recoverable

Groups: `JAVASCRIPT-23`, `24`, `25`, `G`, and `26` (one production cascade on
`0.8.77`).

Likely source:

- `src-tauri/src/team_metadata_local.rs`
- `src-tauri/src/team_metadata_local/repo.rs`
- shared per-repository lock helpers in `src-tauri/src/repo_sync_shared.rs`
- frontend callers that may launch ensure/sync concurrently

Required invariants:

1. Only one ensure/clone/sync operation may initialize a given installation's metadata
   checkout at a time.
2. A failed clone must not leave a directory that future calls mistake for a usable repo.
3. Existing valid checkouts must never be deleted merely because a concurrent caller
   observed an intermediate state.
4. Recovery must be idempotent after app termination, disk-full errors, and Git failure.

Implementation:

- [ ] Write tests for concurrent ensure calls, concurrent ensure+sync, clone failure
  after directory creation, and startup with an incomplete destination.
- [ ] Acquire the existing per-repository synchronization lock across validation,
  initialization, and publication of the checkout.
- [ ] Clone into a uniquely named sibling staging directory, validate it as the expected
  repository, then atomically rename/publish it to the final path.
- [ ] On failure, clean only the staging directory created by that operation. Never
  recursively remove an unresolved or pre-existing final path.
- [ ] If the final path exists but is invalid/incomplete, classify its state explicitly
  and route it through a safe repair path rather than attempting another clone into it.
- [ ] Ensure list commands wait for or report bootstrap progress instead of producing
  cascading "repo is not available yet" defect events.
- [ ] Review project, glossary, and QA-list discovery callers for duplicate concurrent
  bootstrap requests; deduplicate at the backend even if frontend callers are also
  consolidated.

Verification:

- [ ] Run focused metadata-repo tests and `cargo test`.
- [ ] Test a clean first bootstrap, interrupted bootstrap, retry, and normal subsequent
  pull on macOS and Windows Git path conventions.
- [ ] Verify project, glossary, and QA-list discovery all recover after one forced clone
  failure.

**Release/Sentry:** resolve the five cascading groups in the fixing release with one
root-cause note. Keep separate fingerprints only where the downstream errors identify a
distinct recovery failure.

## Phase 5 — Correct Image-Path Migration Completion Semantics

Group: `JAVASCRIPT-1X` (six production events on `0.8.79`).

Likely source:

- `src-tauri/src/repo_migrations.rs`
- migration tests adjacent to the repository migration code
- any UI that presents pending or failed layout migrations

Implementation:

- [ ] Add fixtures for fully resolvable, partially resolvable, and permanently missing
  uploaded-image paths.
- [x] Assert that a partially resolved migration records the attempt once and writes a
  durable report naming affected row files.
- [ ] Make successful rewrites idempotent so retrying after partial progress is safe.
- [x] Write a structured repository report distinguishing unresolved source paths from
  unreadable row JSON without including document contents.
- [x] Record the one-time migration after committing the report, avoiding a permanent
  sync loop with repeated commits or repeated Sentry events.
- [x] Make the committed report the durable manual-repair queue when a file is
  permanently unavailable.
- [ ] Confirm the migration does not run while the worktree is dirty and retries on the
  next safe sync as designed.

Verification:

- [ ] Run focused migration tests and `cargo test`.
- [ ] Run the migration twice on each fixture and verify no duplicate changes.
- [ ] Inspect generated commits and metadata markers.
- [ ] Verify repaired image references display correctly in the editor.

**Release/Sentry:** resolve `1X` in the fixing release only after a production-equivalent
repository migrates without unresolved paths.

## Phase 6 — Investigate Operational Warnings

### `JAVASCRIPT-17` — `repo_write_overdue: remoteSync`

- [ ] Inspect several events across releases and installations, not only the newest one.
- [ ] Determine whether operations eventually completed and capture scrubbed duration,
  queue wait, repository-size bucket, and terminal status.
- [ ] If sync is stuck, fix the blocking Git/network path and add timeout/cancellation
  behavior without blocking the Tauri IPC path.
- [ ] If sync is merely slow, replace the two-minute defect signal with useful duration
  telemetry or a better threshold/fingerprint.

### `JAVASCRIPT-Z` — `repo_write_overdue: localEditorWrite`

- [ ] Separate development-only events from production events.
- [ ] Correlate with the Git serialization fix in `a3f3dc87`.
- [ ] Fix only if current production editor writes still exceed the threshold or fail to
  complete; otherwise resolve as stale/development noise.

### `JAVASCRIPT-1V` — updater response decoding

- [ ] Verify whether any event occurred after `0.8.64`.
- [ ] If none, resolve as a transient updater/download failure.
- [ ] If recurring, add bounded retry and a scrubbed error category while retaining a
  clear user-facing retry path.

**Exit criterion:** each group has an evidence-backed fix, telemetry adjustment, or
resolve decision. “Overdue” alone is not treated as proof of data loss.

## Phase 7 — Filter Expected and External Failures

Groups:

- Connectivity/upstream: `29`, `1R`, `1S`, `1M`, `1G`, `1J`, `20`, `1Y`.
- Permission/control flow: `1K`, `1P`, `1N`.
- Development/validation/fallback: `21`, `1W`, `1Z`.

Work:

- [ ] Verify the latest release/environment for every group before changing status.
- [ ] Resolve stale GitHub/OpenAI service failures; retain them as logs/metrics where
  operational visibility is useful, not unresolved product defects.
- [ ] Extend `classifySyncError` only for missing genuine connectivity signatures such
  as a Git transport "empty reply". Do not let the rule absorb authentication errors.
- [ ] Extend `resolveCommandFailureReport` tests so expected permission denials and
  malformed SRT validation do not become error groups.
- [ ] Record successful AI batch-to-single-row fallback as a breadcrumb/metric rather
  than an issue, while preserving the terminal AI failure if fallback also fails.
- [ ] Keep GitHub 5xx reporting at warning level with stable per-command fingerprints,
  or move it to metrics if unresolved warning groups remain noisy.
- [ ] Resolve development-only repository-creation validation groups after confirming
  the UI already presents actionable feedback.

Likely frontend files:

- `src-ui/app/runtime.js`
- `src-ui/app/runtime-command-failure-report.test.js`
- `src-ui/app/sync-error.js`
- `src-ui/app/sync-error.test.js`
- AI review fallback telemetry call site and tests

**Exit criterion:** expected/external conditions remain visible to users and operators
without appearing as unresolved product defects.

## Phase 8 — Integrated Verification and Release

- [ ] Review the final diff for token, authenticated-URL, local-path, document-content,
  and installation-ID leakage.
- [ ] Run focused tests after each work package.
- [ ] Run the complete frontend suite with `npm test`.
- [ ] Run the complete Rust suite with `cargo test` from `src-tauri/`.
- [ ] Run browser integration tests for browser-development listener and reporting
  changes where applicable.
- [ ] Run Tauri smoke tests for private-repo sync, metadata bootstrap/recovery, editor
  save, and updater behavior.
- [ ] Test Windows-specific Git locking/path behavior before closing backend Git work.
- [ ] Use small, focused commits and update this plan with commit IDs and test results.
- [ ] Publish a release according to the repository's release/updater discipline.

Recommended commit sequence:

1. Guard project-transfer listener registration.
2. Repair shared Git transport authentication.
3. Make metadata bootstrap atomic/recoverable.
4. Correct image migration completion and retry behavior.
5. Tune operational telemetry and expected-error classification.
6. Update plan evidence and release notes.

## Phase 9 — Sentry Close-Out and Monitoring

- [ ] Resolve code-fix groups in the release containing their fixes: `22`, `27`, `28`,
  `23`, `24`, `25`, `G`, `26`, and `1X`.
- [ ] Resolve investigation groups only after their Phase 6 decision is complete.
- [ ] Resolve stale/external groups individually or in carefully verified batches.
- [ ] Add concise activity notes with root cause, fixing release, and verification; do
  not paste stack traces containing paths or identifiers.
- [ ] Monitor the fixing release for at least one normal sync/bootstrap/migration cycle
  across active production installations.
- [ ] Reopen automatically recurring groups and compare their release tag with the
  fixing release before assuming the same root cause.
- [ ] Re-fetch the unresolved list and confirm only intentionally open investigations
  remain.

## Completion Criteria

This plan is complete when:

1. The four fix tracks have shipped with regression coverage.
2. Already-fixed groups are resolved with release evidence.
3. Every operational warning has a documented fix/tune/resolve decision.
4. Expected and external failures no longer obscure actionable production defects.
5. The post-release Sentry list contains no unexplained current-release production
   errors from this snapshot.
6. The exposed triage token has been revoked and no credential exists in the worktree.

## Implementation Log — 2026-08-01

### Completed locally

- Added a browser-development guard for project-transfer Tauri listener registration;
  browser-only Vite startup no longer calls an unavailable event API, and later Tauri
  registration remains retryable (`JAVASCRIPT-22`).
- Classified non-interactive GitHub credential rejection as invalid authentication so
  the invoke wrapper refreshes the broker session and retries the entire sync command
  with a fresh installation transport token (`JAVASCRIPT-27`/`28`).
- Serialized team-metadata ensure/clone and reader access on the shared repository lock;
  clones now use a unique validated sibling staging directory and atomically publish
  without replacing an existing checkout (`JAVASCRIPT-23`/`24`/`25`/`G`/`26`).
- Changed the 0.8.75 image repair so resolvable paths are committed idempotently while
  unresolved paths or unreadable rows produce a committed
  `.gtms/image-path-repair.json` manual-repair report. The one-time migration then
  completes, avoiding a permanent sync-failure loop (`JAVASCRIPT-1X`).
- Added review follow-ups: the final post-refresh command retry now passes through the
  telemetry boundary; interrupted metadata-clone staging directories older than 24
  hours are cleaned without touching active or unrelated paths; and repository-create
  422 filtering is limited to the known name-collision response.
- Converted repo-write overdue signals and successful AI batch fallback into Sentry
  breadcrumbs instead of standalone issue groups (`JAVASCRIPT-17`/`Z`/`1Z`).
- Added reporting classifications for GitHub empty responses, expected permission
  denials, malformed SRT input, temporary OpenAI outages, and repository-creation 422
  validation (`29`, `1K`, `1P`, `1N`, `1W`, `20`, `1Y`, `21`).

### Verification completed

- Full frontend test suite: `npm test` — 1,870 app/screen tests and 5 workflow tests
  passed.
- Full Rust test suite: `cargo test --manifest-path src-tauri/Cargo.toml` — 526 passed,
  1 intentionally ignored, 0 failed.
- Review-focused frontend tests — 16 passed.
- Focused metadata and migration Rust tests — 30 passed.
- Rust formatting check and `git diff --check` — passed.
- ESLint on touched frontend files — 0 errors; one pre-existing unused-variable warning.

### Remaining external/release work

- The supplied Sentry token can read issues but received HTTP 403 for comments and
  status changes; attempted mutations did not take effect.
- The in-app browser reached the Sentry sign-in page, and no signed-in Chrome connection
  was available. Sentry cleanup therefore awaits an authenticated browser session or a
  token with issue-write scope.
- The exposed token still needs to be revoked/rotated by the account owner.
- New fix groups remain unresolved intentionally until these changes ship in a release.
- No release was cut from the current worktree because it contains substantial unrelated
  uncommitted changes on `codex/project-transfer`; publishing them together would violate
  scope and commit hygiene.
