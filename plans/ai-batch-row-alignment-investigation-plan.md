# AI batch row alignment investigation

Investigate reported misplaced Vietnamese translations in Test / P11 / chapter 37,
El collar del Buda, without changing the user's chapter data.

1. Trace Rust batch prompt construction, response parsing, and row validation.
2. Inspect available local chapter content and saved AI prompt/result logs to
   distinguish incorrect model attribution from application/persistence mapping.
3. Exercise relevant existing tests and a focused offline reproduction if needed.
4. Record evidence, root cause confidence, and a scoped corrective recommendation.

Status: complete. No provider calls, chapter writes, or application code changes.

Follow-up: investigate the user's suspected recent regression by comparing git
history and replaying saved accepted results through earlier orchestration code.
This isolates application behavior; it does not reproduce provider generation.

### Regression-history follow-up

- Multi-row backend requests were introduced on July 6 in `4546b738`; the
  Translate All integration followed in `c2089c19`. Earlier Translate All sent
  one row per request. `build_translation_batch_prompt` itself has not changed
  since its introduction (verified with function-level git history).
- Batch concurrency was introduced July 25 in `02dd421d`.
- September 6's `81aad516` changed missing-row recovery from individual calls
  to a batch retry, persisted assistant logs once per response, and refreshed
  row snapshots before each batch. Its Rust filtering refactor preserves the
  previously retained rows and adds unknown-ID diagnostics.
- An isolated offline replay of the 20 saved accepted Vietnamese results into
  the orchestration module at `81aad516^` and at HEAD produced identical final
  results, including all five misalignments. The older flow made two batch
  calls and four individual fallbacks; current made four batch calls. Provider
  calls and persistence were stubbed; unchanged helper dependencies used the
  current checkout. This tests the timing commit's apply/retry behavior, not
  the full older application or provider generation.
- The newer snapshot timing can change prompts when an earlier language pair
  fills reference translations during the same Translate All run. This is a
  remaining candidate for changing model behavior, not a proven trigger.
  English logs on this chapter precede Vietnamese by about a minute, but saved
  logs do not identify whether they belonged to one run or separate runs.
- Only September 6 translation logs remain for this chapter: 20 English and
  20 Vietnamese results, all using `gpt-5.6-luna`. There is no saved earlier
  successful Vietnamese run here to use as a controlled baseline.

Conclusion: the unsafe acceptance policy dates to batching, and today's retry
change does not explain the five initial misattributions. The exact trigger for
this newly observed failure remains unproven. A whole-response guard addresses
the observed acceptance defect; it is not evidence that the regression's
generation-side trigger has been identified. A controlled same-model/content
comparison of old versus current request construction is the next causal test.

### User-run model comparison: Astra versus Luna

The user reran Vietnamese translation with `gpt-6-astra`. Saved assistant logs
at 13:00:29–13:00:34 UTC show 20 results from two requests (15 and 5 rows), with
zero chapter-heading-number mismatches. Both Astra prompt strings are exactly
identical to Luna's two original prompt strings, including sources, references,
glossary, context, and row IDs. Astra needed no additional retry prompts in the
saved results; Luna had five misaligned headings and two retry prompts.

This is a direct same-prompt comparison supporting model-dependent alignment
reliability for this incident. It does not establish a universal safe batch
size or rule out stochastic variation. Luna also failed on the five-row request,
so the evidence does not support treating five rows as a validated safe limit.
The application-side acceptance gap remains regardless of model selection.

## Findings (2026-09-06)

Confirmed against the local assistant cache, chapter row files, and git history:
Test-team-32 / P11 (repository p1), chapter `37) EL COLLAR DEL BUDDHA.toc`.
The run at 12:48:43–12:48:54 UTC used OpenAI `gpt-5.6-luna`.

All 20 persisted Vietnamese row texts match their saved AI result logs exactly.
The saved prompts associate the correct Spanish source and English reference
with each requested row ID. Five results are nevertheless attached to the wrong
source row:

| Editor row (including title) | Source chapter heading | Result chapter heading |
| --- | --- | --- |
| 6 | 5: The Ninth Sphere | 4: Atomic Science |
| 7 | 6: Sexual Energy | 5: The Ninth Sphere |
| 8 | 7: The Attraction of Opposites | 6: Sexual Energy |
| 9 | 8: Sexual Hydrogen SI-12 | 7: The Attraction of Opposites |
| 20 | 19: The Venustic Initiation | 18: The Chinese Master Wu Wen |

### Failure mechanism

1. The original 15-row batch produced 12 accepted results. Chapter headings 4,
   9, and 10 were absent from that accepted set and retried together. Four of
   the accepted results were shifted (chapter headings 5–8).
2. The second, five-row batch produced four accepted results. Chapter heading
   18 was absent from that accepted set and retried. Chapter heading 19 already
   carried chapter heading 18's translation.
3. Both retry requests succeeded, filling the missing rows. The already-applied
   shifted results remained, producing duplicated headings.

Git commits confirm the 4 + 1 and 12 + 3 application groups:
`df8651a`, `86259f4`, `50ae65e`, `d840462`.

`src-tauri/src/ai/mod.rs::run_ai_translation_batch` parses the model JSON and
passes rows through `retain_known_unique_rows`. This verifies that IDs belong
to the request and keeps the first duplicate, but cannot verify that a result
translates the source belonging to that ID. It permits incomplete batches.

`src-ui/app/editor-ai-translate-all-flow.js::requestAndApply` builds a map keyed
by returned row ID, applies all recognized results, then retries only missing
IDs. `applyBatchRowResult` and `applyEditorAiTranslatePayloadToRow` preserve
that ID through state updates and persistence. There is no positional zip or
completion-order indexing in this path. The saved prompt/result/disk agreement
supports model-side attribution failure plus permissive batch acceptance,
rather than a rendering or persistence row shift.

The original raw provider JSON is not retained in the assistant cache. Thus
we cannot distinguish omitted IDs from malformed/unknown IDs filtered by Rust,
or reconstruct discarded duplicates. The accepted results and retries are
available and sufficient to establish the application failure mechanism.

### Recommended correction

- Validate the entire response before applying any row. Missing, unknown,
  blank, or duplicate IDs should invalidate that batch, followed by smaller
  batches or isolated single-row retries. Both original responses in this
  incident would have been rejected under that policy.
- Use short request-local identifiers mapped back to durable row UUIDs in
  Rust. The current IDs share long prefixes; short distinct labels reduce
  copying difficulty, but do not prove semantic correctness.
- Add regression coverage for partial responses with plausible but wrongly
  attributed neighboring text, duplicate IDs, and reordered valid responses.
- Complete ID sets can still contain swapped translations. Strict JSON and
  shorter IDs alone cannot guarantee semantic alignment; further validation
  or isolated row requests are needed for stronger protection. Numbered
  headings provide an inexpensive check for this specific content.

The previous batch-size calibration used a different model and content; its
successful structural checks do not establish alignment reliability for this
run. The failure also occurred in a five-row batch, so simply reducing the
15-row default to five is insufficient for this observed case.

## Verification

- Rust: `cargo test --offline --manifest-path src-tauri/Cargo.toml --lib batch
  -- --nocapture` — 15 passed (includes prompt/parser/schema tests).
- Frontend: translate-all flow, batch request, translation payload, and context
  window test files — 44 passed, including concurrent calls and missing-row
  retry behavior. Existing tests do not catch semantic misattribution.
- Read-only comparison: all 20 disk results match the latest run's saved AI
  results; five heading-number mismatches confirmed.
