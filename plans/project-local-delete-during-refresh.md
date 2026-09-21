# Local project removal during background refresh

Status: implemented and verified; preparing pull request and merge. Not released.

## Confirmed cause

The Delete action under deleted projects removes this computer's local copy;
it does not delete the GitHub repository. This differs from the first Delete
action, which soft-deletes an active project.

The renderer (`src-ui/screens/project-deleted-section.js`) deliberately permits
local removal while `projectsPage.isRefreshing` is true. Both
`permanentlyDeleteProject` and `confirmProjectPermanentDeletion` instead use
`areProjectLocalHardDeleteWritesDisabled`, which includes `isRefreshing`.

The opening handler then calls `setProjectDiscoveryState("error", ...)` for
the rejected action. `renderProjectsScreen` replaces the active project list
with the PROJECT LOAD FAILED card. The confirmation handler rejects the same
refresh condition inside the modal instead.

Reproduced against the actual JS functions with mocked Tauri IPC:

- Background refresh running, page write state idle, deleted project present.
- Delete button rendered enabled.
- Opening the dialog set discovery to error with the screenshot's exact text.
- No native command was invoked.
- Confirming an existing dialog under the same conditions also invoked no
  native command and showed the same message in the modal.

This path remains in main/release 0.8.117. PR #332 changed ordinary deletion's
errors, but did not change these two local-removal handlers.

## Proposed implementation

1. **Use one availability rule.** Make the local-removal page predicate depend
   on write submission state, not background refresh. Have the deleted-project
   renderer and both handlers use the same predicate; accept an explicit page
   state so renderer fixtures do not depend on global state. Keep the existing
   project-specific pending-lifecycle and resolution restrictions. Use a
   write-specific blocked message rather than telling users to wait for refresh.

2. **Keep action errors local.** In the opening handler, replace discovery-error
   writes for blocked/missing resources with operation notices. Catch asynchronous
   guard failures and return its promise for deterministic tests. In confirmation,
   keep validation and filesystem failures inside the existing dialog. Neither
   handler should alter a healthy discovery result or clear an unrelated genuine
   discovery failure. Do not change the generic error-card renderer.

3. **Make the same asynchronous operation safe to complete.** Capture the team,
   project, and modal instance; prevent duplicate confirmation before awaiting
   guards, and revalidate that the project is still deleted before invoking purge.
   After an await, do not reopen/reset another modal or apply an old team's data
   to the current team. Publish successful removal through a small team-scoped
   query-layer helper, using that team's cached snapshot rather than copying the
   currently visible global collections into the original team's cache. Retain
   the existing local-removal tombstone and persist the resulting team snapshot.
   Record removal only after native purge succeeds; failure keeps the project
   visible and allows retry.

4. **Preserve refresh and offline behavior.** Do not cancel a harmless discovery
   merely to remove a local copy. Incoming query snapshots already pass through
   the local-removal tombstone filter; test that behavior at whole-project level.
   Local removal must continue to work offline without remote mutation calls.

## Native sync review and scope boundary

The purge command runs `remove_dir_all` on a blocking worker and treats an absent
repository as success. The foreground local-delete path invokes it directly.
Commit `fe297f2e` deliberately removed repository queuing to fix an indefinitely
stuck Deleting dialog; do not casually reverse that change.

Ordinary soft deletion currently shares the repository queue with sync, retains
its pending lifecycle marker until the write settles, and excludes deleted
projects from new transport work. That supports the normal screenshot sequence.
It is not proof that *every* previously scheduled native sync has stopped:
native sync owns a per-repository mutex, purge does not, and workers retain the
descriptor captured when scheduled. Treat that as a separate existing concurrency
risk, not as the proven cause of this banner or a reason to add a global refresh
block. Preserve the pending-lifecycle guard and add a deferred-sync/soft-delete
sequence test. If that sequence permits purge before native completion, resolve
that demonstrated overlap before shipping; do not bypass actual work or release
serialization on a timer. A general native job/locking redesign is outside this
UI fix and would need its own concrete plan.

## Regression coverage

- Render an enabled Delete button during background refresh, invoke the opening
  action, enter the matching name, and confirm successfully. Assert the list
  remains usable and discovery never changes to error.
- Start refresh after opening the dialog; confirmation still succeeds.
- Hold refresh unresolved through removal, then publish its stale deleted-project
  snapshot. The removed project stays hidden; unrelated projects stay visible.
- Keep an actual write submission or pending soft-delete/restore active. Opening
  reports a notice, confirmation reports a modal error, and neither purges.
- Failed purge preserves the row and confirmation text, shows a modal error, and
  permits retry. Missing or restored projects and mismatched names do not purge.
- Double confirmation invokes purge once, including while the async guard waits.
- Switch teams or replace/close the modal during an async guard or purge. Update
  only the originating team's cache; preserve the new screen/modal.
- Offline local removal invokes no GitHub delete/restore or metadata-write command.
- Deferred native sync followed by soft deletion cannot expose a removable row
  before the lifecycle operation has safely settled.

Extend `project-flow.test.js`, `project-query.test.js`, and `projects.test.js`.
Add a Playwright interaction regression in `tests/browser/projects-page.spec.js`
with IPC stubs so the enabled button and handler are tested together. Existing
tests cover render eligibility and one idle happy-path confirmation separately;
the similarly named in-flight query test currently covers a chapter, not a project.

## Verification and limits

Run focused flow/query/render tests and the Projects-page Playwright suite first,
then `npm test`, scoped ESLint, the unused-code audit, and `git diff --check`.
Exercise the ordinary soft-delete then local-remove sequence in the development
app when a disposable project is available; do not delete user projects for tests.
No Rust change is proposed for the confirmed pre-IPC banner failure.

Keep this patch limited to local project removal and its query publication. Other
create/rename/restore/chapter handlers also use discovery errors for action failures;
record those separately rather than sweeping them into this fix. PR creation and merge were subsequently authorized; a packaged release is outside
this implementation.

## Implementation notes

- The shared page predicate now ignores background refresh. Blocked local actions
  use notices or modal errors, preserving genuine discovery errors and the active
  refresh badge.
- Local removal no longer calls the asynchronous remote-tombstone guard. A
  tombstone lookup cannot authorize deleting any remote data here: the action
  only invokes idempotent local purge after explicit name confirmation. This
  removes the pre-confirmation cleanup side effect and makes validation plus
  duplicate-submit protection synchronous, eliminating the planned guard-await
  race rather than adding more cancellation bookkeeping.
- The dialog captures its team. Confirmation checks current page ownership and
  deleted lifecycle state. Success publishes and persists only that team's query
  snapshot; stale completions cannot reset a replacement modal or alter another
  team's screen.
- An explicit empty-snapshot option at the query application boundary permits
  removing the last row without ending background refresh or retaining the row
  as an empty-loading fallback. Stale refresh snapshots still pass through the
  existing local-removal tombstone filter.
- The deferred native-sync/soft-delete regression confirms that the pending
  lifecycle marker blocks local removal until native completion. No Rust purge
  or repository queue behavior was changed.

Verification: 106 focused flow/query/render tests passed. The full frontend suite
passed 2,223 tests and the workflow suite passed 23 tests. The Projects-page
Playwright suite passed all 16 tests, including the two new real button/input/
confirmation interaction cases. Scoped ESLint and whitespace checks passed;
the unused-code audit has only its existing unrelated findings. Tests use mocked
native calls; no user project was deleted and the packaged app was not exercised.

## Review follow-up: stale active snapshots and account changes

1. Keep project removal tombstones effective for both active and deleted incoming
   rows. Clear them only after successful fresh team-metadata discovery confirms
   restoration, and only for tombstones captured before that refresh started.
   Cached snapshots and requests overlapping removal must not clear markers.
2. Capture storage login and auth-session generation when confirming removal.
   Persist native success against the originating account even after sign-out;
   skip query/UI publication after an auth-session change. Remove the project and
   its pending chapter mutations from that account's latest saved cache.
3. Add regressions for stale active progress/final snapshots, later legitimate
   restoration, removal during metadata discovery, failed/offline discovery,
   account switch/sign-out/same-account re-login, and failed native purge.
4. Run targeted tests, the full frontend/workflow suite, scoped lint, whitespace
   checks, and the existing Projects-page browser regressions.

Review follow-up completed locally:

- Project tombstones now filter both active and deleted snapshots. Online discovery
  captures eligible removal markers before loading and clears only those markers
  when a subsequent successful metadata read identifies a live active record.
  In-flight reads cannot clear markers created during their request. Offline and
  failed reads do not establish restoration; chapter behavior is unchanged.
- Purge confirmation captures storage login and auth generation. Native success
  records removal under the original login. If the session changed, it cleans only
  that account's saved project/pending-mutation cache and skips query/UI publication.
- Added nine regression cases covering active stale progress/final snapshots,
  genuine later restoration, removal overlapping discovery, offline/failed metadata,
  sign-out, switching accounts, re-login to the same account, and native failure.
- Verification: 2,232 frontend tests and 23 workflow tests pass. All 16 Projects-page
  browser cases pass (15 initially; one scroll test was interrupted by Vite's reload
  during import cleanup and passed on its isolated rerun). Scoped lint has no errors
  or new warnings; whitespace checks pass. Unused-code audit reports only the prior
  unrelated findings. Native operations were mocked; no user repository was removed.

Implementation and review follow-ups are complete; a packaged release is pending.
