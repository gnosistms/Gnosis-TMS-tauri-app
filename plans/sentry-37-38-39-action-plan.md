# Action plan — Sentry 37, 38, and 39

Status: implemented and under final verification on `codex/sentry-access-sync`;
release and Sentry closure remain pending.

Source: [September 22 review](sentry-review-2026-09-22.md). This plan covers
[37](https://gnosis-tms.sentry.io/issues/7734748982/),
[38](https://gnosis-tms.sentry.io/issues/7734762516/), and
[39](https://gnosis-tms.sentry.io/issues/7737244832/).

## Objective and order

Restore reliable editor saves when access is valid, preserve edits when access
cannot be verified, and reconcile glossary/QA repositories correctly when remote
metadata is stale. Resolve Sentry issues only when the relevant fixes are verified
and published.

1. **First: 37 / 38 — blocked editor saves.** Investigate and reproduce the shared
   access failure, then fix the demonstrated cause. The 64 events justify active
   investigation; adding diagnostics alone does not complete this work.
2. **Next: 39 — rejected glossary push.** Turn the isolated Git reproduction into
   an application regression test and fix the shared glossary/QA sync engine.
   This fix can ship independently if access investigation needs further evidence.
3. Validate, release, and update Sentry with the actual fixing version and evidence.

## Preparation

- Start from the current remote main in an isolated checkout; the reviewed working
  checkout has unrelated changes and is behind published v0.8.119. Preserve those
  changes and recheck whether newer commits already address either failure.
- Read the applicable backend/frontend guidance before editing. If evidence points
  to the broker, read its repository guidance before making broker changes.
- Refresh the three Sentry groups at implementation time. Record event counts,
  affected versions, safe error categories, and timestamps without copying tokens,
  raw payloads, document content, or installation identifiers into the repository.
- Keep focused commits for access investigation/fixes, sync fixes, and release
  bookkeeping. Do not include unrelated updater or project-readiness work.

## Workstream 1 — editor write access (37 / 38)

### 1. Reproduce and distinguish the failure sources

Trace the actual row-field and text-style commands through the backend write gate,
broker session loading, installation lookup, and access-snapshot persistence.
Start with `src-tauri/src/installation_access.rs`, `broker.rs`, and the relevant
project-import save entry points. Test backend behavior before changing JS state.

The existing generic message does not prove a permission denial. Build controlled
tests around the refresh boundary for these cases:

| Case | Behavior to establish and preserve |
|---|---|
| Fresh verified snapshot | Valid content writes succeed under current policy. |
| Expired/absent/corrupt snapshot, successful refresh | Fresh verified access permits saving and refreshes the cache. |
| Expired broker session | `AUTH_REQUIRED:` reaches existing session recovery; the failed pre-write operation can retry once safely. |
| Missing session or account/team changes during refresh | Recovery cannot authorize the wrong account or installation. |
| Broker unavailable, timeout, or upstream failure | Failure remains distinguishable from actual denial; edits are retained. |
| Missing/degraded membership response | Unverified access does not become a valid grant or poison a previously verified snapshot. |
| Access-snapshot persistence failure | Distinguish verified remote access from local storage failure; reproduce current behavior before deciding recovery policy. |
| Viewer, revoked access, or unknown membership role | Unauthorized shared writes remain blocked. |

Audit the existing broker contract and session-refresh tests. Do not assume the
broker, frontend, or local cache is at fault from the generic message alone.

### 2. Preserve useful diagnostics and fix the demonstrated cause

- Introduce a small internal failure classification at the point where information
  is currently collapsed: session missing/expired, broker transport, broker HTTP
  category, unverified membership, and snapshot storage. Keep unexpected failures
  distinguishable. Exact representation should fit existing error conventions.
- Preserve the existing auth marker and user-facing messages. Route safe diagnostic
  categories through the existing backend-event/frontend-telemetry boundary, with
  one report per failed operation. Keep command fingerprints recognizable so 37
  and 38 are not silently replaced by unrelated issue groups.
- Do not send raw broker bodies, paths, session tokens, document text, or unrestricted
  exception strings. Follow existing treatment of expected auth/offline/permission
  conditions; do not blanket-suppress unexplained blocked saves.
- Fix the cause demonstrated by tests. Reuse existing session recovery and write
  coordination. Any retry must be bounded and safe against duplicate writes; a
  pre-write access failure must be distinguished from an ambiguous commit result.
- Keep existing authorization and cache freshness policy unless evidence establishes
  a specific defect. Do not extend stale permissions or add a bypass to make saves
  succeed. Preserve existing offline editing behavior.

If controlled tests cannot explain the production reports, ship narrowly scoped
diagnostics as an intermediate result and keep 37/38 open. Record exactly which
evidence is missing and the next reproduction step. “No recent events” is not a fix.

### 3. Verify editor recovery and edit preservation

Check `src-ui/app/runtime.js`, `editor-write-permission.js`, the existing save flow,
and the write-intent coordinator only as required by the reproduced failure.

Acceptance criteria:

- Row-field and text-style saves both recover after a recoverable access failure.
- Failed saves retain the user's latest edits and unsaved status; a later successful
  save commits them without duplication or stale text replacing newer input.
- Concurrent saves use existing queues, and account/team switches cannot replay a
  pending write under the wrong session.
- Genuine access revocation remains enforced. The UI communicates the next action
  without falsely claiming the row was saved.
- Tests exercise the Rust gate and frontend retry/save behavior, including terminal
  failure and switching accounts while refresh is in flight.

## Workstream 2 — remote reconciliation (39)

Primary owner: `src-tauri/src/repo_resource_sync.rs`. Glossary and QA wrappers use
the same implementation and must receive the same behavior.

### 1. Add a failing regression through the production sync logic

Create a temporary bare remote and two working clones with disjoint local/remote
commits. Pass an empty/stale `default_branch_head_oid` while the remote branch
exists. Exercise the shared sync decision and Git commands, not just standalone
Git or a source-text assertion. Introduce a narrow test seam if AppHandle/network
setup otherwise prevents a deterministic test.

The current path fetches the remote for version checks but still selects an
initial push from the stale descriptor. The test must reproduce that rejection
before the fix and verify both sides' content afterward.

### 2. Use verified remote branch state

- Make the authenticated remote check distinguish **branch exists**, **branch
  absent**, and **lookup failed**. A network/auth failure must never mean an empty
  remote. A leftover local tracking ref is not proof that the remote branch exists.
- Use freshly verified state consistently for reconciliation, migration decisions,
  and version checks. Inspect both existing-checkout and clone paths for the same
  stale-head assumption. Preserve remote layout/version compatibility guards.
- When a remote branch exists, reconcile local commits through the supported
  pull/rebase path before pushing. Use initial branch publication only for a
  verified absent branch with publishable local commits.
- If another writer advances or creates the branch before push, allow at most one
  additional fetch/reconcile/push attempt for a specifically identified remote
  advancement rejection. Recheck compatibility before integrating newly fetched
  state. Return a clear failure after the retry budget is exhausted.
- Preserve existing per-repository locking and conflict recovery. Do not introduce
  force-push, hard reset, automatic repository deletion, or automatic conflict
  resolution. Mark the repository synced only after successful reconciliation.

### 3. Regression matrix and acceptance criteria

Cover both glossary and QA domain configurations:

- Stale empty descriptor with existing remote: disjoint local and remote changes
  both survive, and local/remote heads agree after sync.
- Truly empty remote: first publication succeeds.
- Remote advances or is created between lookup and push: bounded retry succeeds
  for disjoint changes; repeated advancement stops with a recoverable error.
- Overlapping edits or unrelated histories: clear failure/conflict state without
  loss of local or remote commits.
- Fetch/auth/permission failures: not classified as empty remote or retryable
  divergence; no false synced state.
- Remote branch deletion, non-default branch names, and stale tracking refs:
  decisions follow verified remote state.
- Newer remote app/layout requirement and concurrent local writes: compatibility
  gates and serialization remain effective.

## Verification and delivery

Run focused Rust access/sync tests and frontend runtime/session-refresh,
write-permission, save-preservation, and glossary/QA sync tests as changes land.
Use deterministic local fixtures; live production repositories are not test data.

Before merging, run the repository's required frontend/workflow and Rust suites,
Rust formatting/Clippy, applicable JS lint, unused-code audit, and production build.
Run targeted browser coverage if editor recovery/UI behavior changes. Smoke-test
the affected native save and Git flows on macOS and Windows; document any platform
verification still outstanding. Compare unrelated failures with the baseline.

Deliver separate reviewable changes for the access and sync fixes. Do not hold a
verified 39 fix indefinitely behind unresolved access investigation. Release only
the fixes that satisfy their own acceptance criteria, and verify published platform
artifacts contain the intended commits.

## Sentry closure gates

| Issue | Required before resolving |
|---|---|
| 37 / 38 | Evidence links the failure to a corrected cause; backend and editor recovery tests pass for both commands; the fix is in a published release. Diagnostic-only changes leave these open. |
| 39 | Production-path regression and glossary/QA parity tests pass; local/remote changes and conflicts are preserved; the fix is in a published release. |

Add the fixing commit/PR, verified release, test evidence, and remaining limitations
to each issue. Resolve in that actual release and read back Sentry's stored release
and status. Prior review found unreliable “next release” behavior, so do not use
that as a substitute for release verification. Check for occurrences on the fixing
release before closure; investigate any such recurrence. Keep recurrence detection
active and reopen on evidence that the shipped fix is incomplete.

Completion means implemented and verified behavior plus accurate release-linked
Sentry dispositions. A quieter issue list alone does not satisfy this plan.


## Implementation results — 2026-09-22

### Access saves

- A deterministic two-writer test reproduced the shared `installation-access.json.tmp`
  collision: one refresh removed the other refresh's temporary file. Unique sibling
  temporary filenames now isolate concurrent writes; failed replacement cleans its
  own temporary file. Cache read/corruption and replacement-failure tests also pass.
- Tokenless row-field and text-style IPC calls previously could not use the existing
  broker-session refresh. Both failed the new regression before the fix. They now
  capture the initiating session and reuse one bounded refresh, with account and
  team-change checks before replay. Other tokenless commands gain no retry privilege.
- Access snapshots are bound to a hash of the session that obtained them. Old-format,
  expired, wrong-installation, and wrong-session snapshots require verification.
  Late responses from an earlier login cannot grant access to the new login.
- Error categories survive the backend boundary without carrying raw broker bodies,
  filesystem paths, or credentials. The runtime restores the existing user message
  and reports a bounded tag through the existing command reporter. Expected transport
  and HTTP 403 failures follow operational filtering; HTTP 5xx is a warning. Unknown
  access, membership, parse, and storage failures remain observable.
- Module tests exercise real editor persistence callbacks: failed access retains the
  latest row text and a subsequent save persists it; session recovery commits a style
  change once. Existing deliberate terminal style-error rollback remains unchanged.

These are proven defects and recovery improvements, but the historical 37/38 events
contain no original failure category. Do not claim that all 64 historical events
were caused by the cache race. Keep 37/38 open after shipping until event evidence or
an affected-installation reproduction establishes the cause and verifies recovery.

### Glossary and QA synchronization

- A production-helper regression reproduced the rejected push from a stale empty
  descriptor. The shared engine now fetches an explicit branch ref and uses that
  verified commit for compatibility checks, migration decisions, and reconciliation.
- Rebase integrates exactly the checked commit. A definite concurrent-advance push
  rejection gets one further attempt, including a fresh compatibility check.
  Transport, permission, and hook errors do not get blind retries.
- Empty remotes, newly created branches, differing clone/default branches, stale
  tracking refs, conflicts, unrelated histories, repeated remote advances, and newer
  remote app versions have real-Git fixture coverage. Failed sync never marks the
  fixture synced. Both domain wrappers use the same engine.
- Existing repository locks and migration guards remain in place. No force-push or
  destructive recovery was added. The `+` fetch refspec updates only the local
  tracking reference.

### Verification and limits

- Before fixes: two access-recovery JS tests failed. The Rust suite had precisely
  the new cache-race and stale-remote regressions fail (689 passed, 5 ignored).
- Frontend: 2,257 tests passed; workflow: 23 passed.
- Targeted browser: 10 editor save/style/draft tests passed in installed Chrome on
  macOS, using a separate dev-server port. The Windows fixture variant is browser
  simulation, not native Windows verification.
- JavaScript lint: no errors; 62 existing warnings. Unused-code audit: unchanged
  3 files, 5 fixture imports, and 1 export. Production Vite build passed.
- Full Rust suite: 705 passed, 5 intentionally ignored; binary/doc tests passed.
  Strict Clippy and Rust formatting passed. CI, release artifacts, and final Sentry
  state are recorded below as delivery completes. Native Windows execution is still
  unverified locally.
- No broker server change or new endpoint is required. Unrelated original-checkout
  edits are untouched. Dependency and sidecar symlinks used for local checks are
  temporary and excluded from commits.
