# Batch Glossary Derivation Plan (shared procedure for Derive Glossaries + Translate All)

## Status (2026-07-06)

Implemented on `feat/batch-derive-glossaries` (increments 1–3 committed; unit
tests green, knip clean — the two `vellum-clipboard.js` findings pre-date this
branch). Manual verification pending: a real pivot-glossary chapter through the
modal (rows without pivot text; cancel mid-run) and Translate All over
derived-glossary rows missing pivot text.

Two deltas from the plan as written, both discovered during extraction and
strictly safer: batch-derived entries now also persist to the disk cache (the
inlined Translate All version skipped the save the single-row path does), and
the modal's per-item progress granularity was preserved after all (the shared
flow settles items individually via `onItemSettled`, so per-chunk ticking never
became necessary).

## Problem

Two flows perform derived (pivot) glossary preparation, with very different
efficiency profiles:

- **Derive Glossaries modal** (`editor-derive-glossaries-flow.js`) processes one
  (row × derivable language) work item at a time. Each item costs up to 2+ serial
  AI calls inside `prepareEditorDerivedGlossaryForContext`: a pivot-translation
  call when the row has no glossary-source text (`run_ai_translation` — and the
  modal passes `generateMissingGlossarySourceTextWhenMissing: true`, so this is
  the common case), plus one or more alignment calls
  (`prepare_editor_ai_translated_glossary`, chunked by
  `GLOSSARY_ALIGNMENT_BATCH_SIZE`). A chapter with N rows and M derivable
  languages makes O(2·N·M) sequential model round trips.
- **Translate All** (`editor-ai-translate-all-flow.js`) already batches
  derivation since `24211acb`: `resolveBatchDerivedGlossary` makes one
  `prepare_editor_ai_translated_glossary_batch` call per translate batch,
  redistributes the entries per row, and stores per-row derived entries in
  chapter state. But the logic is embedded in the translate-all flow (not
  reusable), and rows **missing pivot text** are punted to the single-row
  translate path, which generates pivot text one serial call per row.

Goal: one shared batched-derivation procedure that serves both the standalone
Derive Glossaries modal and Translate All's in-line derivation, including
batched pivot-text generation for rows that lack it.

## Current architecture (verified)

| Concern | Derive Glossaries modal | Translate All batch derivation |
|---|---|---|
| Work list | `buildEditorDeriveGlossariesWork` — (rowId, sourceLang, glossaryTargetLang) per derivable language, skipping fresh-cached items | translate batch items whose `glossaryKind === "derived"` |
| Per-item context | `buildDeriveContext` (minimal: row, languages, labels, sourceText) | `buildEditorAiTranslateContext(chapterState, { ...item, skipRowWindow: true })` |
| Usage resolution | `resolveEditorDerivedGlossaryUsage(context, { useCurrentGlossarySourceText: true })` — pivot text read from the row's current pivot column | `resolveEditorDerivedGlossaryUsage(context)` — default resolution via `resolveEditorDerivedGlossarySourceText` |
| Fresh cache | skipped up front (`editorDeriveGlossaryWorkItemHasFreshCache`) and re-checked per item | reused per row (`cachedDerivedEntry` + staleness check), hints built from cached `matcherModel` |
| Missing pivot text | generated per row via `run_ai_translation` inside `prepareEditorDerivedGlossaryForContext`, written to the row and persisted (`persistGlossarySourceImmediately: true`) | row is pushed to `fallbackEntries` → single-row translate path generates it serially (`syncGlossarySourceTextToRow` default true, need-persist flagged) |
| Derivation call | one `prepare_editor_ai_translated_glossary` per item | one `prepare_editor_ai_translated_glossary_batch` per batch; combined `glossarySourceText` joined with `\n\n` |
| Entry storage | `applyEditorDerivedGlossaryEntry` per row (chapter state + persistent cache) | same, after redistributing batch entries per row by `entry.sourceText.includes(prepared.sourceTerm)` |
| Cancellation | `activeDeriveGlossariesRunId` + modal `status === "loading"`; `requestStillCurrent` / `sourceStillCurrent` callbacks | `isRunActive()` checks after each await; `"abort"` sentinel |
| Failure | item error stops the whole run with the error in the modal | batch derivation failure → all needy rows fall back to the single-row path |

Rust side (`src-tauri/src/ai/`):

- `prepare_ai_translated_glossary_batch` (mod.rs) concatenates the batch's
  source texts and reuses the single-row derivation; entries are containment-
  filtered against the combined text, so per-row redistribution by containment
  in JS is consistent with the single-row filter
  (`request.translation_source_text.contains(source_term)`).
- `AiTranslationBatchRequest` (types.rs:274) has serde defaults for
  `glossary_hints`, `context_before`, `context_after` — `run_ai_translation_batch`
  is directly reusable for plain pivot-text generation (rows in, translated
  texts out, no glossary, no context window).

**No new Rust commands are required.**

## Design

### New shared module: `src-ui/app/editor-derived-glossary-batch-flow.js`

One export:

```
ensureBatchDerivedGlossaries({
  items,                 // [{ rowId, sourceLanguageCode, targetLanguageCode }] — ONE language pair
  providerId, modelId,
  isRunActive,           // () => bool; checked after every await
  useCurrentGlossarySourceText,   // modal: true; translate-all: false (preserve each caller's semantics)
  generateMissingPivotText,       // phase B on/off
  persistPivotTextToRow,          // write + persist generated pivot text into rows
  editorSourceLanguageCode,       // generation source column (modal passes chapter source; translate-all passes item source)
  onItemSettled,          // (item, outcome) => void — progress callback
  operations,             // invoke / updateEditorRowFieldValue / persistEditorRowOnBlur / render injection for tests
})
  => { resolved: [...], unresolved: [...], aborted: bool }
```

Contract: for each item, ensure a fresh derived-glossary entry exists in chapter
state (and thus the persistent per-row cache). Internal phases:

- **Phase A — classify.** Re-read each row (`findEditorRowById`), build a
  minimal context (lift the modal's `buildDeriveContext` into this module), run
  `resolveEditorDerivedGlossaryUsage`. Buckets: `kind !== "derived"` → settled
  no-op; fresh cached entry → settled (resolved, cache hit); pivot text present
  → derivation queue; pivot text missing → generation queue (or `unresolved` if
  `generateMissingPivotText` is off).
- **Phase B — batched pivot generation.** Chunk the generation queue with
  `AI_BATCH_MAX_ROWS` / `AI_BATCH_TOKEN_TARGET` / `estimateSourceTokens` from
  `editor-ai-batch-request.js`. One `run_ai_translation_batch` per chunk:
  rows = each row's editor-source text, source = editor source language label,
  target = **glossary source language** label, no hints, no context window.
  Write each returned pivot text into the row's pivot column
  (`updateEditorRowFieldValue`) and, when `persistPivotTextToRow`, persist via
  `persistEditorRowOnBlur(..., { commitMetadata: { operation: "ai-translation", aiModel }, waitForDurable: false })`
  — same metadata the single-row path uses. Empty/missing results → `unresolved`.
  Successful rows join the derivation queue.
- **Phase C — batched derivation.** Chunk the derivation queue the same way
  (token estimate counts source + pivot text, since both enter the alignment
  prompt). One `prepare_editor_ai_translated_glossary_batch` per chunk with the
  chunk's pivot texts joined by `\n\n`. Redistribute returned entries per row by
  `sourceText.includes(sourceTerm)` (the existing translate-all logic, moved
  here). Before applying, re-check the row still exists and its source text is
  unchanged since classification — skip (unresolved) otherwise. Apply via
  `buildDerivedGlossaryState` + `applyEditorDerivedGlossaryEntry` with a
  `createBatchDerivedRequestKey`-style request key. A failed chunk moves its
  rows to `unresolved` (callers decide the fallback); it does not abort the run.

`isRunActive()` is checked after every await; a dead run returns
`{ aborted: true }` immediately without further writes.

### Translate All refactor

`resolveBatchDerivedGlossary` becomes a thin wrapper over
`ensureBatchDerivedGlossaries`:

- Increment 1 is behavior-preserving: `generateMissingPivotText: false`, so
  missing-pivot rows land in `unresolved` → existing `fallbackEntries` path.
- Increment 2 turns on `generateMissingPivotText` (+ `persistPivotTextToRow`,
  matching what the single-row fallback already does today via
  `syncGlossarySourceTextToRow`). Single-row fallback remains only for
  `unresolved` rows (chunk failure, empty generation, stale source).
- Hint building (`buildEditorAiTranslationGlossaryHints` per row from the
  freshly cached `matcherModel`) **stays in the translate flow** — it is
  translation-prompt concern, not derivation concern. After the shared call,
  the flow reads each resolved row's entry from chapter state and builds
  `entry.hints` / `entry.glossarySourceText` exactly as today.

### Derive Glossaries modal refactor

`confirmEditorDeriveGlossaries` keeps its work-list builder, modal state,
progress model, and cancellation semantics; the per-item serial loop is
replaced by:

1. Group work items by `sourceLanguageCode` (target is always the glossary
   target, so grouping by source language is grouping by pair).
2. Per group, call `ensureBatchDerivedGlossaries` with
   `useCurrentGlossarySourceText: true`, `generateMissingPivotText: true`,
   `persistPivotTextToRow: true`, `editorSourceLanguageCode` = chapter source
   (the modal generates pivot text from the chapter's editor source column,
   not the item's derivable language — preserving today's
   `generationSourceText` behavior).
3. Progress: `onItemSettled` drives `incrementEditorDeriveGlossariesProgress`
   + the modal completed/total counters and the
   `translate-derive-glossaries-modal` scoped render. Cache hits and no-ops
   count as completed (as today); resolved derivations also increment
   `derivedCount` for the completion badge.
4. `unresolved` items retry once through the existing single-row
   `prepareEditorDerivedGlossaryForContext` path (same fallback philosophy as
   translate-all). An error in the fallback stops the run with the error shown
   in the modal — unchanged from today.
5. Row renders: after each chunk applies, render the affected rows via the
   existing `translate-visible-rows` scoped render (rowIds of the chunk),
   replacing the per-item `renderDerivedGlossaryState` callback.

`activeDeriveGlossariesRunId` + modal status feed `isRunActive`. Cancel
mid-chunk: in-flight invoke results are discarded (the shared module's
post-await guard), no further writes occur — matching `5cf4539f`'s
cancelled-mid-persist handling.

### Accepted quality trade-off

Combined-span alignment can occasionally attribute a `source_term` using
another row's context; the per-row containment filter mitigates this. Unlike
Translate All's ephemeral prompt block, the modal writes persistent cache
entries, so a bad alignment lingers until the row's source text changes. This
is the same trade-off already accepted in `24211acb`, and the single-row
fallback remains available (re-running the modal after editing a row re-derives
it). Noted; no additional mitigation in phase 1.

## Increments (one commit each)

1. **Extract** `editor-derived-glossary-batch-flow.js` from
   `resolveBatchDerivedGlossary`; Translate All calls it with
   `generateMissingPivotText: false`. Behavior-preserving; move/extend the
   existing translate-all derivation tests.
2. **Batched pivot generation** (phase B) in the shared module; Translate All
   opts in. Missing-pivot rows no longer degrade to the single-row translate
   path except on failure.
3. **Modal switch-over**: `confirmEditorDeriveGlossaries` uses the shared
   module (grouping, progress, cancellation, single-row fallback).
4. Follow-up cleanup if increment 3 leaves dead code in
   `editor-derive-glossaries-flow.js` / `editor-derived-glossary-flow.js`
   (`npm run audit:unused` must stay clean).

## Testing

- Unit (`node --test`): new `editor-derived-glossary-batch-flow.test.js` —
  classification buckets, chunk boundaries (row cap + token target), per-row
  entry redistribution incl. terms matching multiple/no rows, stale-source
  skip at apply time, cancellation after each phase, chunk-failure →
  unresolved, persist-flag on/off. Both flows' existing tests updated via
  their `operations` injection seams (no new mocking infrastructure needed).
- Manual: chapter with a pivot glossary and 3+ languages — (a) modal run where
  most rows lack pivot text (verify pivot texts written + persisted, one
  commit metadata op per row, progress advances per chunk); (b) cancel
  mid-run (no writes after cancel); (c) Translate All over derived-glossary
  rows missing pivot text (verify no single-row fallback in the happy path);
  (d) offline mode still blocks both flows up front.

## Open questions / decisions taken

- **Translate All persists generated pivot text**: yes — the single-row
  fallback already writes it to the row today, so batching must not silently
  drop that behavior.
- **Progress granularity in the modal**: per chunk settle (all items in a
  chunk settle together). Coarser than today's per-item ticks but consistent
  with Translate All's UX; the modal's per-language totals are unchanged.
- **QA parity**: not applicable — glossary derivation is specific to the
  glossary domain model (pivot languages); QA lists have no derivation
  concept.
