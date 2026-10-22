# Paragraph budgets and outcome-sensitive efficiency experiment

## Objective
Implement the requested paragraph and prompt reductions, then repeat the affected tenebroso stages through the native app. Preserve the completed original study and raw evidence in comparison history. Keep its full 101-paragraph / 112-occurrence final test as the fixed reference. Report time, input/output tokens, provider-cache reuse, and practical quality loss. Distinguish acceptable wording changes, lost nuance, misleading choices and materially wrong readings.

## Implementation
1. Add coverage-aware focused samples: five examples per ordinary meaning, ten for a large meaning; include all rare examples, source forms, decisive citations, distinct documents and observable grammatical cases. Keep the sample fixed across repairs; explicitly expand when failures expose a coverage gap. Final validation remains complete.
2. Rank missing-meaning recovery using a concise AI-generated source-language query profile and local text scoring/diversity. Check all missing meanings in each batch. Default to 100 additional paragraphs, with explicit continuation up to the existing shared 500 ceiling. Preserve full sources; bounded absence remains unresolved, not proof of absence.
3. Prepare preliminary bilingual reading aids only on request, with clear loading/error/cancellation states and persistent cache reuse. Source assignments become reviewable without waiting for all reading translations.
4. Supply whole occurrence paragraphs by default to exploratory decisions. Include neighboring context for recovered/explicitly expanded evidence or ambiguity-driven follow-ups. Final reference translation/assessment retains its full neighboring context. Never truncate the occurrence paragraph.
5. Start bibliography with three definition-oriented, document-diverse passages per author; retain all published reference metadata and complete retrieved evidence, with explicit expansion for unresolved comparisons.
6. Deduplicate request-level focused guidance and repeated definitions across source variants. Preserve exact per-occurrence span guidance and ordinary production glossary behavior across providers.

## Controlled comparison
Use a small in-app comparison controller to pin the existing reference and archive current reports before changed-stage runs. Reuse unchanged dictionary/source inventory for isolated downstream comparisons. Measure the smaller bibliography separately; do not silently let changed inventory redefine quality expectations. Measure classification/recovery against the original assignments before restoring the fixed reference for focused/complete-entry tests. Display this controlled scope explicitly. Include all 101 final paragraphs regardless of the new recovery result, and report discovery misses separately from translation outcomes.

No repeated calls to unchanged research stages solely to inflate a new end-to-end total. No claimed causal improvement from provider prompt-cache hits. The fixed source inventory/reference is an experimental control, not a promise of identical future discoveries.

## Outcome severity and counterfactual
The recovered paragraph is “Necesitamos franquearle el paso a la luz para iluminar las profundidades tenebrosas del Yo de la Psicología.” Its final reference translation used “dark depths,” not the unused candidate “unconscious.” Test a draft generated without the corresponding meaning/example and its associated usage advice; translate the same paragraph with the same source context. Assess faithfulness and whether omission induces an unwarranted evil/malice reading. Account for this probe separately from normal workflow costs. A missing label is not automatically a translation failure.

## Validation
Focused unit tests for representative selection/coverage, ranked recovery budget/continuation, whole-paragraph preservation, context escalation, request guidance deduplication, lazy reading-aid lifecycle, and reference preservation. Browser tests for on-demand examples and comparison navigation. Reuse the original final reference with actual new model calls and bounded concurrency. Run affected/full frontend checks and build; preserve native IPC contracts or rebuild/test any changed native code. Keep the computer awake during work and stop only the task-owned process at completion.

## Implementation and validation log

- Implemented deterministic five/ten-paragraph focused samples, with retained rare/recovered witnesses, observed forms, nominal uses and comparative cues. Full final validation stays unchanged; researchers can expand an individual meaning.
- Missing-meaning search now generates concise source-language clues, ranks saved candidates locally, and initially checks 100 additional paragraphs. Researchers can continue in 100-paragraph increments to 500.
- Source-only assignment omits neighbors initially and requests them for ambiguous paragraphs; recovered/explicitly expanded evidence retains neighbors. Whole occurrence paragraphs remain intact.
- Preliminary translations are on demand and separately timed. Browser tests exposed and fixed disclosure collapse and a cancel/retry race affecting the same paragraph.
- Bibliography starts with three passages per author, preserving all retrieved evidence and reference metadata. Shared guidance is serialized once across source variants in the native translation prompt; the native regression test passes.
- Controlled comparison study: `4982abfc-2523-4d31-8202-da3f895ebccb`, preserving original study `3f756442-80f5-4045-b21d-dbd0f23c7787` and its glossary entry. Dictionary and curated inventory remain controlled inputs; changed discovery results are archived separately.
- User clarified that the psychological-depths passage uses symbolic darkness. English “dark” preserves this implication without substituting “unconscious.” The semantic audit must judge imagery and reader impact rather than penalize the omitted label.
- 176 affected unit/render tests pass; 2,498 frontend tests pass. All 25 workflow tests pass when rerun with local port/process access. Native shared-guidance unit test and debug native app build pass. Browser regression suite is running.

### Preliminary measured result: bibliography

Original: 90.547 s, 56,805 input / 3,535 output tokens. Reduced sample: 73.570 s, 25,452 input / 3,296 output tokens (18.7% less elapsed time, 55.2% fewer input tokens, 6.8% fewer output tokens). No cached input reported in the new model call. This one run does not establish a stable latency average.

The new report preserves physical darkness, gloom, ignorance, psychological imagery, threefold classification, cosmic contrast, harmful agents and obscure expression. Compared with the original report it lacks a separate wrongful-secret-scheme example and verified Sanskrit glossary headwords. These are provenance/coverage losses, not established translation failures. The downstream experiment deliberately retains the original inventory so the complete final reference remains comparable. Further targeted source expansion remains appropriate when those distinctions matter.

## Completed live comparison

The following compares the last completed reference attempt for each changed stage with one new paragraph-budget attempt. Both focused runs include one human-approved comparative addition. Elapsed time excludes human review, native compilation, fixture tests, and the separate omission audit. Unchanged stages were reused; this is not a newly measured end-to-end total.

| Stage | Before seconds | After seconds | Before input/output tokens | After input/output tokens |
| --- | ---: | ---: | ---: | ---: |
| 4.4.1 | 90.547 | 73.570 | 56,805 / 3,535 | 25,452 / 3,296 |
| 4.6 | 173.798 | 67.203 | 184,770 / 12,327 | 37,005 / 3,236 |
| 8 | 240.086 | 138.640 | 141,075 / 16,704 | 33,510 / 5,896 |
| 9 | 141.870 | 133.822 | 85,181 / 13,837 | 81,992 / 13,828 |

Across these four stages: **646.301 → 413.235 seconds (36.1% less time)**; **467,831 → 177,959 input tokens (62.0% fewer)**; **46,403 → 26,256 output tokens (43.4% fewer)**; **61 → 38 model calls**. The baseline included 140,421 provider-cached input tokens; the new run reported none. Uncached input decreased from 327,410 to 177,959 (45.6%). No dollar savings are inferred from raw token counts. The 5.7% final-test timing difference is small enough to treat cautiously; final testing retained exactly the same 101 paragraphs / 112 occurrences and had only a 3.7% input reduction.

Focused preparation translated **33 paragraphs including the comparative preview, versus 108** before. Its final selected pool was 28 paragraphs across seven meanings. Rare single-example meanings and all five physical-darkness examples remained. No preliminary reading-aid translations were requested; opening them later incurs their own separately recorded cost. This workload saving would diminish if a researcher opens every reading aid.

### Quality and reader impact

- Complete production-guidance reference: **101 paragraphs, 112 occurrences, all passed on the first entry-validation pass**, with no repair. Confirmed forms remain **dark / darker**. The translator was not given expected meaning assignments.
- The smaller discovery run considered **100 additional paragraphs rather than 500** and did not recover the psychological-depths witness. It assigned seven original-sample occurrences differently and left the old concealed-wrongdoing category unrepresented. These are classification/coverage differences, not seven demonstrated translation errors: several reflect broad-versus-specific interpretations, and the same English form covers them. Original and new assignments are both preserved for review.
- The bibliography coverage differences described above remain visible. This controlled run reuses the original curated inventory and restores all original assignments for final validation; it therefore does **not** prove that every future reduced-discovery study will produce an equally complete inventory or provenance report.
- Separate omission audit: remove the recovered psychological interpretation and its candidate applicability; generate fresh notes using only the remaining definitions and confirmed forms, without supplying the held-out paragraph; then translate that paragraph with its normal source neighbors. The result was **“We need to clear the way for the light to illuminate the dark depths of the psychological Ego.”** The source-to-translation review classified this **acceptable**, preserving both imagery and implication without adding evil or malice. Human inspection agrees with the user's distinction: “dark” carries the symbolism without replacing it with literal “unconscious.” This example has **no detected glossary-selection harm** from the missing interpretation; the conclusion is specific to this evidence.
- Audit overhead is separate: 15.303 seconds, three additional calls, 1,839 input / 365 output tokens. It is experimental validation work, not part of the normal research workflow.

The original completed study and saved glossary entry remain unchanged. Raw outputs, original reports, timing records, full corpus evidence and the experimental reference are preserved in separate evidence files. The new study is complete at the final reference test and never entered glossary overwrite/save.

Reproduce the read-only metrics with `scripts/glossary-research-lab/studio-budget-comparison.mjs`, passing the two study manifest paths above. Native shared-guidance regression passes; 2,498 frontend tests, 25 workflow tests, 176 affected tests and all 45 Studio browser tests pass. The final debug native app is rebuilt with the tested workflow.

Final verification: the original reference remains complete at revision 438; its saved four source forms, dark/darker targets, and entire general translator note still match the original study. The 45 browser cases include lazy reading, cancellation, persistence and stable final passes. The final context-preservation adjustment and timing labels pass all 176 affected checks and lint. The read-only comparison CLI is declared as an audit entry point; unused audit remains at its pre-existing 343 files / 26 exports, with no new Studio findings. Native debug build and diff whitespace check pass. No source history or research notes were removed.
