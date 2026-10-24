# Four selected glossary terms

**Complete.**

## Required success test: improvement over no glossary

The user requires actual translation improvement over no glossary. Each selected entry is compared with its exact saved neutral drafts on the same forty passages. Ties earn no credit. Fresh independent blind judges assess clear correctness and fluency; another fresh judge confirms every non-tie. These are exploratory selected cases, not the new frozen random confirmation. Earlier W/L/T against saved app/full research show relative behavior only and cannot establish glossary success.

| Term | Verified passages | Correctness gains | Harms | Net gain | Naturalness gains / harms / net |
|---|---:|---:|---:|---:|---|
| vanidad | 40 / 40 | 1 | 0 | +1 | 0 / 0 / +0 |
| mundos | 40 / 40 | 0 | 0 | +0 | 0 / 0 / +0 |
| Íntimo | 40 / 40 | 0 | 0 | +0 | 0 / 0 / +0 |
| fatal | 40 / 40 | 0 | 0 | +0 | 0 / 0 / +0 |

Verified selected-entry effects: 1 correctness gains, 0 harms, net +1, on 160 of 160 passages. No-glossary assessment complete: True. Net zero means no net benefit demonstrated on this sample; it is not a success because another glossary also ties.

### vanidad: changes against no glossary

- 21cfecff0dff53b3: Ở đây “todo eso es vanidad” nói những việc thế gian là vô nghĩa; B dùng “hư danh”, chuyển sang danh tiếng hão và làm sai lý do họ không làm việc.

### Exploratory control: focused revision without research

The controlled glossary translation is a second, term-focused revision of the neutral draft. A source-only revision with the same term focus, no glossary targets and no research tests whether extra attention can provide the observed improvement. This control is selected after seeing the vanidad gain; it is an exploratory alternative, not a validated universal skip rule. The primary no-glossary baseline remains unchanged.

Vanidad source-only revision: 0 confirmed correctness gains, 0 harms, net +0, on 0 of 40 passages. Complete: False. Glossary-minus-control paired net correctness effect: +0 across 0 jointly verified passages. Same-passage effect matrix: {}. A shared gain shows that extra revision can supply the benefit without research; it does not prove that every glossary insight or unseen passage is redundant.

## Tested repairs on these four cases

The selected repairs have **2 / 0 / 158** confirmed correctness wins / losses / ties, and **1 / 0 / 159** naturalness wins / losses / ties. Completion: **True**. References remain the same as in the unchanged-method table below.

| Term | Tested change | Correctness W / L / T | Naturalness W / L / T | Confirmed complete | Both need correction initially |
|---|---|---|---|---|---:|
| vanidad | Short source-only coverage scout + Spanish dictionary | 0 / 0 / 40 | 0 / 0 / 40 | True | 0 |
| mundos | Diverse contexts + scope guard + Spanish dictionary | 0 / 0 / 40 | 0 / 0 / 40 | True | 0 |
| Íntimo | Diverse contexts + bounded source-book provenance | 2 / 0 / 38 | 1 / 0 / 39 | True | 0 |
| fatal | Short source-only coverage scout + Spanish dictionary | 0 / 0 / 40 | 0 / 0 / 40 | True | 0 |

## Entry completeness, assessed separately

| Term | Finding in selected output | Evidence and limit |
|---|---|---|
| Íntimo | Distinguishes the divine noun (Đấng Nội Tại) from adjectives (nội tại / sâu thẳm bên trong); identifies Innermost in The Dayspring of Youth. | Printed source-book glossary pair and original passages, independent of the Gnosis Vietnamese glossary. Establishes the source relationship, not first coinage, exclusive origin or a proven direct borrowing route. |
| fatal | Includes harmful/disastrous uses, fate and inevitability; reserves lethal translations for source-supported death contexts. | The scout finds previously unsampled inevitability contexts. Avoids treating Spanish fatal as uniformly equivalent to English fatal. |
| vanidad | Explains appearance and reputation concern; retains rare futility, transient things and empty speech senses. | Source counterexamples require rare exceptions; a blanket ban on futility would reduce accuracy. |
| mundos | Includes hành tinh for planetary contexts and thiên thể where the broader celestial category is required, alongside cõi / thế giới. | A fresh Spanish-only audit of 100 exact-plural contexts finds 29 celestial/world contexts, 31 higher/inner realms and 26 infernal realms. The 29 are not all proven planets: this supports a substantial planetary/celestial branch, not one universal default or a count of Vietnamese target use. |

The primary [Dayspring text](https://glorian.org/books/the-dayspring-of-youth/yoga-teachings) independently contains Innermost. Expected answers from the user were kept outside all research/scout prompts. The source-sense audit was conducted after research as assessment evidence and did not guide the selected worlds entry.

## Selected research cost

| Term | Calls | Model seconds | Input tokens | Output tokens |
|---|---:|---:|---:|---:|
| vanidad | 2 | 89.6 | 32,287 | 2,257 |
| mundos | 1 | 40.0 | 16,608 | 2,517 |
| Íntimo | 1 | 29.9 | 15,805 | 1,112 |
| fatal | 2 | 107.7 | 41,115 | 2,726 |

| Term | Stage | Calls | Model seconds | Input tokens | Output tokens |
|---|---|---:|---:|---:|---:|
| fatal | compact-proposal | 1 | 59.0 | 13,123 | 1,589 |
| fatal | coverage-scout | 1 | 48.8 | 27,992 | 1,137 |
| mundos | compact-proposal | 1 | 40.0 | 16,608 | 2,517 |
| vanidad | compact-proposal | 1 | 62.1 | 12,805 | 1,353 |
| vanidad | coverage-scout | 1 | 27.5 | 19,482 | 904 |
| Íntimo | compact-proposal | 1 | 29.9 | 15,805 | 1,112 |

Selected policy: 6 calls, 267.2 summed model seconds, 105,815 input and 8,612 output tokens. Bounded local source/dictionary retrieval takes roughly a second per lookup and is recorded separately in evidence metadata.

Within the comparable fresh mundos/fatal runtime, the original human-seeded procedure took 141 calls, 6225.7 summed model seconds, 2,001,316 input and 165,924 output tokens. The selected repairs took 3 calls, 147.7 seconds, 57,723 input and 5,243 output tokens: 97.63% less model work, 97.12% less input and 96.84% less output. These are measured model-call sums, not a claim about elapsed app latency.

If escalation follows an initial default proposal, charge that too: default plus selected fallback on all four terms is 10 calls, 407.7 seconds, 154,583 input and 11,683 output tokens. For the comparable fresh pair, this conservative path uses 5 calls and still saves 96.42% model work, 95.91% input and 95.84% output. The six-call figure assumes the appropriate branch is selected up front; it does not include a validated free routing oracle.

The experiment actually spent 19 optimization research calls, 861.7 seconds, 383,642 input and 22,017 output tokens across these four terms, including initial attempts and rejected repairs. These costs are not hidden by reporting only the selected policy. Reference research, seed preparation, translation, judging and the post-research sense audit are separate ledger roles.

These repairs are supported development cases. A general automatic router and its decision thresholds have not yet been validated. Keep the one-call default, escalate for missing sense coverage or source provenance, and preserve broader category options. Increasing raw passage count alone did not solve fatal; a generic category warning alone did not solve mundos.

## Unchanged compact method

The unchanged compact method uses one glossary proposal from up to 12 source passages, with no routine dictionary, counting, consistency, origin or family research. Human targets and translator notes are never supplied to it. The references for vanidad and Íntimo are saved app outputs; mundos and fatal use the frozen original research procedure with isolated human-prepared candidate lists and explicitly forbidden translations removed. These reference types must not be treated as one controlled baseline.

Confirmed correctness wins / losses / ties: **2 / 0 / 158**. Naturalness: **1 / 0 / 159**. Wins/losses require a clear material correctness difference; equally good translations tie. Fresh blind judges receive only source+A/B translations. A second fresh judge checks all non-ties; disagreements become ties.

| Term | Reference | Source corpus passages | Research sample | Judged / reserved | Correctness W / L / T | Naturalness W / L / T | Both acceptable initially |
|---|---|---:|---:|---:|---|---|---:|
| vanidad | Saved app result | 155 | 12 | 40 / 40 | 0 / 0 / 40 | 0 / 0 / 40 | 38 |
| mundos | Fresh original procedure + human candidates | 7,388 | 12 | 40 / 40 | 0 / 0 / 40 | 0 / 0 / 40 | 40 |
| Íntimo | Saved app result (different model) | 2,124 | 12 | 40 / 40 | 2 / 0 / 38 | 1 / 0 / 39 | 35 |
| fatal | Fresh original procedure + human candidates | 287 | 12 | 40 / 40 | 0 / 0 / 40 | 0 / 0 / 40 | 40 |

## Research cost

Summed model-call seconds measure work, not elapsed app time. Native app and CLI input overhead differ; only the two fresh references share the compact runtime and model. Human candidate preparation/auditing is listed separately below. Every attempted call remains in the ledger, including failures and unknown usage.

| Term | Reference calls | Compact calls | Reference seconds | Compact seconds | Reference input | Compact input | Reference output | Compact output |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| vanidad | 59 | 1 | 1950.4 | 29.1 | 174,787 | 12,371 | 81,962 | 521 |
| mundos | 77 | 1 | 3312.2 | 45.8 | 1,069,760 | 12,019 | 86,823 | 1,135 |
| Íntimo | 25 | 1 | 907.2 | 36.3 | 76,860 | 12,248 | 38,626 | 885 |
| fatal | 64 | 1 | 2913.6 | 29.2 | 931,556 | 12,130 | 79,101 | 530 |

Additional reference preparation/audit: 3 calls, 43.8 seconds, 33,128 input and 303 output tokens. This overhead belongs to the human-seeded reference, not the optimized method.

## Added-term stage measurements

| Role | Method | Stage | Calls | Seconds | Input | Output | Unknown usage | Failures |
|---|---|---|---:|---:|---:|---:|---:|---:|
| acceptance-audit | source-sense-distribution | source-sense-distribution | 1 | 72.611 | 21185 | 2297 | 0 | 0 |
| evaluation | baseline-human | evaluation-translate | 8 | 304.191 | 106736 | 9755 | 0 | 0 |
| evaluation | compact12-coverage-spanishdict-precise | evaluation-translate | 4 | 135.215 | 53884 | 4862 | 0 | 0 |
| evaluation | compact12-diverse-precise-nodict | evaluation-translate | 8 | 299.441 | 110180 | 9652 | 0 | 0 |
| evaluation | compact12-precise-nodict | evaluation-translate | 8 | 284.379 | 107076 | 9898 | 0 | 0 |
| evaluation | compact12-scope-precise-nodict | evaluation-translate | 4 | 155.879 | 53852 | 4989 | 0 | 0 |
| evaluation | compact12-scope-spanishdict-precise | evaluation-translate | 4 | 158.77 | 57632 | 5058 | 0 | 0 |
| evaluation | compact12-spanishdict-precise | evaluation-translate | 4 | 140.85 | 52312 | 4643 | 0 | 0 |
| evaluation | compact12-webdict-precise-nodict | evaluation-translate | 4 | 146.196 | 52372 | 4805 | 0 | 0 |
| evaluation | compact30-diverse-spanishdict-precise | evaluation-translate | 4 | 116.491 | 52804 | 4598 | 0 | 0 |
| evaluation | shared-carrier | carrier-translate | 8 | 344.331 | 93290 | 8930 | 0 | 0 |
| judge | compact12-coverage-spanishdict-precise | blind-confirm-strict | 1 | 15.013 | 11274 | 177 | 0 | 0 |
| judge | compact12-coverage-spanishdict-precise | blind-judge-strict | 12 | 447.423 | 167615 | 11999 | 0 | 0 |
| judge | compact12-diverse-precise-nodict | blind-confirm-strict | 2 | 45.879 | 22964 | 592 | 0 | 0 |
| judge | compact12-diverse-precise-nodict | blind-judge-strict | 8 | 306.885 | 112586 | 8063 | 0 | 0 |
| judge | compact12-precise-nodict | blind-judge-strict | 8 | 292.751 | 112601 | 7907 | 0 | 0 |
| judge | compact12-scope-precise-nodict | blind-judge-strict | 4 | 145.205 | 56713 | 3911 | 0 | 0 |
| judge | compact12-scope-spanishdict-precise | blind-confirm-strict | 1 | 13.683 | 11524 | 160 | 0 | 0 |
| judge | compact12-scope-spanishdict-precise | blind-judge-strict | 12 | 468.679 | 170150 | 12088 | 0 | 0 |
| judge | compact12-spanishdict-precise | blind-judge-strict | 4 | 144.286 | 55866 | 3902 | 0 | 0 |
| judge | compact12-webdict-precise-nodict | blind-confirm-strict | 1 | 17.386 | 11274 | 240 | 0 | 0 |
| judge | compact12-webdict-precise-nodict | blind-judge-strict | 4 | 149.397 | 55863 | 4021 | 0 | 0 |
| judge | compact30-diverse-spanishdict-precise | blind-judge-strict | 4 | 146.24 | 55868 | 3903 | 0 | 0 |
| research | baseline-human | candidates | 2 | 562.121 | 33441 | 14998 | 0 | 0 |
| research | baseline-human | checks | 4 | 349.409 | 49593 | 13253 | 0 | 0 |
| research | baseline-human | consistency | 12 | 557.023 | 175485 | 15172 | 0 | 0 |
| research | baseline-human | counting | 64 | 2388.828 | 885274 | 60343 | 0 | 0 |
| research | baseline-human | discovery | 8 | 272.809 | 103086 | 5736 | 0 | 0 |
| research | baseline-human | family | 3 | 77.69 | 34538 | 1657 | 0 | 0 |
| research | baseline-human | forms | 4 | 54.564 | 45655 | 385 | 0 | 0 |
| research | baseline-human | frequency | 33 | 1041.853 | 484744 | 29803 | 0 | 0 |
| research | baseline-human | parts | 2 | 53.755 | 26416 | 976 | 0 | 0 |
| research | baseline-human | proposal | 2 | 372.742 | 45638 | 11222 | 0 | 0 |
| research | baseline-human | sources | 5 | 446.749 | 89628 | 11402 | 0 | 0 |
| research | baseline-human | summary | 2 | 48.195 | 27818 | 977 | 0 | 0 |
| research | compact12-coverage-spanishdict-precise | compact-proposal | 1 | 58.983 | 13123 | 1589 | 0 | 0 |
| research | compact12-coverage-spanishdict-precise | coverage-scout | 1 | 48.763 | 27992 | 1137 | 0 | 0 |
| research | compact12-diverse-precise-nodict | compact-proposal | 2 | 118.906 | 28963 | 3320 | 0 | 0 |
| research | compact12-precise-nodict | compact-proposal | 2 | 75.037 | 24149 | 1665 | 0 | 0 |
| research | compact12-scope-precise-nodict | compact-proposal | 1 | 60.185 | 15355 | 1400 | 0 | 0 |
| research | compact12-scope-spanishdict-precise | compact-proposal | 1 | 39.994 | 16608 | 2517 | 0 | 0 |
| research | compact12-spanishdict-precise | compact-proposal | 1 | 38.085 | 14051 | 778 | 0 | 0 |
| research | compact12-webdict-precise-nodict | compact-proposal | 1 | 63.457 | 113598 | 1153 | 0 | 0 |
| research | compact30-diverse-spanishdict-precise | compact-proposal | 1 | 53.763 | 17500 | 1165 | 0 | 0 |
| seed-preparation | baseline-human | seed-audit | 1 | 12.183 | 11079 | 63 | 0 | 0 |
| seed-preparation | baseline-human | seed-preparation | 2 | 31.585 | 22049 | 240 | 0 | 0 |

## Confirmed differences

### Íntimo

- 999d14b7068ee75b: “Trabajamos en íntima relación” nói về sự phối hợp mật thiết giữa các Huynh đệ; A chuyển thành liên hệ “nội tâm”, làm thay đổi loại quan hệ được mô tả.
- 674d626e5da719bd: “Vida íntima con el sexo opuesto” chỉ đời sống thân mật với người khác giới; B dịch thành “đời sống bên trong”, sai nghĩa và khiến cụm này khó hiểu.

## Focused repair experiments

The four acceptance criteria are assessed separately from translation votes. An entry may tie on forty passages while missing an origin, rare sense or common contextual translation. User-provided expected answers were not sent to research or scout agents. Repairs use source evidence only and are development on these selected cases, not a new independent confirmation sample.

| Term | Intervention | Reference | Confirmed complete | Passages | Correctness W / L / T | Naturalness W / L / T |
|---|---|---|---|---:|---|---|
| Íntimo | compact12-diverse-precise-nodict | previous-app | True | 40 | 1 / 0 / 39 | 1 / 0 / 39 |
| Íntimo | compact12-provenance-precise-nodict | no-glossary | True | 40 | 0 / 0 / 40 | 0 / 0 / 40 |
| Íntimo | compact12-provenance-precise-nodict | previous-app | True | 40 | 2 / 0 / 38 | 1 / 0 / 39 |
| vanidad | compact12-diverse-precise-nodict | previous-app | True | 40 | 0 / 3 / 37 | 0 / 1 / 39 |
| vanidad | compact12-spanishdict-precise | previous-app | True | 40 | 0 / 3 / 37 | 0 / 0 / 40 |
| vanidad | compact12-coverage-spanishdict-precise | no-glossary | True | 40 | 1 / 0 / 39 | 0 / 0 / 40 |
| vanidad | compact12-coverage-spanishdict-precise | previous-app | True | 40 | 0 / 0 / 40 | 0 / 0 / 40 |
| mundos | compact12-diverse-precise-nodict | compact12-precise-nodict | True | 40 | 0 / 1 / 39 | 0 / 0 / 40 |
| mundos | compact12-scope-precise-nodict | compact12-diverse-precise-nodict | True | 40 | 0 / 0 / 40 | 0 / 0 / 40 |
| mundos | compact12-scope-spanishdict-precise | baseline-human | True | 40 | 0 / 0 / 40 | 0 / 0 / 40 |
| mundos | compact12-scope-spanishdict-precise | compact12-scope-precise-nodict | True | 40 | 1 / 0 / 39 | 0 / 0 / 40 |
| mundos | compact12-scope-spanishdict-precise | no-glossary | True | 40 | 0 / 0 / 40 | 0 / 0 / 40 |
| fatal | compact12-diverse-precise-nodict | compact12-precise-nodict | True | 40 | 0 / 0 / 40 | 0 / 0 / 40 |
| fatal | compact12-webdict-precise-nodict | compact12-diverse-precise-nodict | True | 40 | 0 / 0 / 40 | 0 / 0 / 40 |
| fatal | compact12-spanishdict-precise | compact12-diverse-precise-nodict | True | 40 | 0 / 0 / 40 | 0 / 0 / 40 |
| fatal | compact30-diverse-spanishdict-precise | compact12-spanishdict-precise | True | 40 | 0 / 0 / 40 | 0 / 0 / 40 |
| fatal | compact12-coverage-spanishdict-precise | baseline-human | True | 40 | 0 / 0 / 40 | 0 / 0 / 40 |
| fatal | compact12-coverage-spanishdict-precise | compact12-spanishdict-precise | True | 40 | 0 / 0 / 40 | 0 / 0 / 40 |
| fatal | compact12-coverage-spanishdict-precise | no-glossary | True | 40 | 0 / 0 / 40 | 0 / 0 / 40 |

| Term | Repair | Research calls | Model seconds | Input | Output |
|---|---|---:|---:|---:|---:|
| Íntimo | compact12-diverse-precise-nodict | 1 | 48.6 | 13,297 | 1,191 |
| Íntimo | compact12-provenance-precise-nodict | 1 | 29.9 | 15,805 | 1,112 |
| vanidad | compact12-diverse-precise-nodict | 1 | 32.6 | 12,916 | 652 |
| vanidad | compact12-spanishdict-precise | 1 | 38.4 | 13,379 | 675 |
| vanidad | compact12-coverage-spanishdict-precise | 2 | 89.6 | 32,287 | 2,257 |
| mundos | compact12-diverse-precise-nodict | 1 | 74.0 | 15,297 | 2,344 |
| mundos | compact12-scope-precise-nodict | 1 | 60.2 | 15,355 | 1,400 |
| mundos | compact12-scope-spanishdict-precise | 1 | 40.0 | 16,608 | 2,517 |
| fatal | compact12-diverse-precise-nodict | 1 | 44.9 | 13,666 | 976 |
| fatal | compact12-webdict-precise-nodict | 1 | 63.5 | 113,598 | 1,153 |
| fatal | compact12-spanishdict-precise | 1 | 38.1 | 14,051 | 778 |
| fatal | compact30-diverse-spanishdict-precise | 1 | 53.8 | 17,500 | 1,165 |
| fatal | compact12-coverage-spanishdict-precise | 2 | 107.7 | 41,115 | 2,726 |

Diversity retains the 12-passage cap and unchanged research instructions. The scope guard adds only a general warning against narrowing categories. The bounded provenance branch adds printed/aligned source-book pairs and up to six original passages; it distinguishes a verified pair from proof of borrowing. The small dictionary branch fetches only the published Spanish section, removing translation tables and other languages. The 30-context branch changes only the passage cap and preserves the first twelve. The coverage branch uses one bounded Spanish-only sense scout over nonreserved headword windows, then at most twelve full contexts in the unchanged proposal prompt. Failed/rejected trials are retained in measured experiment costs.

The DLE web-enabled fatal trial failed to obtain definitions and used 113,598 input tokens (88,320 cached); it is rejected as an acquisition path. Direct Spanish dictionary fetches used about one second and no model acquisition call. The short coverage scout is an additional model call and must be charged, even when it replaces much larger counting/discovery work.

Vanidad counterexamples: fresh judges confirmed that applying personal vanity to empty speech or futility changes the source idea. The phrase “comprender la futilidad de aquello, la vanidad de aquello” is one source example. Thus the usual appearance/reputation sense should not become a categorical ban on rare futility translations. Mundos likewise needs a broad option alongside hành tinh: one source list includes the Sun among thirteen mundos.
## Evidence limitations

| Term | Full reserved passages detected in reference research | Detected in compact research |
|---|---:|---:|
| vanidad | 35 | 0 |
| mundos | 0 | 0 |
| Íntimo | 2 | 0 |
| fatal | 1 | 0 |

Saved app research did not reserve this evaluation sample. Literal containment checks can miss shorter or reformatted overlap. Controlled translation uses a shared neutral draft and may retain shared errors; ties alone do not establish that both versions are correct. Initial absolute grades supplement relative comparisons. Independent judging means fresh contexts, not a different model family or human panel. Íntimo’s saved reference used a different model. User-selected terms and exploratory repairs cannot establish universal equivalence.

Earlier results: the random sample had 31 correctness wins, zero losses and 719 ties over 750 comparisons against fresh human-seeded references. The recent eight-term comparison initially had two wins, two losses and 215 ties; a source-form recall repair for Regenerar removed the confirmed losses in the exploratory follow-up. These are different term sets and references, not directly comparable win rates.

Inspect [the four-term entry wording](/Users/hans/Desktop/AI-Projects/GnosisTMS/scripts/glossary-research-lab/runs/2026-10-12-focused/ENTRIES.md) and [the recent-term report](/Users/hans/Desktop/AI-Projects/GnosisTMS/scripts/glossary-research-lab/RECENT_RESULTS.md). Raw source samples, prompts, usage, translations and confirmed judgments are saved with each run. No glossary entries or production app files were changed.
