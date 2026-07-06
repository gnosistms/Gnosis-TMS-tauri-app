# AI Batch Translate All / Review All Plan

## Problem

The toolbar actions **AI Translate All** (`editor-ai-translate-all-flow.js`) and
**AI Review** (`editor-ai-review-all-flow.js`) process one row per model request.
Each work item currently produces:

- Translate All: one `run_ai_translation` invoke per (row, target language),
  each carrying its own glossary hints and its own row context window.
- Review All: one `load_gtms_editor_field_history` invoke (meaning mode), one
  `run_ai_review` invoke, and one `apply_gtms_editor_ai_review_result` write per row.

Modern models comfortably handle several rows per request. Batching N rows per
request cuts latency and cost, and removes the N-fold duplication of the glossary
block and the overlapping context windows.

## Current architecture (verified)

| Concern | Translate All | Review All |
|---|---|---|
| Work list | `buildEditorAiTranslateAllWork` — (rowId, sourceLang, targetLang) per empty target field, row-major order | `buildEditorAiReviewAllWork` — unreviewed rows for the selected target language, in row order |
| Per-row request builder | `buildEditorAiTranslateContext` (editor-ai-translate-flow.js) | `buildEditorAiReviewRequest` (editor-ai-review-request.js) |
| Context window | `buildAssistantSourceContextWindow` — token budgets `ASSISTANT_SOURCE_CONTEXT_PREVIOUS_TOKEN_TARGET = 75`, `NEXT = 25` (editor-ai-assistant-flow.js:58) | `buildEditorAiReviewSourceContextWindow` — budgets `REVIEW_SOURCE_CONTEXT_PREVIOUS_TOKEN_TARGET = 360`, `NEXT = 220` (editor-ai-review-request.js:5) — meaning mode only |
| Glossary | `resolveGlossaryUsage` per row: `direct` → `buildEditorAiTranslationGlossaryHints` against that row's source text; `derived` → per-row pivot glossary via `prepareEditorDerivedGlossaryForContext` (extra AI calls) | meaning mode only: `buildEditorAiReviewGlossaryHints` per row |
| History | Not sent to the model (`target_language_history: vec![]` in `build_translation_prompt`); history is only *written* afterwards via `logEditorAssistantTranslation` | meaning mode: per-row `loadAssistantTargetLanguageHistory` → `load_gtms_editor_field_history` (git log), passed as `targetLanguageHistory` |
| Response contract | `{"translatedText","translatedFootnote","translatedImageCaption"}` (`translation_response_contract`, ai/mod.rs) | `{"suggestedText","suggestedFootnote","suggestedImageCaption","reviewed"}` (`review_response_contract`) |
| Format enforcement | OpenAI: strict `json_schema` per `AiPromptOutputFormat` variant (openai.rs `openai_text_format`); DeepSeek: `response_format: json_object`; Claude/Gemini: prompt contract + tolerant parsing (`parse_*_response` tries raw / fence-stripped / brace-slice) | same mechanism, `ReviewJson` variant |
| Apply/persist | `applyEditorAiTranslatePayloadToRow` + `persistEditorRowOnBlur` per row (`waitForDurable: false` in batch-all mode) | `apply_gtms_editor_ai_review_result` write command per row |
| Staleness guards | `latestEditorTranslateSourceTextMatches`, request-key checks, `activeBatchRunId` | `activeReviewAllRunId`, re-reads row before each request |

## Design

### Batch shape

A **batch** is a run of consecutive work items (chapter row order) that share:

- the same `(sourceLanguageCode, targetLanguageCode)` pair (translate) or the
  single selected target language (review), and
- for translate: a glossary usage kind of `none` or `direct`.

Rows whose glossary usage is `derived` (pivot glossary): see "Derived-glossary
batching" below. In the **first landable increment** these rows may temporarily
keep the single-row path (the chunker flushes the current batch when it hits one,
emits it through the legacy path, and starts a new batch after it — in practice a
chapter is all-direct or all-derived for a given language pair, so mixed runs are
rare). But **the feature is not considered done while derived-glossary rows are
still processed row-by-row** — see the dedicated section. A chapter that uses a
pivot glossary would otherwise get none of the batching benefit, which is the
common case for this app's non-English source languages.

Batch size: `AI_BATCH_MAX_ROWS = 15` rows (starting value — see "Batch-size
tuning" for the empirical calibration that sets the final number), additionally
capped by a source-token budget `AI_BATCH_TOKEN_TARGET` (reuse the existing
`length / 4` heuristic) so a run of very long rows can't blow up the prompt or
push the model past the point where per-row quality degrades. Constants live next
to the flows; no user-facing setting in phase 1.

### 1. Glossary: dedupe once per batch

New helper in `editor-glossary-highlighting.js` (or a small new module
`editor-ai-batch-request.js`):

```
buildBatchGlossaryHints(rows, sourceLanguageCode, targetLanguageCode, glossaryModel)
```

Runs the existing matcher per row source text, concatenates the per-row hint
lists, and dedupes by the same `normalizeGlossaryToken(sourceTerm)` key the
single-row builder already uses. Result: one `<glossary_info>` block for the
whole batch. (Running the matcher on concatenated text would risk matches that
span row boundaries; per-row match + dedupe avoids that.)

Review meaning mode reuses the same helper.

### 1b. Derived (pivot) glossary: derive once per batch — required before done

**This closes the biggest gap in the row-by-row design.** When the glossary's
source language differs from the chapter source language, the app builds a
*derived* glossary: it pivot-translates the row source into the glossary source
language (`prepare_editor_ai_translated_glossary` → `prepare_ai_translated_glossary`
in ai/mod.rs), matches glossary terms against that pivot text
(`find_matched_glossary_terms`), and aligns them back to the actual source terms
in per-`GLOSSARY_ALIGNMENT_BATCH_SIZE` model calls. Today every one of those steps
is **per translation row**. If we batch translation but still derive the glossary
row-by-row, a pivot-glossary chapter still makes N glossary-derivation round trips
per batch — so the batch buys almost nothing. This is the common case for this
app's non-English source languages, so it must be fixed before the feature ships.

Batch-wide derivation:

1. **One pivot translation for the batch, not per row.** Concatenate the batch
   rows' source text (with row delimiters) and pivot-translate the whole span in
   one call — or, better, reuse the batch translation prompt's own context so the
   pivot is itself a batch request. The result is one `glossarySourceText` per
   batch. (`prepare_ai_translated_glossary` already accepts a supplied
   `glossary_source_text`; the change is to compute it batch-wide instead of
   row-wide.)
2. **Match + align once over the combined pivot text.** Run
   `find_matched_glossary_terms` against the whole batch pivot text, dedupe the
   matched terms (same normalized-token key as elsewhere), and run the alignment
   calls once for the batch. This yields a single derived matcher model covering
   every term that appears anywhere in the batch.
3. **Feed the batch prompt the one derived glossary**, exactly as the `direct`
   case feeds `buildBatchGlossaryHints` — the two converge on "one
   `<glossary_info>` block per batch," differing only in how the hints are
   produced.

New backend surface: a batch variant of the preparation command
(`prepare_ai_translated_glossary_batch`, taking `Vec<row source text>` +
combined-pivot handling) rather than N single-row calls. The per-row
`prepare_ai_translated_glossary` stays for the single-row toolbar path.

Alignment cost note: alignment is already chunked at
`GLOSSARY_ALIGNMENT_BATCH_SIZE = 8` matched terms per call. Batching *rows* into
one derivation means those chunks now cover the whole batch's matched terms at
once instead of repeating the fixed per-row overhead (pivot translation + match)
N times — that fixed overhead is where the savings are.

Staging: the chunker's "flush to legacy single-row path on a derived-glossary
row" behavior is acceptable **only as an intermediate commit**. The plan's
definition of done requires derived-glossary rows to flow through batch-wide
derivation. Implementation order below schedules this as its own phase, after the
`direct`/`none` batch path is proven, so it lands as a reviewable unit rather than
blocking the first increment.

### 2. Constrained batch response format

New Rust request/response types in `ai/types.rs`:

```rust
AiTranslationBatchRequest {
  provider_id, model_id, installation_id,
  source_language, target_language, source_language_code, target_language_code,
  glossary_hints: Vec<AiTranslationGlossaryHint>,        // deduped, batch-wide
  context_before: Vec<AiAssistantRowWindowEntry>,        // rows preceding the batch
  context_after: Vec<AiAssistantRowWindowEntry>,         // rows following the batch
  rows: Vec<AiTranslationBatchRowInput>,                 // rowId, sourceText,
                                                         // sourceFootnote, sourceImageCaption,
                                                         // targetFootnote/targetImageCaption presence flags,
                                                         // alternateLanguageTexts
}
AiTranslationBatchResponse { rows: Vec<AiTranslationBatchRowResult>, prompt_text }
AiTranslationBatchRowResult { row_id, translated_text, translated_footnote, translated_image_caption }
```

and the review equivalents (`AiReviewBatchRequest` carries `review_mode`, per-row
`targetLanguageHistory`, and per-row latest/source sections; row result carries
`suggested*` + `reviewed`).

Response contract (mirrors the single-row contracts):

```
Return only valid JSON:
{"rows":[{"rowId":"","translatedText":"","translatedFootnote":"","translatedImageCaption":""}]}
Return exactly one entry per row in <rows_to_translate>, in the same order, with the matching rowId.
```

Two new `AiPromptOutputFormat` variants — `TranslationBatchJson` and
`ReviewBatchJson`:

- **OpenAI**: strict `json_schema` with a `rows` array whose item schema matches
  the row result (add to `openai_text_format`, mirror the existing tests).
- **DeepSeek**: `response_format: json_object` (extend `response_format_for`).
- **Claude / Gemini**: prompt contract only, as today.

Parsing (`parse_translation_batch_response` / `parse_review_batch_response` in
`ai/mod.rs`): reuse the fence-strip / brace-slice candidate approach, then
validate: every returned `rowId` must be in the request, no duplicates. Rows
missing from the response are reported back as unresolved — **not** an error for
the whole batch. Unit-test malformed cases (missing row, extra row, duplicate
rowId, fenced output, prose-wrapped JSON).

New Tauri commands `run_ai_translation_batch` and `run_ai_review_batch`
(register in `lib.rs` `generate_handler![]`, `spawn_blocking` like the
existing ones). The single-row commands stay untouched — the per-row toolbar
buttons and the assistant continue to use them.

### 3. Context window: once per batch, not per row

The current "j before / k after" is a token budget, not a row count — and today
translate and review use different budgets (75/25 vs 360/220) with two
copy-pasted builder functions. Decision: **one shared budget pair for both
features, single-row and batch alike**:

```
AI_CONTEXT_BEFORE_TOKEN_TARGET = 360
AI_CONTEXT_AFTER_TOKEN_TARGET = 220
```

(adopting the review values — the richer context is cheap relative to the
translation quality it buys; the translate/assistant path simply gets more
context than before). Both duplicated builders
(`buildAssistantSourceContextWindow` in editor-ai-assistant-flow.js and
`buildEditorAiReviewSourceContextWindow` in editor-ai-review-request.js) are
replaced by one shared module, `src-ui/app/editor-ai-context-window.js`,
exporting the constants plus:

- `buildRowSourceContextWindow(chapterState, rowId, sourceLanguageCode, targetLanguageCode)`
  — the existing single-row shape (before + row + after in one array), used by
  the assistant, single-row translate, and single-row review paths.
- `buildBatchSourceContext(chapterState, firstRowId, lastRowId, sourceLanguageCode, targetLanguageCode)`
  — returns `{ contextBefore, contextAfter }` for the batch prompt.

For a batch the prompt contains:

```
<context_before>   rows preceding the FIRST batch row, up to the previous-token budget
<rows_to_translate>  the batch rows themselves, each as <row id="...">…</row>
<context_after>    rows following the LAST batch row, up to the next-token budget
```

Nothing is repeated per row: the batch rows are their own mutual context.

`buildBatchSourceContext` walks backward from the row before `firstRowId` and
forward from the row after `lastRowId` using the same token-estimate loop as
the existing builders, and returns `{ contextBefore, contextAfter }`
(rowId/sourceText/targetText entries — context rows that are already
translated include their target text, which helps terminology consistency,
same as today's `rowWindow`).

The old per-feature constants (`ASSISTANT_SOURCE_CONTEXT_PREVIOUS/NEXT_TOKEN_TARGET`,
`REVIEW_SOURCE_CONTEXT_PREVIOUS/NEXT_TOKEN_TARGET`) are deleted in favor of the
shared pair above — this also fixes the misleading "previous/next" naming
(the "j/k labels" issue).

Prompt side (`build_translation_batch_prompt` / `build_review_batch_prompt` in
`ai/mod.rs`): render `<context_before>` / `<context_after>` with the existing
`format_assistant_source_context`-style row lines, omitting the tag entirely
when empty (first rows of a chapter have no before-context; last rows no
after-context). Each `<row id="…">` block contains that row's
`source_text` / `source_footnote` / `source_image_caption` (translate) or
source+latest sections (review), plus per-row `reference_translations` when
non-empty.

### 4. History data in the batch input

- **Translate**: the single-row prompt does not send history to the model, so the
  batch prompt doesn't either. The *write-side* history logging
  (`logEditorAssistantTranslation`) still happens per row after applying each
  batch row result; `promptText` is the shared batch prompt, and
  `providerContinuation` is stored as `null` for batch-produced rows (it is only
  consumed by the assistant refinement flow for the active row, which uses the
  single-row path).
- **Review (meaning mode)**: history must ride along per row. The batch request
  carries `targetLanguageHistory` inside each row input, rendered inside that
  row's `<row>` block with the existing
  `format_assistant_target_language_history` formatter.
  Loading: replace the serial per-row `loadAssistantTargetLanguageHistory` await
  with a bounded-concurrency `Promise.all` (3 at a time) over the batch's rows
  before issuing the batch request. A dedicated batch git-history command is a
  possible follow-up (note: Windows argv limits — see v0.8.53 fix — argue for
  keeping git invocations per-row even then).
- Review grammar mode sends no history/source/context, so its batch prompt is
  just the contract + per-row latest sections.

### Flow integration

**Translate All (`editor-ai-translate-all-flow.js`)**

1. Keep `buildEditorAiTranslateAllWork` as-is; add a chunker
   `chunkTranslateAllWork(work, chapterState)` producing batches per the rules
   above (consecutive rows, same language pair, none/direct glossary, size/token
   caps; derived-glossary items become single-item legacy batches).
2. New `runEditorAiTranslateBatch(render, batch, operations)`:
   - Re-validate each row at send time (same freshness checks as today); drop
     rows that no longer need work.
   - Build batch glossary hints + batch context, invoke
     `run_ai_translation_batch`.
   - On response, for each returned row **in order**: re-check
     `latestEditorTranslateSourceTextMatches` and target-still-empty for that
     row; if stale, skip it (leave field untouched). Otherwise apply via
     `applyEditorAiTranslatePayloadToRow` semantics, render row-scoped, persist
     via `persistEditorRowOnBlur(..., { waitForDurable: false, commitMetadata:
     { operation: "ai-translation", aiModel } })`, and log history.
   - Rows the model failed to return go on a `unresolvedItems` list.
3. Fallback: unresolved rows (missing from response, or the whole batch call
   failed with a parse error) are retried once through the existing
   single-row `runEditorAiTranslateForContext`. Provider/key/offline errors
   abort the run with the existing modal error surface — no retry storm.
4. Progress/cancel: `activeBatchRunId` checks move to batch boundaries plus a
   check between applying rows of a completed batch; progress
   (`incrementEditorAiTranslateAllProgress`) still ticks per row as results are
   applied, so the modal counts look the same as today. Cancelling mid-flight
   lets the in-flight batch response be discarded (run-id check before apply).

**Review All (`editor-ai-review-all-flow.js`)**

1. Add `chunkReviewAllWork(work, chapterState)` (same chunker, single language).
2. Per batch: load per-row history concurrently (meaning mode), build the batch
   request via a new `buildEditorAiReviewBatchRequest` in
   `editor-ai-review-request.js` (reusing the section readers and the batch
   glossary/context helpers), invoke `run_ai_review_batch`.
3. Apply results per row exactly as today: skip rows now reviewed/emptied,
   `apply_gtms_editor_ai_review_result` per row (write path, permission queue,
   and commit metadata unchanged), `applyReviewResultToRow`, progress tick,
   row-scoped render. Per-row writes stay serial — they hit the repo write
   queue anyway.
4. Same unresolved-row fallback to the existing single-row `run_ai_review` call.
5. `reviewed` semantics per row are unchanged (empty suggestions + reviewed=true
   clears; reviewed=false sets pleaseCheck).

### Files touched

| Area | Files |
|---|---|
| Rust types/prompts/parsing | `src-tauri/src/ai/types.rs`, `src-tauri/src/ai/mod.rs` |
| Provider output formats | `src-tauri/src/ai/providers/openai.rs`, `deepseek.rs` (claude/gemini untouched beyond passing the new variants through) |
| Command registration | `src-tauri/src/lib.rs` |
| Batch request assembly (JS) | new `src-ui/app/editor-ai-batch-request.js`; `editor-ai-review-request.js`; `editor-glossary-highlighting.js` (export batch hints helper) |
| Shared context window | new `src-ui/app/editor-ai-context-window.js`; callers `editor-ai-assistant-flow.js`, `editor-ai-review-request.js` migrate to it and drop their local builders/constants |
| Flows | `src-ui/app/editor-ai-translate-all-flow.js`, `src-ui/app/editor-ai-review-all-flow.js` |
| Tests | `editor-ai-translate-all-flow.test.js`, new `editor-ai-batch-request.test.js` + `editor-ai-context-window.test.js`, review-all tests, Rust unit tests for batch prompt build + parse |

### Test plan

- **Rust**: batch prompt snapshot-ish assertions (contract present twice, no
  `<context_before>` when empty, per-row blocks with ids, single glossary
  block); parse tests for well-formed, fenced, prose-wrapped, missing-row,
  duplicate-row, unknown-row responses; OpenAI schema test mirroring
  `openai_assistant_prompt_request_uses_strict_json_schema_output_format`.
- **JS unit** (`node --test`): chunker (language-pair boundaries, derived-glossary
  flush, token cap, row cap); batch glossary dedupe; batch context builder
  (first-row-of-chapter → no before; last-row → no after; budgets respected);
  translate-all flow with a mocked batch operation (progress ticks per row,
  stale row skipped, unresolved row falls back to single-row path, cancel
  mid-batch discards results).
- **Manual** (`npm run tauri:dev`): Translate All on a chapter with 25+ empty
  rows against a real key (verify batching in the request log / prompt_text),
  Review All in both grammar and meaning modes, cancel mid-run, and a
  derived-glossary language pair still working via the legacy path.

### Batch-size tuning (empirical)

`AI_BATCH_MAX_ROWS` starts at **15**. The real ceiling is where per-row output
quality starts to degrade as n grows — the model begins dropping rows, blending
adjacent rows, mismatching `rowId`s, or truncating later rows. That point is
model- and content-dependent and must be measured, not guessed.

Method (calibration run against the real OpenAI API using the key already stored
in this app on this machine, `ai-provider/openai/api-key` in the Stronghold
snapshot):

- Take a representative chapter's source rows (mixed lengths, some glossary
  terms). For n ∈ {5, 10, 15, 20, 25, 30, 40}, send the batch translation prompt
  with the strict `json_schema` format and record: (a) did the response contain
  exactly one entry per row with matching ids, (b) per-row translation quality
  vs. the single-row baseline (spot-check + length sanity), (c) latency and token
  cost per row.
- Find the largest n where correctness stays at 100% (every row returned, ids
  matched) and quality shows no visible regression, then set `AI_BATCH_MAX_ROWS`
  a step below that as a safety margin.
- Record the curve (n → drop rate / quality) in this plan so the number is
  justified and re-checkable when models change.

This calibration is run **now**, during planning, so the default shipped in the
code is grounded. The token-budget cap (`AI_BATCH_TOKEN_TARGET`) is set from the
same run: the largest total source-token count that still behaved well.

#### Calibration results (2026-07-06, OpenAI)

Ran the real OpenAI Responses API with strict `json_schema` batch output (the
exact `{rows:[{rowId, translatedText}]}` schema this feature will use), driven
through the app's own provider code path with the key stored on this machine.

- **Model:** `gpt-5.5` (latest general GPT the app would auto-select).
- **Content:** 40 varied-length English literary sentences (one-word fragments
  through long multi-clause sentences) → Vietnamese, the app's real translation
  direction. For n > 40 the source rows cycle, so large batches also stress-test
  distinct `rowId` handling over duplicate source text.
- **Sizes:** n ∈ {5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100}, 2 trials each.

**Structural correctness: 100% at every size up to n=100.** Every batch returned
exactly n rows, every `rowId` matched the request, all ids unique, no empty
translations, no truncation. The tail rows of a 100-row batch (positions 80–99,
including the longest sentences) came back fully and faithfully translated — no
late-batch laziness or drop-off. Across sizes the only variation was natural
run-to-run synonym choice (e.g. *không ngừng* vs *không ngớt*), not degradation.

**Latency (wall-clock, single call):** n=5 ≈ 4–8 s, n=15 ≈ 8–11 s, n=25 ≈ 15–17 s,
n=40 ≈ 20 s, n=100 ≈ 40 s, with occasional tail-latency outliers (one 30-row
trial 65 s, one 80-row trial 58 s).

**Conclusion:** with a current frontier OpenAI model and strict schema
enforcement, there is **no quality cliff at least through n=100** — the model
does not start dropping, blending, or mistranslating rows as n grows. The real
limiting factors are therefore (a) per-batch **latency** (a bigger batch = a
longer single wait before any row updates) and (b) **failure blast radius** (one
failed/timed-out call loses more rows to the fallback path), not model quality.

**Decision:** keep `AI_BATCH_MAX_ROWS = 15` for the first ship. It gives good
per-batch latency (~8–11 s → responsive progress as batches complete), a small
blast radius, and proven-huge headroom. Raising it later toward 25–30 is safe on
this model class if throughput matters more than per-batch latency; the code
should make the constant easy to bump. This ceiling is **OpenAI-specific** —
Claude and Gemini here rely on the prompt contract + tolerant parser (no strict
schema on Claude in this app today; Gemini schema enforcement is a proposed add,
§2), so their safe n may be lower and should be spot-checked before raising the
shared default. The token cap `AI_BATCH_TOKEN_TARGET` guards the outlier case of
many very long rows (which this run did not specifically stress) rather than a
measured failure point.

### Implementation order

1. **Calibration experiment** (before coding): measure the batch-size quality
   curve against real OpenAI (above); fix `AI_BATCH_MAX_ROWS` and
   `AI_BATCH_TOKEN_TARGET`.
2. Rust: types + batch prompt builders + parsers + provider format variants +
   commands + tests. (Backend first per repo guidance — test commands in
   isolation before touching JS.)
3. JS: `editor-ai-context-window.js` (shared budgets + builders, migrate the
   assistant and review single-row paths onto it) and
   `editor-ai-batch-request.js` (chunker, batch glossary) + unit tests.
4. Translate All flow integration + tests (`direct`/`none` glossary path;
   derived-glossary rows temporarily flushed to the legacy single-row path).
5. Review All flow integration + tests.
6. **Derived-glossary batching** (§1b): batch-wide pivot + match + align, new
   `prepare_ai_translated_glossary_batch` command, chunker no longer splits on
   derived rows. **Required before the feature is considered done** — a
   pivot-glossary chapter must get the batch benefit too.
7. Manual verification pass; re-confirm `AI_BATCH_MAX_ROWS` / token target on a
   real chapter and adjust if latency or quality argues for it.

### Risks / notes

- **Cross-row contamination**: a model may merge or shift content between rows.
  Mitigations: explicit per-row ids + "exactly one entry per row, same order"
  contract, strict schema on OpenAI, per-row staleness re-checks before apply,
  and the single-row fallback for anything unresolved.
- **Claude/Gemini have no strict schema path** here — the tolerant parser plus
  fallback keeps behavior at least as good as today.
- **Larger prompts**: one batch prompt is still far smaller than N single
  prompts (glossary + context deduplicated), but the token cap guards outliers.
- **Provider continuation** is not meaningful per row in a batch; stored as
  null (only the assistant refinement flow consumes it, via the single-row path).
- Out of scope (possible follow-ups): a batched review apply/save command,
  batched git history command, a user-facing batch-size setting. (Derived-glossary
  batching is **in** scope — it is required before done, §1b.)
