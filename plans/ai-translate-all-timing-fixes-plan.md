# AI Translate All timing fixes

## Problem

A timed run of AI Translate All (2026-09-06: 20 rows, en→vi, pivot glossary of
735 terms, two batches) took 39.5 s. Temporary instrumentation attributed the
critical path as:

| Phase | Time |
|---|---|
| Derived-glossary pre-pass (AI 10.2 s + cache save 2.5 s) | 12.8 s |
| Batch translation call (15 rows) | 11.9 s |
| Single-row fallback for ONE row the model failed to echo | 11.4 s |
| Apply lane (assistant-log persistence, ~100 ms/row) | 2.2 s |
| Provider readiness | 1.6 s |

Main-thread freezes totalled ~8.4 s: derived-cache saves of 3.6 s and 2.5 s
plus ~100 ms per translated row.

Root causes, in cost order:

1. **Missing-row fallback.** `run_ai_translation_batch` silently drops rowIds
   it does not recognise, and every row missing from a batch response goes
   through the serialized single-row path (own provider check, own AI call,
   own save) — one dropped row costs as much as the whole batch.
2. **Derived-cache size.** `buildEditorGlossaryRevisionKey` returns the full
   JSON of every glossary term (~150 KB) and it is stored in every per-row
   derived entry. The store key `gnosis-tms-editor-derived-glossaries:*` is
   139 MB; each save clones it twice (`readPersistentValue` + `writePersistentValue`)
   and stringifies it for IPC.
3. **Per-row assistant-log persistence.** `logEditorAssistantTranslation`
   calls `persistAssistantState()` per row, cloning and IPC-ing the 8.8 MB
   assistant store key inside the batch apply lane.
4. **Stale row snapshot.** `translateBatch` reads rows from `rowsById`, built
   once at run start, so later language pairs send reference translations and
   target footnotes from before earlier pairs wrote their output.

Out of scope (noted, not changed): alignment chunk size / sequencing in Rust
(`GLOSSARY_ALIGNMENT_BATCH_SIZE`), and the nonlinear background git commit
time (5 rows 0.5 s, 14 rows 7.4 s), which needs Rust-side timing first.

## Design

### 1. Retry missing rows on the batch path; report unknown ids

- Rust `AiTranslationBatchResponse` gains `unknown_row_ids: Vec<String>`:
  ids the model returned that were not requested (after trim, deduped). The
  review batch response gets the same field for parity of the diagnostic.
- `translateBatch` becomes: call → apply returned rows (grouped save) →
  if any requested rows are missing, ONE retry through the same batch path
  with just those rows (same hints, same context) → apply → only rows still
  missing go to the single-row fallback. The retry takes a pool slot like any
  batch call and applies inside the lane like the first pass.
- The missing-rows warning logs `unknownRowIds` so a model that reformats ids
  is diagnosable from the console.

### 2. Hash the glossary revision key; migrate stored entries

- `buildEditorGlossaryRevisionKey` returns `h1:<hex>` — a 53-bit hash
  (cyrb53) of the same JSON it built before. Memoised per `glossaryState`
  object identity (WeakMap) since classification calls it once per row.
- `normalizeEditorDerivedGlossaryEntryState` converts a legacy JSON key
  (`{...}`) to its hash on the way in, so entries loaded from the old cache
  still compare equal to the new key for an unchanged glossary — no cache
  loss, no re-derivation cost.
- `saveStoredEditorDerivedGlossaryEntriesForChapter` migrates every entry in
  the loaded map before writing, so the first save after upgrade shrinks the
  whole key (139 MB → ~1 MB) instead of only the chapter being saved.
- `buildDerivedGlossaryTermInputs` is memoised the same way (2.7 ms/row
  measured, called once per row during classification).

### 3. Persist the assistant log once per batch

- `logEditorAssistantTranslation(payload, { persist })` — default `true`
  keeps the single-row behaviour. Translate All passes `persist: false` per
  row and calls the exported `persistEditorAssistantState()` once per batch
  in the same `finally` that flushes the grouped save, so an abort mid-batch
  still persists what was appended.

### 4. Read rows at batch time

- `translateBatch` builds its row lookup from the chapter state it captured
  at batch start, not from the run-start map. The run-start map stays for the
  chunker's token estimate only.

## Files

- `src-tauri/src/ai/types.rs`, `src-tauri/src/ai/mod.rs` (+ unit test)
- `src-ui/app/editor-ai-translate-all-flow.js` (+ tests)
- `src-ui/app/editor-derived-glossary-state.js` (+ tests)
- `src-ui/app/editor-derived-glossary-cache.js` (+ tests)
- `src-ui/app/editor-derived-glossary-flow.js`
- `src-ui/app/editor-ai-assistant-flow.js`

## Verification

- `npm test`, `npm run lint:js`, `cargo test` for the `ai` module.
- Re-run Translate All on a pivot-glossary chapter: derive-apply cache save
  should drop from seconds to milliseconds, apply lane from ~100 ms/row to
  ~10 ms/row, and a dropped row should cost one extra batch call, not a
  single-row round trip.

## Measured result (2026-09-06, 30 rows of a 233-row chapter, en→vi, pivot glossary)

| Metric | Before | After |
|---|---|---|
| Apply lane per row | ~105 ms | 2–4 ms |
| Derived cache save per chunk | 2.5–3.6 s | 12 ms (one-time 1.3 s migration save) |
| Assistant-log persistence | 90–120 ms per row | 70–85 ms per batch |
| Dropped-row recovery | 11.4 s single-row call | 3.7 s batch retry |
| Derived classification | ~2.5 ms/row | ~0.4 ms/row |
| `app-state.json` | 164 MB | 11 MB |

Total 37.8 s, of which ~37 s is provider latency (derive 8.4 s, batch calls
16.2 s and 25.4 s concurrent, retry 3.7 s). Non-AI overhead is now ~0.6 s.

## Re-measuring

The timing instrumentation is kept as a patch, not in the code:

```bash
git apply scripts/profiling/ai-translate-all-timing.patch      # add
git apply -R scripts/profiling/ai-translate-all-timing.patch   # remove
```

It adds `src-ui/app/editor-ai-timing-debug.js` and `// TEMP-TIMING` marks in
the two flow files. Events land as `ai-timing:*` lines in
`~/Library/Application Support/com.gnosis.tms/logs/editor-scroll-debug.jsonl`
(and the console). The patch applies onto the flow files as of this plan; if
those regions change later, re-derive the marks from the patch by hand.

## Next levers (not done)

- Batch sizing: with 30 rows and a pool of 6, only 2 of 6 slots were used
  (15-row batches). Sizing batches as `ceil(work / concurrency)` capped at 15
  would have run 6 five-row calls concurrently (~8–10 s) instead of two
  15-row calls (25 s critical path).
- Alignment calls in `prepare_ai_translated_glossary_with_rows` run
  sequentially in chunks of 8 matched terms.
- The context-window walk keeps adding rows whose source text is empty (203
  rows of `contextAfter` in this run; the prompt filters them, so only IPC
  size is affected).
