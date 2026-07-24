# AI Translate All: batch row saves into one commit per batch response

## Problem

Translate All persists every translated row as its own queued save, and each save
runs the full per-row pipeline in Rust: write one row JSON file, then make one git
commit for that single row. A run over hundreds of rows therefore produces hundreds
of sequential git commits. The write queue drains far slower than the AI produces
translations (one batch API response delivers up to 15 rows at once), so:

- The commit backlog keeps running for minutes after the AI run finishes.
- Interactive saves (the user editing a row by hand) queue behind the backlog and
  trip the 10-second "Local save stalled" error banner in the Review pane
  (`PENDING_LOCAL_SAVE_ERROR_AFTER_MS` in `src-ui/screens/translate-review-pane.js`),
  even though nothing is failing.

Observed live on 2026-07-24: a Translate All run on the `subtitles` project produced
a long tail of `[gtms row-save]` / `[gtms git-commit]` log blocks, one commit per row,
and a manual edit stalled behind them.

## Current behavior (code references)

- `src-ui/app/editor-ai-translate-all-flow.js:595` — `applyBatchRowResult` applies
  one row from a batch API response to state, then calls
  `operations.persistEditorRowOnBlur(render, rowId, { commitMetadata, waitForDurable: false })`.
  One queued save per row.
- `src-ui/app/editor-persistence-flow.js:2225` — `waitForDurable: false` returns as
  soon as the save is enqueued; the translate loop never waits for commits. The
  scheduling is already concurrent — the imbalance is pure commit throughput.
- Rust per-row command `update_gtms_editor_row_fields`
  (`src-tauri/src/project_import/chapter_editor/row_fields.rs:290`): base-field
  rebase/conflict detection, one `write_row_files_and_commit` per row, then
  `clear_imported_editor_conflict_entry` for the row.
- Rust batch command `update_gtms_editor_row_fields_batch`
  (`row_fields.rs:762`): writes N rows, skips unchanged ones, makes **one** commit
  via `write_row_files_and_commit_with_removals`, returns
  `{ rowIds, wordCounts, commitSha, chapterBaseCommitSha }`. Already used by
  Clear Translations (`editor-persistence-flow.js:1742`) and search replace
  (`editor-search-flow.js:580`). Gaps vs the per-row command:
  - `CommitMetadata.ai_model` is hardcoded `None` (`row_fields.rs:908`) and
    `UpdateEditorRowFieldsBatchInput` has no `aiModel` field
    (`chapter_editor/mod.rs:334`).
  - No `clear_imported_editor_conflict_entry` call for the written rows.
  - No base-field conflict detection (plain overwrite). This is the same trust
    level Clear Translations and search replace already accept.
- Batch sizing: `AI_BATCH_MAX_ROWS = 15` (`src-ui/app/editor-ai-batch-request.js:15`).

## Goal

One git commit per AI batch response instead of one per row. For a 300-row run:
~20 commits instead of 300. The queue drains in seconds, and interactive saves are
no longer starved.

Non-goal: changing translation throughput, batch sizing, or the AI request path.

## Design

Batch granularity = one save per **batch API response** (≤15 rows). This is the
natural unit: all rows in a response are applied together, the commit lands close
behind the translation (bounded staleness), and a failed commit has a small blast
radius.

### Rust changes (`row_fields.rs`, `chapter_editor/mod.rs`)

1. Add `#[serde(default)] ai_model: String` to `UpdateEditorRowFieldsBatchInput`.
   Pass it into `CommitMetadata` in `update_gtms_editor_row_fields_batch_sync`
   (replace the hardcoded `ai_model: None` at `row_fields.rs:908`), trimmed and
   filtered to `None` when empty — same normalization as the per-row command
   (`row_fields.rs:527`).
2. After a successful batch commit, call `clear_imported_editor_conflict_entry`
   for each changed row id (parity with the per-row save at `row_fields.rs:550`,
   which ignores the result). This also benefits Clear Translations and search
   replace: overwriting a row should clear its imported-conflict marker on every
   full-row write path.

### Frontend changes (`editor-ai-translate-all-flow.js`, `editor-persistence-flow.js`)

1. In the batch-response apply loop, stop calling `persistEditorRowOnBlur` per row.
   Instead, collect the row ids that were actually applied (rows that passed the
   source-unchanged / target-still-empty guards), and after the whole response is
   applied, enqueue **one** write-queue operation for the group.
2. New queued operation (modeled on the Clear Translations operation at
   `editor-persistence-flow.js:1722`; export a helper from
   `editor-persistence-flow.js` so the translate flow does not touch the queue
   directly):
   - `kind: "aiTranslateBatchSave"`, same `repoScope`/`chapterScope` and
     invalidation keys as per-row saves.
   - **run**: build the batch input from **current** state at run time (parity
     with `rebaseRowTextInputForRun` in the per-row path): for each collected row,
     read the target-language field/footnote/imageCaption text from
     `state.editorChapter`. Skip rows whose `saveStatus`/`freshness` is
     `"conflict"` (parity with the per-row run check at
     `editor-persistence-flow.js:2195`) and rows no longer present. Call
     `update_gtms_editor_row_fields_batch` with
     `commitMessage: "AI translate <target label> (<N> rows)"`,
     `operation: "ai-translation"`, `aiModel: provider.modelId`.
   - **onSuccess**: guard `chapterId`; apply `wordCounts` and
     `chapterBaseCommitSha` from the payload; `reconcileDirtyTrackedEditorRows`
     for the changed row ids; if the active row was in the batch, refresh the
     active field history (parity with Clear Translations `onSuccess`).
   - **onError**: mark every row in the batch persist-failed via
     `applyEditorRowPersistFailed` + `reconcileDirtyTrackedEditorRows` and show
     the notice badge (parity with per-row `onError` at
     `editor-persistence-flow.js:2210`). Rows stay dirty, so the existing
     dirty-row flush can retry them per-row.
3. Do **not** create per-row optimistic history entries for batch-saved rows.
   Clear Translations and search replace already skip them; the Review pane shows
   the committed entry after invalidation. AI-translated rows are almost never the
   focused row mid-run, and skipping avoids hundreds of placeholder entries.
4. Leave untouched (still per-row):
   - The single-row fallback path (rows that fall out of batch derived-glossary
     resolution) — small counts, not worth a second code path.
   - Pivot-text persistence in the derived-glossary flow
     (`persistPivotTextToRow: true`) — separate write path, out of scope.
   - AI Review All (`editor-ai-review-all-flow.js`) applies suggestions via its
     own apply command; if it shows the same per-row commit pattern, that is a
     follow-up with the same recipe, not part of this change.

## Edge cases

- **User edits a translated row between apply and batch run**: run-time input is
  built from current state, so the commit records what the user sees. The user's
  own blur-save also queues; whichever runs second finds the text unchanged and
  the Rust side skips it as a no-op.
- **Row enters conflict state before the batch runs**: excluded at run time, same
  as the per-row path.
- **Chapter switched / run cancelled mid-flight**: the queued operation still
  commits already-applied rows (data safety — the text is on screen and must not
  be lost); `onSuccess` state application is guarded by `chapterId`.
- **Whole-batch commit failure**: all rows in that batch are marked persist-failed
  and stay dirty; only ≤15 rows are affected, and the dirty-row flush retries them
  through the per-row path with its full conflict handling.
- **No base-field conflict detection in the batch command**: accepted; identical
  to Clear Translations and search replace. The translate flow's own guards
  (source unchanged, target still empty, run-time rebuild) cover the mid-flight
  window, and background-sync conflicts are excluded at run time.

## Testing

- Unit (`npm test`):
  - New tests for the batch-save helper: groups applied rows, builds run-time
    input from current state, skips conflict/missing rows, `onError` marks all
    rows failed.
  - Update `editor-ai-translate-all-flow` tests that currently assert one
    `persistEditorRowOnBlur` call per row.
- Rust: extend existing chapter-editor tests to cover `aiModel` passthrough into
  commit metadata and imported-conflict clearing for batch writes.
- Manual (`npm run tauri:dev`):
  - Translate All on a subtitles chapter with 50+ empty rows: dev log shows one
    `[gtms git-commit]` block per ~15 rows, not per row; history entries carry
    the AI model.
  - Edit a row by hand mid-run: its save commits promptly; no "Local save
    stalled" banner.
  - Kill the app mid-run and relaunch: previously applied batches are committed;
    uncommitted dirty rows flush on load.

## Status

- [x] Rust: `aiModel` on batch input + commit metadata
- [x] Rust: imported-conflict clearing for batch writes
- [x] JS: batch-save queued operation helper in `editor-persistence-flow.js`
      (`persistEditorRowsBatch`; wired through `translate-flow.js` into the
      Translate All operations)
- [x] JS: translate-all flow enqueues one save per batch response
      (collector in `translateBatch`, flushed in a `finally` so abort/error
      exits still commit applied rows; per-row fallback kept when the batch
      operation is not wired)
- [x] Tests updated and passing (`npm test` 1744 pass, two new grouped-save
      tests in `editor-ai-translate-all-flow.test.js`; `cargo test` 469 pass;
      `npm run audit:unused` clean)
- [ ] Manual verification in `tauri:dev`

Implementation notes (deviations from the design above):

- The helper does not call `assertQueuedEditorRowsReady`: unlike Clear
  Translations, the batch input is rebuilt from current state at run time, so
  pending (un-blurred) text cannot be resurrected — the later blur save wins
  through the normal dirty-row path. Throwing on pending text would fail the
  whole batch just because the user is typing.
- Persisted-state bookkeeping in `onSuccess` keeps state-format snapshots
  (structured footnote entries), not the legacy-serialized wire values, so
  dirty comparisons stay like-for-like.
