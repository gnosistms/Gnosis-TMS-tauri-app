# Glossary research optimization experiment

Snapshot: 3,419 measured calls. Strict judging; source-only random seed 2070955783; 30 of 866 active ES–VI entries.

Completed full-sample evaluation.

## Recommended default

Use one guarded proposal from up to 12 raw corpus passages, with no routine dictionary lookup or repeated counting/consistency passes. Use every available passage for sparse terms. Preserve lexical labels, semantic categories and proper names; never invent expanded initials or insert definitions/extra attributes into the headword. The CLI supports this directly as `compact12-precise-nodict`, without a human glossary or baseline run.

Against the human-seeded reference: 31 confirmed correctness wins, 0 losses, 719 ties. Naturalness: 1 clear wins, 0 clear losses, 749 ties. The first independent grades mark 690 pairs both acceptable, 2 both needing correction, and 9 uncertain.

The isolated dictionary-removal comparison is reported below. The conditional audit fired on 24 of 29 positive-hit terms; its isolated 142-passage development comparison with the parent had no clear difference. A routine audit has not earned its extra cost. A focused check for a genuinely unresolved issue remains a proposed fallback.

## Correctness and naturalness

Wins and losses require a clear, material source-based correctness difference. Both accurate versions tie. Naturalness is separate and requires a clear fluency defect to prefer a side. Fresh independent agents grade both complete translations; raw grades and reasons remain saved. Non-tie findings receive a second independent check; disputed preferences become ties. Absolute acceptability/error counts describe the initial grades, so inspect disagreements rather than treating those grades as objective labels. Human candidates are fallible suggestions, never answer keys.

| Method vs human-seeded canonical reference | Terms with passages | Passages | Clear wins | Clear losses | Ties | Both acceptable | Both material errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| no-count | 3 | 59 | 0 | 5 | 54 | 52 | 0 |
| compact30 | 5 | 102 | 1 | 0 | 101 | 97 | 0 |
| compact12 | 5 | 102 | 1 | 0 | 101 | 97 | 0 |
| compact12-repair | 5 | 102 | 1 | 0 | 101 | 100 | 0 |
| compact12-precise-nodict | 29 | 750 | 31 | 0 | 719 | 690 | 0 |
| compact12-precise | 29 | 750 | 29 | 0 | 721 | 698 | 0 |
| compact12-audited | 29 | 750 | 25 | 0 | 725 | 688 | 0 |
| curated-proposal | 3 | 59 | 0 | 0 | 59 | 58 | 1 |

Human candidate advantage over unseeded original: 750 passages; 13 clear wins, 17 clear losses, 720 ties.

Dictionary removal vs otherwise identical precise parent: 750 passages; 0 clear wins, 0 clear losses, 750 ties.

## Effective research cost

Paired acquisition cost includes shared dictionary evidence and inherited proposal work. Seed preparation, translation and judging are separate. Six terms affected by interrupted/overlapping early controllers are excluded from paired savings; their quality results remain. Model-call seconds measure total concurrent work, not user-visible elapsed latency.

| Method | Paired terms | Calls saved | Model work saved | Known input saved | Known uncached input saved | Known output saved |
|---|---:|---:|---:|---:|---:|---:|
| no-count | 3 | 38.1% | 24.8% | 32.6% | 17.9% | 13.3% |
| compact30 | 5 | 93.4% | 94.5% | 84.6% | 86.9% | 96.5% |
| compact12 | 5 | 93.4% | 94.5% | 84.8% | 87.2% | 96.6% |
| compact12-repair | 5 | 93.4% | 94.6% | 84.8% | 87.8% | 96.7% |
| compact12-precise-nodict | 23 | 97.2% | 97.9% | 97.6% | 97.0% | 98.5% |
| compact12-precise | 23 | 94.7% | 95.9% | 86.9% | 89.5% | 97.7% |
| compact12-audited | 23 | 92.5% | 94.7% | 85.0% | 87.2% | 96.9% |
| curated-proposal | 3 | 33.3% | 21.4% | 28.4% | 13.3% | 11.0% |

## Subgroups and concrete regressions

### compact12-precise

Second checks: 39; disputed findings retied: 8. Naturalness: 1 clear wins, 1 clear losses, 748 ties. Absolute material errors: candidate 0, reference 35. Uncertain comparisons: 11.
Term-mean net correctness: 0.0261; term-cluster bootstrap 95% interval [0.0048, 0.0557]. This is exploratory uncertainty, not a formal equivalence test.
- development: 19 terms, 480 passages, {'win': 13, 'loss': 0, 'tie': 467}; net-loss terms: none.
- confirmation: 10 terms, 270 passages, {'win': 16, 'loss': 0, 'tie': 254}; net-loss terms: none.
- sparse_overlap: 15 terms, 190 passages, {'win': 2, 'loss': 0, 'tie': 188}; net-loss terms: none.
- no_detected_full_text_exposure: 5 terms, 200 passages, {'win': 24, 'loss': 0, 'tie': 176}; net-loss terms: none.

### compact12-audited

Second checks: 33; disputed findings retied: 7. Naturalness: 1 clear wins, 0 clear losses, 749 ties. Absolute material errors: candidate 0, reference 29. Uncertain comparisons: 27.
Term-mean net correctness: 0.0232; term-cluster bootstrap 95% interval [0.0066, 0.0453]. This is exploratory uncertainty, not a formal equivalence test.
- development: 19 terms, 480 passages, {'win': 6, 'loss': 0, 'tie': 474}; net-loss terms: none.
- confirmation: 10 terms, 270 passages, {'win': 19, 'loss': 0, 'tie': 251}; net-loss terms: none.
- sparse_overlap: 15 terms, 190 passages, {'win': 3, 'loss': 0, 'tie': 187}; net-loss terms: none.
- no_detected_full_text_exposure: 5 terms, 200 passages, {'win': 16, 'loss': 0, 'tie': 184}; net-loss terms: none.

### compact12-precise-nodict

Second checks: 49; disputed findings retied: 17. Naturalness: 1 clear wins, 0 clear losses, 749 ties. Absolute material errors: candidate 0, reference 46. Uncertain comparisons: 9.
Term-mean net correctness: 0.0278; term-cluster bootstrap 95% interval [0.0068, 0.0557]. This is exploratory uncertainty, not a formal equivalence test.
- development: 19 terms, 480 passages, {'win': 3, 'loss': 0, 'tie': 477}; net-loss terms: none.
- confirmation: 10 terms, 270 passages, {'win': 28, 'loss': 0, 'tie': 242}; net-loss terms: none.
- sparse_overlap: 15 terms, 190 passages, {'win': 2, 'loss': 0, 'tie': 188}; net-loss terms: none.
- no_detected_full_text_exposure: 5 terms, 200 passages, {'win': 14, 'loss': 0, 'tie': 186}; net-loss terms: none.

## Stage measurements

All attempted unseeded canonical research calls, including exploratory interruptions/retries; these totals are not the paired savings denominator.

| Stage | Calls | Model work (min) | Input tokens | Output tokens |
|---|---:|---:|---:|---:|
| counting | 433 | 280.9 | 6,079,926 | 401,826 |
| consistency | 191 | 126.4 | 2,652,865 | 180,433 |
| candidates | 29 | 95.6 | 443,864 | 148,259 |
| frequency | 153 | 74.0 | 2,092,587 | 111,347 |
| checks | 36 | 73.6 | 422,483 | 188,340 |
| sources | 48 | 64.8 | 794,226 | 90,111 |
| proposal | 30 | 59.1 | 598,388 | 119,284 |
| discovery | 82 | 46.3 | 1,045,444 | 59,366 |
| forms | 58 | 16.1 | 660,845 | 10,848 |
| parts | 29 | 14.5 | 372,791 | 15,655 |
| dictionary | 23 | 13.8 | 1,444,377 | 7,962 |
| summary | 29 | 13.4 | 373,111 | 13,113 |
| family | 34 | 11.7 | 388,072 | 9,380 |
| footnotes | 13 | 4.6 | 144,295 | 3,386 |
| convergence | 1 | 0.3 | 11,281 | 120 |

## Total experiment usage

| Role | Calls | Known input | Known output | Unknown usage calls |
|---|---:|---:|---:|---:|
| research | 2236 | 31,689,014 | 2,547,839 | 15 |
| evaluation | 525 | 6,835,474 | 674,705 | 1 |
| judge | 622 | 8,734,203 | 523,437 | 2 |
| seed-preparation | 36 | 399,051 | 3,891 | 0 |

## Interpretation limits

- The initially zero-hit term stops before the canonical engine. Its alias recall and full original workflow are untested; targeted variants or an example are needed before concluding that no usable corpus context exists.
- 750 term-passage comparisons (deduplicated within each term) across 29 positive-hit terms; 14 terms supply 40 passages, 15 are sparse, and one zero-hit term is retained. Do not pad sparse samples or infer quality for the zero-hit term.
- Corpus search windows overlap. A literal full-text exposure audit detects reserved passages embedded inside some larger research windows. The separate no-detected-exposure group is conservative and cannot exclude shorter overlapping excerpts.
- Controlled translation uses a shared neutral Vietnamese carrier; each method changes only the researched term and required grammar. This reduces unrelated translator variation but can preserve shared errors. Absolute grades expose both-bad ties. Independent full-translation pilots are retained separately.
- Judges are independent by fresh context, not by model family or human expertise. They see only sources and randomized translations, never glossary data or method names.
- The CLI adds substantial fixed per-call input overhead. Output-token savings and removed stages are stronger evidence for native-app savings than a literal extrapolation of CLI input savings.
- Native DLE webview retrieval and production output-token caps cannot be reproduced. Retrieval failures are recorded; canonical Wiktionary and measured dictionary-only web fallback remain.
- Account subscription limits are shared. Per-request CLI usage is measured; account-wide percentage changes cannot be attributed solely to this experiment.
- Original V.M. counting assigns 41 occurrences to no entry while reporting complete agreement. This is an audited canonical defect, not a trustworthy selection result. No production fix was made.
- Clear differences are checked twice; original ties are not exhaustively rejudged, so false-negative ties can remain. Corpus beliefs and human glossary choices are not truth labels.
- Existing glossary files and production app code were not modified. Optimized research received no prior human targets, notes, exclusions, or seeded-reference outputs.

See [PROCEDURE.md](PROCEDURE.md) for the conditional proposal and tested/proposed distinction, and [README.md](README.md) for commands, method definitions, provenance, and resumability. Raw evidence, stage timings, prompts, outputs, blind maps, judgments, exposure audit, and analyses are under `runs/2026-10-12/`.
