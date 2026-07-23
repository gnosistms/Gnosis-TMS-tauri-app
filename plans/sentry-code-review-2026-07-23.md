# Sentry Code Review — 2026-07-23

Reviewed the 14 unresolved issues in Sentry (org `gnosis-tms`, project `javascript`,
last 14d). Each issue is a `captureMessage` from `reportBackendNonfatalError` — no JS
stack traces — so findings come from reviewing the code paths that emit them.

## Triage summary

| Sentry | Events | Message | Verdict |
|---|---|---|---|
| JAVASCRIPT-1H | 1 | `git add … index.lock: File exists … stale` (Windows) | **Real bug** — fix |
| JAVASCRIPT-1T | 1 | `sync_local_team_metadata_repo: git pull --ff-only failed` | **Real bug** — same root cause as 1H |
| JAVASCRIPT-1Q | 2 | `persistent-store.set: The resource id … is invalid` | **Real bug** — data-loss gap |
| JAVASCRIPT-5 | 88 | `repo_write_overdue: repoMaintenance` | Noisy telemetry, not a data bug — tune |
| JAVASCRIPT-17 | 3 | `repo_write_overdue: remoteSync` | Same as above |
| JAVASCRIPT-1V | 1 | `install_app_update: error decoding response body` | External (updater download) — no code fix |
| JAVASCRIPT-1R/1S/1M/1G/1J | 15 | GitHub API 502 / 503 | External outage — no code fix |
| JAVASCRIPT-1P/1N/1K | 7 | Write access / account type / admin access denied | Expected permission errors — arguably should not be reported |

The three that need code changes are below, ranked by severity.

---

## 1. (High) Project content writes bypass the per-repo git serialization lock

**Sentry:** JAVASCRIPT-1H (also causes JAVASCRIPT-1T for the metadata repo).
**Message:** `update_gtms_chapter_workflow_status: git add chapters/3-mountains-000/chapter.json failed: fatal: Unable to create '…/index.lock': File exists … or the lock file may be stale`

### What's wrong

`repo_sync_shared.rs:43` defines a per-repo mutex (`repo_sync_lock` / `acquire_repo_sync_lock`)
whose own doc comment says it exists because "without a shared lock the two can race the
same repo into `index.lock` failures."

- **Sync paths acquire it:** `project_repo_sync.rs:498` (editor sync) and `:577` (background
  reconcile), plus all glossary / QA / `repo_resource` storage helpers
  (`repo_resource_storage.rs:305`, etc.).
- **Project chapter/row content writes do NOT.** There are **zero** `acquire_repo_sync_lock`
  calls anywhere under `src-tauri/src/project_import/`. `write_row_files_and_commit`
  (`project_import/chapter_editor/shared.rs:43`, `git add` at `shared.rs:68`) and its callers
  — `update_gtms_chapter_workflow_status_sync` (`chapter_selection.rs:374`), every row save
  (`row_structure.rs`, `row_merge.rs`, `row_fields.rs`, `history.rs`, `aligned_translation.rs`)
  — run `git add`/commit on `.git/index` **outside the lock**.

**The race:** while the user is in the editor, the background reconcile sync holds the lock
and runs fetch/merge/pull (all of which take `.git/index.lock`). If the user simultaneously
flips a workflow status or saves a row, that write runs `git add` without the lock, and the
two processes collide on `index.lock`. The sync's lock is useless because the content write
never tries to take it. This exactly matches the Sentry message, and it's more likely on
Windows where file locking is stricter.

This also violates the **Parity** rule in `CLAUDE.md`: glossary/QA writes serialize; the
equivalent project chapter writes don't.

### JAVASCRIPT-1T — same class, metadata repo

`sync_local_team_metadata_repo` (`team_metadata_local.rs:150` → `repo.rs:272` `git pull --ff-only`)
has **no serialization at all** — no `repo_sync_lock`, `Mutex`, or `lock()` anywhere in
`team_metadata_local/`. Its mutation helpers `git add` (`mutations.rs:604`, `:684`) with no
lock, so a metadata mutation racing a metadata sync produces the same `index.lock` / `ff-only`
failure.

### Fix direction

- Acquire `repo_sync_lock(&repo_path)` inside `write_row_files_and_commit` /
  `write_row_files_and_commit_with_removals` (`shared.rs:43`, `:108`) so all chapter/row/
  workflow-status writes serialize against sync.
- Add equivalent serialization for the team-metadata repo (mutations vs
  `sync_local_team_metadata_repo`).
- **Caution:** `repo_sync_lock` returns a non-reentrant `std::sync::Mutex`. Confirm no caller
  on the content-write chain already holds it before wiring this in, or it will deadlock.
  (Currently none in `project_import/` do.)

### Also worth adding: stale-lock recovery

There is **no `index.lock` cleanup anywhere** in the backend. `abort_in_progress_git_operations`
(`repo_sync_shared.rs:79`) clears rebase/merge/cherry-pick/revert state but never removes a
stale `index.lock`. A lock left by a killed git subprocess (the "may be stale" tail of the
message) is never cleared and wedges writes until app/OS restart. Consider a best-effort stale
`index.lock` removal there.

---

## 2. (Medium) persistent-store recovery loses writes made during the reload window

**Sentry:** JAVASCRIPT-1Q — `persistent-store.set: The resource id 1501920850 is invalid.`

### What's wrong

The `tauri-plugin-store` handle is backed by a native resource id. On webview/app teardown or
reload that resource is dropped, and the stale JS handle rejects later `set()` calls with
`The resource id N is invalid.` (`store.rs` is plain plugin init — the invalidation is
lifecycle-driven, not app-caused.)

The recovery in `persistent-store.js` is *mostly* correct: it nulls the handle, kicks
`ensureStoreReloaded()`, and keeps `memoryState` authoritative so reads stay correct. But:

- `handleStoreWriteFailure` (`persistent-store.js:192`) does no retry of the failed write.
- `reloadStoreHandle` (`:146`) re-acquires a fresh handle but **never flushes `memoryState`
  back through it**.
- Writes issued while `store === null` (`:225`) return memory-only.

**Net effect:** the key whose `set()` triggered the stale id, plus every key written during
the reload window, live only in `memoryState`. Reads are correct for the rest of the session,
so nothing looks wrong — but on next boot `initializePersistentStorage` (`:110`) reloads from
the store **file**, which never received those values. **They are silently lost.**

This is acceptable at true shutdown (the code comments assume that case). It's a genuine
data-loss gap in the **mid-session** recovery path, which the code explicitly supports
(`reloadStoreHandle` succeeds and the app keeps running).

### Fix direction

After re-acquiring the handle in `reloadStoreHandle`, re-persist `memoryState` onto the fresh
handle (safe because `memoryState` is authoritative):
`for (const [k, v] of Object.entries(memoryState)) store.set(k, v)` then `store.save()`.

### Secondary (low): late stale rejections clobber a freshly reloaded handle

`set()` is fire-and-forget with no handle/rejection association (`:215`). Two writes on a stale
handle both reject; rejection #1 reloads to a fresh handle; rejection #2 (still `isStaleResourceError`)
nulls the fresh handle again and kicks a second reload. `storeReloadPromise` (`:152`) only
dedupes concurrent reloads, not late rejections. It self-heals but forces needless memory-only
churn. Fix with a handle generation/epoch counter so a rejection only drops the handle if no
reload has completed since that write was issued.

---

## 3. (Low) `repo_write_overdue` telemetry is noisy, not a bug

**Sentry:** JAVASCRIPT-5 (88 events, `repoMaintenance`) and JAVASCRIPT-17 (3, `remoteSync`).

### Assessment

**No data-integrity or logic bug.** "Overdue" means an operation ran past a time threshold
*while still running* — not that it failed or lost data. The timer logic
(`repo-write-queue.js:364`), the `overdueReported` guard, the `reportedOverdueOperationTypes`
dedup Set (one report per operation type per session), and cleanup on completion are all
correct. The 88 events are ~88 distinct sessions each reporting once — expected aggregation,
not a dedup defect. The prior belief that these are false alarms from slow (>120s) pushes is
correct.

### The real weakness (why it's noisy)

`repoMaintenance` is the **default catch-all bucket** (`normalizeOperationType`,
`repo-write-queue.js:116`) for every long-running op that isn't editor-write or remote-sync —
full clone, reconcile, large-repo search reindex — all sharing one 120s threshold
(`OVERDUE_THRESHOLDS_MS`, `:6`) and one dedup key. A large-repo reindex that legitimately takes
minutes is indistinguishable from a genuinely stuck operation, so the signal can't tell "stuck"
from "just big." That's why `repoMaintenance` (88) dominates `remoteSync` (3).

### Fix direction (optional — telemetry quality only)

Either split `repoMaintenance` into finer operation types with per-type thresholds
(clone/reindex/reconcile), raise the `repoMaintenance` threshold well above the legitimate
worst-case, or drop overdue telemetry for the maintenance bucket. No data loss is occurring.

---

## 4. Not code bugs (external / expected)

- **JAVASCRIPT-1V** `install_app_update: … error decoding response body` — the error string is
  surfaced verbatim from `update.download_and_install` (`updater.rs:554`); a transient
  network/deserialization failure during download. No code change; consider not reporting if
  the string indicates offline/transient.
- **JAVASCRIPT-1R/1S/1M/1G/1J** GitHub API 502/503 — upstream outages.
- **JAVASCRIPT-1P/1N/1K** "Write access not granted" / "account type cannot edit" / "need admin
  access" — expected permission denials. Per `src-tauri/AGENTS.md` (Error Handling), expected
  control flow like permission denial **should not be reported to telemetry**; these are noise
  and could be filtered at the report boundary.

---

## Recommended action order

1. **Fix #1** (index.lock race) — real user-facing failure, Windows, and a Parity violation.
   Serialize project content writes and metadata writes under `repo_sync_lock`; optionally add
   stale-`index.lock` cleanup.
2. **Fix #2** (persistent-store re-flush) — silent data loss in the mid-session recovery path.
3. **Tune #3 and filter #4** — telemetry-noise cleanup; no functional impact.
