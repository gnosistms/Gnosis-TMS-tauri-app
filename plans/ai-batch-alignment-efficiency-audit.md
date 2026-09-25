# AI batch row-alignment audit: drift, correctness, token and general efficiency

Read-only audit of the batch translation path (`run_ai_translation_batch` and
`editor-ai-translate-all-flow.js`) after the user reported that runs which used
to complete in a few batched calls now proceed row by row, even on ~20-row
chapters. No application code, prompts, or chapter data were changed.

Companion documents: `ai-batch-row-alignment-investigation-plan.md` (the P11
misattribution incident) and `ai-batch-row-validation-plan.md` (the fix whose
side effects this audit measures).

## 1. Has it drifted, and is it functioning correctly?

It functions as specified. The slowdown is the specified behaviour of
`cec125f1 Validate numbered AI translation batch rows`, not a defect in it.

### 1.1 Root cause of the observed slowdown (confirmed)

`parse_validated_translation_batch_response` (`src-tauri/src/ai/mod.rs:876`)
rejects the **entire** response when the returned row count differs from the
requested row count, or when any label is unknown, blank, or duplicated. The
rejection surfaces as a command error from `run_ai_translation_batch`
(`src-tauri/src/ai/mod.rs:971`).

On the frontend that error is caught in `translateBatch` and routed to
`runSingleRowFallback(liveEntries)`
(`src-ui/app/editor-ai-translate-all-flow.js:916`), which is a strictly serial
`for … await` loop over every row of the batch
(`src-ui/app/editor-ai-translate-all-flow.js:730`).

So a 20-row chapter that chunks into 15 + 5 (`AI_BATCH_MAX_ROWS = 15`) behaves as:

| | Before `cec125f1` | After `cec125f1` |
|---|---|---|
| Partial response (12 of 15 rows) | apply 12, one batch retry for 3 | reject all 15 |
| Provider calls for that batch | 2, overlapping other batches | 1 + 15 **serialised** |
| Git commits for that batch | 2 grouped | 15 per-row |
| Whole 20-row chapter, both batches partial | ~4 calls, 6-wide concurrency | 2 + 20 serialised calls, 20 commits |

The investigation plan records that in the reported P11 run the model returned
12 of 15 rows and 4 of 5 rows, and states explicitly that "Both original
responses in this incident would have been rejected under that policy." That is
the exact input that now produces 20 sequential round trips.

Three amplifiers make it worse than "one call per row":

- The fallback holds the **apply lane** while it runs its AI call
  (`inApplyLane(() => withSlot(...))`, `editor-ai-translate-all-flow.js:731-733`).
  While 15 rows are retried one at a time, no other batch in the run can apply
  or save. The run degrades from 6-wide to effectively single-file.
- Each fallback row persists individually through `persistEditorRowOnBlur`
  (`editor-ai-translate-flow.js:715`), so the grouped-save optimisation — added
  precisely because per-row commits starve the write queue — is bypassed.
- There is no intermediate step. `ai-batch-row-validation-plan.md` step 3
  specifies "smaller batches **or** isolated single-row retries"; only the
  single-row branch was implemented.

### 1.2 New failure mode introduced by numeric labels

`format_translation_batch_row` now emits `<row id="1">` … `<row id="n">` instead
of the durable row UUID, and the response contract asks for the label back as a
JSON **string** (`src-tauri/src/ai/mod.rs:487`).

Only the OpenAI provider enforces that. `openai.rs:346-376` sends a strict JSON
schema with `"rowId": {"type": "string"}`. The other three providers do not:

- `claude.rs:125-131` rejects `JsonSchema` and otherwise ignores `output_format`
  entirely — no structured output at all.
- `gemini.rs:203-226` only sets a boolean "JSON output" flag; no schema.
- `deepseek.rs:39-44` sends `{"type": "json_object"}`; no schema.

`AiTranslationBatchStructuredRow.row_id` is a `String`
(`src-tauri/src/ai/mod.rs:779`), so a response containing `"rowId": 1` fails
serde deserialisation for the **whole** document, and
`parse_translation_batch_response` returns "malformed batch response". The
commit's own test asserts this rejection (`{"rowId":1}` in
`translation_batch_rejects_inconsistent_labels_without_salvaging_rows`).

Emitting an unquoted integer for a field whose example values are `"1"`, `"2"`,
`"3"` is a common model behaviour. With UUID labels it was impossible. On
Claude, Gemini, and DeepSeek this can send **every** batch of a run to the
serial per-row path.

Secondary: `"01"`, `"row 1"`, and `"1."` are all rejected too, and numeric
labels collide with the document's own numbering — the P11 chapter's rows begin
with "4: Atomic Science", "5: The Ninth Sphere". The contract has to spend a
sentence warning against exactly that collision
(`"not a chapter number or any other number in its text"`). Short opaque labels
(`r1`…`r15`, or `a`…`o`) keep the token saving, remove the collision, and are
far less likely to be emitted as JSON numbers.

### 1.3 Code that is now unreachable

Validation guarantees that a successful response contains exactly one entry per
requested row, mapped to distinct durable IDs. Therefore `missingEntries` is
**always empty** on the translation path, which makes the following dead:

- the missing-row computation and warning at
  `editor-ai-translate-all-flow.js:864-878`;
- the attempt-2 batch retry at `editor-ai-translate-all-flow.js:928`;
- `reportBackendNonfatalError({ reason: "missing-rows" })` at line 949 and the
  final `runSingleRowFallback(missingEntries)` at line 950;
- `unknown_row_ids`, hardcoded to `vec![]` at `src-tauri/src/ai/mod.rs:975` and
  still logged as `unknownRowCount` at `editor-ai-translate-all-flow.js:857`.

The retry path whose comment records a measured benefit ("one dropped row cost a
full provider round trip serialized after the batch (11 s of a 39 s run)") can
no longer run. Its test — "AI Translate All retries rows missing from the batch
response on the batch path before single-row" — passes only because it stubs
`runAiTranslationBatch` and returns a partial payload the real backend can no
longer produce.

### 1.4 Parity gap

`run_ai_review_batch` (`src-tauri/src/ai/mod.rs:1007-1016`) still uses durable
UUID row IDs and the permissive `retain_known_unique_rows`. The
misattribution risk the translation change addressed is unmitigated for Review
All, and the two batch paths now disagree on both labelling and acceptance
policy.

## 2. Token efficiency

Ordered by size of the win.

1. **The rejection path is the dominant token cost.** A rejected 15-row batch
   pays for the full batch prompt *and* 15 single-row prompts, each carrying its
   own instruction block, glossary block, and context window
   (`AI_CONTEXT_BEFORE_TOKEN_TARGET = 360`, `AI_CONTEXT_AFTER_TOKEN_TARGET = 220`).
   Rough order of magnitude: 5–10× the tokens of the batch it replaced. Fixing
   §1.1 and §1.2 is also the largest token saving available here.

2. **Glossary alignment re-sends the whole batch text per 8-term chunk.**
   `prepare_ai_translated_glossary_with_rows` loops
   `matched_terms.chunks(GLOSSARY_ALIGNMENT_BATCH_SIZE)` with
   `GLOSSARY_ALIGNMENT_BATCH_SIZE = 8` (`src-tauri/src/ai/mod.rs:1674, 2399`).
   Every chunk's prompt embeds the full `translation_source_text` and the full
   `glossary_source_text` (`build_glossary_alignment_prompt`,
   `src-tauri/src/ai/mod.rs:2155`). In the batch path those are the concatenated
   texts of all 15 rows (`prepare_ai_translated_glossary_batch`,
   `src-tauri/src/ai/mod.rs:2464-2486`). A 15-row batch matching 40 glossary
   terms sends the entire batch source **five times**. The items list is the only
   part that varies; raising the chunk size, or sending the texts once with all
   items, removes most of it.

3. **The response contract is stated three times.**
   `translation_batch_response_contract()` is pushed at
   `src-tauri/src/ai/mod.rs:564` and again at `:604`, and the "Output rule"
   section at `:566` restates the same one-entry-per-row-in-order-with-matching-rowId
   requirement a third time. The contract string roughly doubled in length in
   `cec125f1`, so the bookending now costs about twice what it used to. A full
   statement once plus a one-line reminder at the end would keep the bookend
   effect for a fraction of the tokens.

4. **`translatedFootnote` and `translatedImageCaption` are required for every
   row** by the strict schema, so every row spends output tokens on `""` pairs
   even when the chapter has no footnotes or captions at all. Rows without those
   sections could use a narrower schema per request.

5. **`AI_BATCH_TOKEN_TARGET = 4000` measures less than it appears to.**
   `chunkTranslateAllWork` budgets with `estimateSourceTokens` over source text
   only; reference translations, glossary hints, footnotes, image captions, and
   the two context windows are all outside the budget. The real prompt can be
   several times the target. This is a weak guard rather than a bug, but it
   means the "token target" cannot be reasoned about as a prompt-size cap.

## 3. General efficiency

1. **Serial fallback inside the apply lane** (§1.1). Even accepting that a
   rejected batch must be retried, the retry does not need to be serial and does
   not need to hold the apply lane. Splitting the rejected batch in half and
   re-running it through the pool would turn 15 serialised round trips into 2
   parallel ones in the common case, keep grouped commits, and preserve the
   whole-response guarantee at the smaller size.

2. **Per-row commits on the fallback path** (§1.1). The fallback should collect
   into `persistEditorRowsBatch` the way `requestAndApply` does.

3. **Glossary alignment chunks run serially inside one blocking IPC call**
   (`src-tauri/src/ai/mod.rs:2399`). Each chunk is an independent provider round
   trip with no data dependency on the previous one, yet they run one after
   another while holding a single pool slot. Concurrency here would cut derived-
   glossary preparation latency by the chunk count.

4. **The per-batch derivation call escapes the run's in-flight cap.**
   `resolveBatchDerivedGlossary` (`editor-ai-translate-all-flow.js:657`) calls
   `ensureBatchDerivedGlossaries` without `withSlot`, `inApplyLane`, or
   `concurrency`, unlike the `warmDerivedPair` pre-pass at line 1081 which passes
   all three. The module contract says AI calls go through `withSlot` when the
   caller shares the pool. In practice the warm pass usually leaves only cache
   hits, so this is a small leak (up to 6 uncapped calls), but it contradicts the
   pool's stated invariant that it caps *all* in-flight AI calls for a run.

5. **Dead diagnostics and dead retry code** (§1.3) should be removed or the
   retry re-enabled at a smaller batch size; leaving unreachable code that tests
   still exercise through stubs hides the behaviour change from the test suite.

## Recommended order of work

1. Replace the all-or-nothing → per-row cliff with an all-or-nothing → **halved
   batch** → per-row ladder. Preserves the anti-misattribution guarantee and
   removes the reported slowdown.
2. Switch labels from bare integers to short non-numeric tokens (`r1`…`rN`), and
   accept a JSON number for `rowId` by deserialising into an untagged
   string-or-number before validating. Removes the Claude/Gemini/DeepSeek
   whole-batch rejection risk and the chapter-number collision.
3. Batch the fallback's saves; do not hold the apply lane across a fallback AI
   call.
4. Send the alignment texts once per batch instead of once per 8 terms, and run
   the chunks concurrently.
5. Collapse the triplicated response contract.
6. Decide the Review All parity question: either give review batches the same
   labelling and whole-response validation, or record why the paths differ.

## Verification performed

- `node --test` on `editor-ai-translate-all-flow.test.js`,
  `editor-ai-batch-request.test.js`, `editor-ai-batch-pool.test.js` — 45 passed.
- `npm test` — 23 passed.
- Read-only review of `src-tauri/src/ai/mod.rs`, `src-tauri/src/ai/types.rs`,
  all four provider modules, `editor-ai-translate-all-flow.js`,
  `editor-ai-batch-request.js`, `editor-ai-batch-pool.js`, and
  `editor-derived-glossary-batch-flow.js`, plus `git log -L` on the batch-size
  constants.
- No provider calls were made and no chapter data was read or modified.

## Correction to one premise

`AI_BATCH_MAX_ROWS` has been **15 since the module was introduced**
(`ae33ff42`, verified with `git log -L 11,30:src-ui/app/editor-ai-batch-request.js`);
`AI_BATCH_TOKEN_TARGET` has always been 4000. There is no 50 anywhere in the AI
batching code or its history. A 20-row chapter has always chunked into 15 + 5.
The change the user is feeling is the collapse from those two batched calls to
twenty serialised ones, not a reduction in batch size.
