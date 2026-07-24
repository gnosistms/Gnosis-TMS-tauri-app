# AI Review All: one commit per batch response

## Problem

AI Review All applies results one row at a time through the
`apply_gtms_editor_ai_review_result` Tauri command (`applyReviewOutcome` in
`src-ui/app/editor-ai-review-all-flow.js`), producing one git commit per row.
Large runs create the same write-queue starvation that PR #196 (811f668f) fixed
for AI Translate All: hundreds of sequential per-row commits drain slowly,
interactive saves queue behind them, and the false "Local save stalled" banner
can appear.

## Approach (mirrors 811f668f)

One batched Rust command applies all valid results from one AI batch response
(batches are capped at `AI_BATCH_MAX_ROWS = 15`) in a single git commit. The
single-row command stays for the individual Review button, single-item batches,
and per-row fallbacks.

### Rust: `apply_gtms_editor_ai_review_results_batch`

New sync function in `src-tauri/src/project_import/chapter_editor/row_fields.rs`
next to `apply_gtms_editor_ai_review_result_sync`, with structs in
`chapter_editor/mod.rs`, the async command in `project_import.rs` (with
`ensure_installation_allows_chapter_writes`), registered in `lib.rs`.

Input: `installationId`, `repoName`, `projectId`, `chapterId`, `languageCode`,
`aiModel`, and `rows: [{ rowId, suggestedText, suggestedFootnote,
suggestedImageCaption, reviewed, pleaseCheck }]` (deduplicated by rowId via
`BTreeMap`, matching `update_gtms_editor_row_fields_batch_sync`).

Per row it repeats the per-row command's logic: apply non-empty suggested
text/footnote/caption, set the reviewed and please-check flags, skip rows whose
serialized file did not change. Word counts are maintained with
`load_word_counts` + `apply_word_count_delta` like the fields batch command.
Changed rows are written and committed once via `write_row_files_and_commit`
with `CommitMetadata { operation: "ai-review", ai_model }` and message
`AI review {n} row(s) {language}`; imported-conflict entries are cleared for
each changed row (parity with the fields batch command).

Response: per-row results `{ rowId, text, footnote, imageCaption, reviewed,
pleaseCheck, lastUpdate }` for every input row (changed or not), plus
`wordCounts` and `chapterBaseCommitSha`.

### JS: `editor-ai-review-all-flow.js`

In `reviewBatch`, after the AI batch call returns, partition live items in one
validation pass (same staleness checks as today): items with a returned result
and unchanged text are applied through one
`apply_gtms_editor_ai_review_results_batch` call; missing/stale items fall back
to `reviewSingleItem` afterwards. The batched apply goes through
`invokeEditorWriteCommand` (permission layer), then applies each returned row
with `applyReviewResultToRow`, updates `wordCounts` and
`chapterBaseCommitSha`, reconciles dirty-row tracking, advances the progress
modal once, and renders the applied rows in one scoped render.

Test seams (matching the translate flow's injectable operations):
`operations.ensureAiReviewAllProviderReady` and
`operations.applyAiReviewResultsBatch` override the built-in paths when
provided.

## Files

- `src-tauri/src/project_import/chapter_editor/mod.rs` — input/response structs, re-export
- `src-tauri/src/project_import/chapter_editor/row_fields.rs` — batch sync function
- `src-tauri/src/project_import.rs` — async command wrapper
- `src-tauri/src/lib.rs` — command registration
- `src-ui/app/editor-ai-review-all-flow.js` — batched apply path
- `src-ui/app/editor-ai-review-all-flow.test.js` — batch apply + fallback tests

## Non-goals

- No change to the individual Review button or single-row command.
- No change to AI batch sizing or request building.
- No queued-operation rework: the review flow already invokes write commands
  directly (not through `requestEditorOperation`); fewer commits is the fix.
