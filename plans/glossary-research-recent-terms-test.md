# Recent Gnosis VN research comparison

## Objective

Test the previously selected `compact12-precise-nodict` method on the distinct terms in the local Gnosis VN ES–VI app research history. Compare directly with saved previous app results and with the earlier random-sample benchmark. Do not rerun the original pipeline, modify the glossary, or give saved targets/research outputs to compact research.

## Procedure

1. Freeze source-only terms and previous-run provenance. Use the latest completed result per term, retaining incomplete review-only proposals separately and labeling them provisional. Include all eight distinct terms in the available September 25–October 12 history.
2. Freeze a new corpus sample (up to 40 evaluation passages per term) and run the unchanged compact method in fresh subscription-authenticated Codex sessions. No human targets, old target variants, or prior app research evidence enters its prompt.
3. Import saved app entry drafts with the canonical report helper; use confirmed/frozen entries when available and proposal-only drafts otherwise. Preserve copied source stage hashes, native usage, status, model and timings. This comparison measures the actual saved results, not a newly human-seeded canonical run.
4. Translate the same evaluation passages using each entry with the earlier controlled carrier protocol. Fresh blind judges use the strict clear-correctness/absolute-grade rubric. Second-check every non-tie; disputes become ties. Report naturalness separately.
5. Audit overlap with both compact evidence and saved app research. Report individual terms, complete/provisional subsets, initial absolute grades, confirmed win/loss/tie, native-versus-CLI accounting limitations, and the earlier benchmark side by side.
6. If a clear compact regression occurs, test one focused source-only repair, preserving the unmodified compact result and reporting this as development rather than independent confirmation.

## Scope and limitations

Only scripts, experimental run artifacts and this plan change. The saved Íntimo run used a different model; native run wall time may include user review and idle time. Native inputs lack fixed CLI overhead, so cross-runtime input savings are descriptive. Saved previous research did not reserve the new evaluation sample; exposure must be audited rather than described as untouched holdout evidence. Related regenerar derivatives are correlated terms, not eight independent random draws.

## Progress

- Verified Gnosis-VN installation 125730441 and glossary ID 51c51903-130e-4065-845f-098adea36e78.
- Located seven completed unique term runs and one review-only term, Segunda Cámara. Duplicate/restarted histories will not become duplicate tests.
- Generated all eight unchanged compact entries and imported immutable native report defaults. First full checks confirmed two Regenerar correctness losses and four fluency losses; vanidad's two initial correctness preferences were disputed and retied.
- Single repair hypothesis: for a Spanish infinitive with insufficient source contexts, mechanically generate attached-pronoun forms (infinitive/gerund plus clitics), confirm them in the corpus, and fill the same 12-passage budget with nonreserved evidence. No human targets, saved source aliases, failed evaluation texts or new dictionary evidence enter the repair prompt. Preserve the original one-context result and all 40 evaluation passages.
- Completed the unchanged-method comparison: 219 passages, two confirmed correctness wins (Íntimo), two losses (Regenerar), 215 ties; naturalness one win, four losses, 214 ties. All clear differences second-checked; disputed preferences retied.
- The source-recall repair confirmed five attached forms, expanded the corpus pool from 41 to 74 passages, and recovered 34 nonreserved research passages. Tested the same 12-passage prompt with identical instructions/schema/effort; no full-text containment in either direction with the 40 reserved evaluations.
- Repair results: 40 correctness ties and 40 naturalness ties versus saved app results; five confirmed correctness wins and 35 ties versus the original compact parent, with 40 naturalness ties after confirmation. Assembled recent-term result: two wins, zero losses, 217 correctness ties; one win, zero losses, 218 naturalness ties. This is an exploratory repair, not a fresh confirmation sample.
- Conservative completed-run costs include both the original attempt and repair: eight research calls, 278.368 summed model seconds, 96,886 known input and 5,225 output tokens, versus native logs of 293 calls, 8,004.183 seconds, 956,814 input and 386,117 output. Native/CLI overhead and shared family acquisition differ; no app wall-clock claim.
- Focused protocol checks pass (11 tests), and real-run assertions verify source-only prompt inputs, unchanged repair instructions, preserved evaluation IDs, and source containment exclusions. Reproducible RECENT_RESULTS.md, side-by-side entries, raw provenance/usage and confirmed judgments are saved. Production app and glossary files are unchanged.
