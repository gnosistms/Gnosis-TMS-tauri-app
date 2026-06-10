# Handoff: Repo-write-queue stuck-state surfacing + bounded project sync polling

Self-contained implementation brief for an agent with **no prior context**. Read
top-to-bottom before editing. This is a **follow-up** to the badge-wording change in
commit `3630e0bf` ("Clarify project repo sync wait badge"); that commit is fine and out
of scope here — do **not** revert it.

## 0. Problem

On the Projects page, the sync status badge sat for several minutes saying
*"Waiting for local saves in 1 project repo..."*. Local saves should be fast. The
wording commit fixed one **misdiagnosis** (non-local repo operations were being labelled
"local saves"), but the app can still appear **stuck indefinitely** with no overdue/error
surfaced. This brief fixes stuck-state surfacing and bounded project-sync polling, not
the wording.

### Confirmed mechanism (three compounding causes)
1. **No timeout on the running op.** `processScopeQueue` does
   `await operation.run(...)` (`src-ui/app/repo-write-queue.js:295`) inside
   `while (queue.items.length > 0)` (`:276`). A `run` promise that never resolves pins
   the op at `status:"running"` forever and blocks every later op on that scope. There
   is no watchdog anywhere.
2. **Unbounded poll loop.** `reconcileOneProjectRepoSyncState` runs
   `while (hasSyncingRepos(snapshots))` (`src-ui/app/project-repo-sync-flow.js:199`) with
   a 1400 ms delay and **no** max-duration / no-progress exit. If the backend never
   leaves `syncing`, this op's `run` promise pends forever — case (1).
3. **One stuck project hangs the whole cycle.** `reconcileProjectRepoSyncStates` does
   `await Promise.all(...)` (`src-ui/app/project-repo-sync-flow.js:293`) and only clears
   the badge *after* it resolves (`:312`). One stalled project leaves the badge up and
   blocks `applySnapshots`.

### Stuck-state taxonomy
There are two different stuck states. Do **not** treat them the same.

1. **Project repo sync polling is stuck.** This is a UI-managed polling loop. It can be
   bounded safely: if polling stays `syncing` too long or makes no progress, resolve the
   sync operation with the last known snapshots, mark the sync as stalled/retryable, and
   free the repo queue scope.
2. **Local editor/metadata save is stuck.** This is usually a Tauri `invoke` that has not
   resolved. Per product decision, JavaScript must not pretend the save succeeded, reject
   the save, or free the repo queue scope just because a timer elapsed. Surface an
   overdue state and report telemetry, but keep the operation pending so a late backend
   result can still complete normally.

### Existing facts to reuse
- Each queue operation already carries `queuedAt` / `startedAt` / `finishedAt`
  (set in `processScopeQueue`; exposed by `snapshotOperation`,
  `repo-write-queue.js:156`). **Elapsed time is already computable** — no new bookkeeping
  needed, only derived fields + a clock.
- A failure channel exists: `recordRepoQueueError(...)` (`repo-write-queue.js:553`) +
  `subscribeRepoWriteQueue` / `getRepoQueueErrors`. **But it has no UI/Sentry consumer**
  today (only tests reference it). Overdue surfacing must wire a real sink, not just emit
  into a void.
- Telemetry: `reportBackendNonfatalError({ operation, reason })`
  (`src-ui/app/telemetry.js:217`) is consent-gated and scrubbed — use it for the Sentry
  signal. Do **not** call `sentry` directly.
- Editor writes enter the queue centrally at `src-ui/app/editor-operation-queue.js:245`
  with `operationType: "localEditorWrite"`, so a watchdog inside `repo-write-queue.js`
  covers editor saves automatically — no per-call-site edits needed.
- Scoped badges: `showScopedSyncBadge(scope, text, render)` /
  `clearScopedSyncBadge(scope, render)` in `src-ui/app/status-feedback.js:84`.

### Decisions (already reasoned; treat as fixed unless you find a blocker)
- **Never reject or force-complete local writes on a JS timeout.** Overdue is a
  *non-terminal, visible* signal; the promise stays pending so a late-resolving `invoke`
  still completes normally. This means an overdue local save may still block that repo
  scope. That is intentional until a separate cancellation/recovery design exists.
- Bounded project-sync polling **resolves** the sync op with the last snapshots (frees the
  scope, lets `Promise.all` complete) and surfaces a retryable stalled state — it does
  not throw.
- Time must be **injectable** so tests stay deterministic.
- This ships as its **own PR**, separate from the add-translation modal PR.

## 1. Task 1 — Overdue / elapsed fields on the queue snapshot (`repo-write-queue.js`)

Add derived, read-time fields. Introduce an injectable clock.

1. Module-level clock:
   ```js
   let nowMsClock = () => Date.now();
   export function __setRepoWriteQueueClock(fn) { nowMsClock = typeof fn === "function" ? fn : (() => Date.now()); }
   ```
   Reset it in `resetRepoWriteQueue()` (`:637`) back to `() => Date.now()`.

2. Per-operation overdue thresholds by `operationType` (tunable):
   ```js
   const OVERDUE_THRESHOLDS_MS = {
     localEditorWrite: 15000,
     localMetadataWrite: 15000,
     remoteSync: 120000,
     repoMaintenance: 120000,
   };
   const DEFAULT_OVERDUE_THRESHOLD_MS = 60000;
   ```

3. In `snapshotOperation` (`:156`) add `elapsedMs` and `overdue`. Elapsed = `nowMsClock()`
   minus the effective active start (`startedAt` if running, else `queuedAt`), parsed
   from the ISO strings; clamp to `>= 0`. `overdue = status active && elapsedMs >=
   threshold(operationType)`. (Computing in `snapshotOperation` keeps it in one place.)

4. In `getRepoWriteQueueSnapshot` (`:483`) add snapshot-level:
   - `hasOverdueWrites: operations.some(o => o.overdue)`
   - `oldestActiveOperation`: the active op with the smallest effective start time
     (return the `snapshotOperation` shape or `null`).
   Do the same `oldestActiveOperation` / `hasOverdueWrites` on the **per-scope**
   `snapshotQueue` (`:173`) so callers with a scope get it too.

5. Keep all existing fields and behaviour. These additions are read-only and backwards
   compatible.

## 2. Task 2 — Non-terminal overdue watchdog (`repo-write-queue.js`)

The hang produces no queue events, so a passive "compute on read" won't fire on its own.
Schedule a check when an op starts running.

1. Add an injectable scheduler so tests don't wait real seconds:
   ```js
   let scheduleOverdueCheck = (fn, ms) => setTimeout(fn, ms);
   let cancelOverdueCheck = (handle) => clearTimeout(handle);
   export function __setRepoWriteOverdueScheduler(schedule, cancel) { /* default-restore when null */ }
   ```
   Reset it in `resetRepoWriteQueue()`.

2. When an op transitions to `running` in `processScopeQueue` (`:283-288`), schedule a
   timer at its threshold via the injectable scheduler:
   ```js
   operation.overdueTimer = scheduleOverdueCheck(() => {
     if (operation.status !== "running") return;
     operation.overdueReported = true;
     reportBackendNonfatalError({ operation: "repo_write_overdue", reason: operation.operationType || operation.kind });
     emitQueueChanged();
   }, thresholdFor(operation.operationType));
   ```

3. Clear the timer with `cancelOverdueCheck(operation.overdueTimer)` in the `finally` of
   the op (`:321-326`) and in `cleanupCompletedOperation`. Never let a timer outlive its
   op.

4. Do **not** change the op promise: no reject, no resolve from the watchdog. It only
   flips a flag, reports once (guard with `overdueReported`), and emits a queue-changed
   event so subscribers/badges re-render with `overdue`/`hasOverdueWrites` true. This
   intentionally **does not free the repo scope** for a hung local save.

5. `reportBackendNonfatalError` is already consent-gated; no extra gating needed. Keep the
   `reason` a stable token (operationType/kind), never paths or user content.

## 3. Task 3 — Bounded, abortable project-repo sync polling (`project-repo-sync-flow.js`)

Fix the unbounded project-sync polling loop and the `Promise.all` hang. This bounded
resolution applies to project sync polling only; it does not change local save semantics.

1. Add constants near `PROJECT_REPO_SYNC_POLL_DELAY_MS` (`:18`):
   ```js
   const PROJECT_REPO_SYNC_MAX_POLL_MS = 180000;     // hard cap per repo
   const PROJECT_REPO_SYNC_NO_PROGRESS_POLLS = 8;    // identical snapshots in a row => stalled
   ```

2. In the `while (hasSyncingRepos(snapshots))` loop (`:199-213`):
   - Record a start timestamp (use an injectable `now` — see §4 Tests) before
     the loop.
   - Track a stable signature of `snapshots` (e.g. JSON of the per-repo `status` +
     progress fields). If it is unchanged for `PROJECT_REPO_SYNC_NO_PROGRESS_POLLS`
     consecutive polls, or total elapsed exceeds `PROJECT_REPO_SYNC_MAX_POLL_MS`, **break**.
   - On break due to stall: mark the descriptor's repo state as stalled (a
     `syncStalled: true` / status field that `applyProjectRepoSyncSnapshots` and the
     badge can read), surface a retryable notice via `showScopedSyncBadge("projects", …)`
     or `showNoticeBadge`, and **return the last `snapshots`** so the op resolves and the
     scope frees.
   - Preserve all existing `shouldAbort?.()` / team-switch early-returns.

3. Because each `reconcileOneProjectRepoSyncState` now resolves for bounded sync stalls, the
   `Promise.all` (`:293`) completes and the badge clears (`:312`) even when one repo
   stalls. Verify no other caller relies on the loop running forever.

4. Optional but recommended: surface `getRepoWriteQueueSnapshot(scope).oldestActiveOperation`
   /`hasOverdueWrites` in the **pre-sync** badge text (the `waitingSummary` reduce at
   `:278`) so the badge can say what is actually stuck (e.g. append "(taking longer than
   expected)") instead of a bare count. Keep `queuedSyncBadgeText` pure/testable.

## 4. Tests

- `src-ui/app/repo-write-queue.test.js`:
  - Inject the clock (`__setRepoWriteQueueClock`) and overdue scheduler
    (`__setRepoWriteOverdueScheduler`) to deterministically drive an op past its
    threshold; assert `snapshot.operations[0].overdue === true`,
    `snapshot.hasOverdueWrites === true`, `oldestActiveOperation` is the right op, and
    that the op promise is **still pending** (not rejected) and resolves normally when the
    `run` finally completes.
  - Assert the watchdog reports exactly once.
  - Assert timers are cleared on completion (no overdue flip after the op finishes).
- `src-ui/app/project-repo-sync-flow.test.js`:
  - Drive a repo that stays `syncing` and assert the loop exits after the max-duration /
    no-progress bound, the op resolves, the badge clears (or shows the stalled/retry
    text), and `applySnapshots` runs. Use injected time so it's fast and deterministic.
- Reset injected clock/scheduler in test teardown (and confirm `resetRepoWriteQueue()`
  restores defaults).

## 5. Verification
```bash
npm test
npm run audit:unused
```
Manual (`npm run tauri:dev`): not required for unit-level correctness, but if exercised,
confirm a deliberately slow/stalled sync surfaces an overdue/retry badge instead of an
indefinite "Waiting…".

## 6. Scope / PR
- **Separate PR**, not on the add-translation branch. Title e.g. "Surface overdue repo
  writes and bound project sync polling."
- Files: `src-ui/app/repo-write-queue.js`, `src-ui/app/project-repo-sync-flow.js`, their
  two test files, and possibly `status-feedback.js` / `project-repo-sync-flow.js` badge
  text. Keep `recordRepoQueueError`/telemetry wiring minimal and focused.
- Respect repo rules: vanilla ES modules; route Sentry through `telemetry.js`
  (`reportBackendNonfatalError`); don't disable user actions for background work; small
  focused commits.

## 7. Gotchas
- **Never reject local writes** on timeout — overdue is a visible flag only; the promise
  stays pending and the repo scope remains blocked until the backend result arrives or a
  separate recovery path is implemented.
- Time is non-deterministic — everything time-based must accept an injected clock /
  scheduler or tests will be flaky.
- The watchdog must fire **without** any other queue activity (that is the whole bug), so
  a passive compute-on-read is insufficient — schedule a timer per running op.
- Clear every scheduled timer on op completion/cleanup; a leaked timer that flips
  `overdue` after success is a bug.
- `recordRepoQueueError`'s channel currently has no consumer; if you rely on it for
  surfacing, wire the consumer, otherwise prefer `reportBackendNonfatalError` +
  `emitQueueChanged` + badge text.
- Don't change backend behaviour; this is UI-side bounding for project-sync polling plus
  visible overdue surfacing for queue operations. A truly hung Tauri `invoke` can't be
  force-cancelled from JS; the goal for local writes is to make the stall visible and
  reportable, not to silently unblock the scope.
