# Automatic glossary research validation

**In progress. Partial counts are not final evidence.**

Frozen policy adaptive-v1; model gpt-6.1-sol; random seed 1472106107; thirty uniformly sampled entries from 826 eligible entries after excluding all earlier tests. Rules and code hashes were frozen before drawing the sample. Hash verification: True. Human glossary fields are confined to isolated reference candidate preparation; adaptive outputs were frozen before that extraction.

## Required yardstick: improvement over no glossary

A glossary succeeds only by improving the actual translations made with no glossary. Ties earn no credit. The same frozen neutral draft is the control for both methods; it was produced before either entry was supplied. There is no extra baseline translation call or empty-glossary editing pass. Independent blind judges compare each glossary-assisted translation with that exact draft, and a second fresh judge must confirm every claimed clear gain or harm. Research policy and outputs stay frozen after this user-requested evaluation amendment.

The primary measure is confirmed correctness gains minus confirmed correctness harms, alongside the separate harm count and naturalness effects. A net-zero result demonstrates no net benefit on this sample. Raw tie counts, agreement with another glossary and entry completeness cannot establish success. Positive sample net benefit is an observation, not proof of universal benefit; term-clustered intervals show uncertainty.

| Method | Verified passages | Correctness gains | Correctness harms | Net gain | Net gain / 100 passages | Ties (no credit) | Naturalness gains / harms / net |
|---|---:|---:|---:|---:|---:|---:|---|
| adaptive-v1 | 80 / 833 | 0 | 0 | +0 | 0.00 | 80 | 0 / 0 / +0 |

adaptive-v1: equal-term mean net correctness gain per 100 = 0.00; term-clustered bootstrap 95% interval [0.0, 0.0].

| baseline-human | 0 / 833 | 0 | 0 | +0 | pending | 0 | 0 / 0 / +0 |

Paired method effect difference (adaptive minus human-seeded full research): +0 across 0 jointly verified passages. Each passage contributes +1 for a gain over its neutral draft, −1 for a harm, or 0 for a tie; method effects are then compared on the same passage. Never subtract totals from different passage sets. Baseline grade disagreements across independent comparisons: 0. These grades are evaluator judgments, not ground truth.

| Adaptive effect / full-reference effect | Passages |
|---|---:|

| Term | Verified adaptive / full | Adaptive correctness gains / harms / net | Full correctness gains / harms / net | Paired net difference |
|---|---|---|---|---:|
| Caridad | 40 / 0 of 40 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| Unidad Cósmica | 0 / 0 of 20 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| análisis transaccional | 0 / 0 of 13 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| common presence | 0 / 0 of 0 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| sujeto mediumnímico | 0 / 0 of 2 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| energética | 40 / 0 of 40 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| Santidad | 0 / 0 of 40 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| órgano fatal | 0 / 0 of 6 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| POLIVIDENCIA | 0 / 0 of 38 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| caos | 0 / 0 of 40 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| Mundo Astral | 0 / 0 of 40 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| ÉTER QUÍMICO | 0 / 0 of 12 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| EL SEPTENARIO TEOSÓFICO | 0 / 0 of 10 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| cristónico | 0 / 0 of 40 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| EGO LUNAR | 0 / 0 of 37 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| La Doctrina Secreta | 0 / 0 of 40 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| encarnar | 0 / 0 of 40 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| sí mismo | 0 / 0 of 40 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| SAGRADO ABSOLUTO | 0 / 0 of 40 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| Buddha Intimo | 0 / 0 of 9 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| escolasticismo | 0 / 0 of 1 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| alguno de ustedes | 0 / 0 of 40 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| podemos encontrar | 0 / 0 of 30 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| aludido | 0 / 0 of 18 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| contemplar | 0 / 0 of 40 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| rendirse | 0 / 0 of 22 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| apocalíptico | 0 / 0 of 30 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| transmutar | 0 / 0 of 40 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| en trance | 0 / 0 of 36 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |
| GENIOS PLANETARIOS | 0 / 0 of 29 | 0 / 0 / +0 | 0 / 0 / +0 | +0 |

No-hit terms have no quality evidence and are excluded from benefit estimates. Partial/unverified zeros in this table mean pending evidence, never a finding of no benefit. Both-acceptable ties and shared unresolved errors are distinguished in analysis-adaptive.json; grade-state counts reflect initial independent grades, whereas gain/harm directions require confirmation.

## Secondary comparison between glossary methods

Adaptive vs human-seeded full research correctness wins / losses / ties: **0 / 0 / 0**. Naturalness: **0 / 0 / 0**. Judged 0 / 833 term-passage pairs, with 828 globally unique texts. Non-ties require material differences and fresh blind confirmation; disagreements become ties. This comparison explains relative behavior; it cannot demonstrate that either method improves over no glossary.

## Automatic routing

Every positive-hit term gets a bounded independent source-book lookup and one proposal from at most twelve source passages. Explicit proposal uncertainty or sufficiently unrepresented lexical contexts trigger one coverage scout and final proposal; a dictionary-only branch handles unresolved lexical distinctions when no extra contexts exist. Direct Spanish dictionary acquisition removes translations/other languages, is capped, and records failure. The scout reads at most 384 bounded source windows, prioritizing novel contexts then a reproducible sample. No term-specific exceptions or expected Vietnamese answers are supplied. A novelty signal is lexical, not proof of an additional meaning.

Observed branches: {"coverage": 17, "compact": 12, "no-texts": 1}. Escalation-vs-initial correctness: 0 / 0 / 160; naturalness: 0 / 0 / 160. Completeness benefits are assessed separately. A routed case with no demonstrated benefit is not proof that escalation was unnecessary.

| Term | Corpus passages | Research pool | Evaluation | Route | Correctness W / L / T | Naturalness W / L / T | Sparse overlap |
|---|---:|---:|---:|---|---|---|---:|
| Caridad | 167 | 111 | 0 / 40 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| Unidad Cósmica | 20 | 20 | 0 / 20 | compact | 0 / 0 / 0 | 0 / 0 / 0 | 20 |
| análisis transaccional | 13 | 13 | 0 / 13 | compact | 0 / 0 / 0 | 0 / 0 / 0 | 13 |
| common presence | 0 | 0 | 0 / 0 | no-texts | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| sujeto mediumnímico | 2 | 2 | 0 / 2 | compact | 0 / 0 / 0 | 0 / 0 / 0 | 2 |
| energética | 111 | 64 | 0 / 40 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| Santidad | 165 | 114 | 0 / 40 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| órgano fatal | 6 | 6 | 0 / 6 | compact | 0 / 0 / 0 | 0 / 0 / 0 | 6 |
| POLIVIDENCIA | 38 | 38 | 0 / 38 | compact | 0 / 0 / 0 | 0 / 0 / 0 | 38 |
| caos | 558 | 499 | 0 / 40 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| Mundo Astral | 205 | 162 | 0 / 40 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| ÉTER QUÍMICO | 12 | 12 | 0 / 12 | compact | 0 / 0 / 0 | 0 / 0 / 0 | 12 |
| EL SEPTENARIO TEOSÓFICO | 10 | 10 | 0 / 10 | compact | 0 / 0 / 0 | 0 / 0 / 0 | 10 |
| cristónico | 79 | 38 | 0 / 40 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| EGO LUNAR | 37 | 37 | 0 / 37 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 37 |
| La Doctrina Secreta | 124 | 79 | 0 / 40 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| encarnar | 353 | 298 | 0 / 40 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| sí mismo | 3889 | 3838 | 0 / 40 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| SAGRADO ABSOLUTO | 54 | 10 | 0 / 40 | compact | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| Buddha Intimo | 9 | 9 | 0 / 9 | compact | 0 / 0 / 0 | 0 / 0 / 0 | 9 |
| escolasticismo | 1 | 1 | 0 / 1 | compact | 0 / 0 / 0 | 0 / 0 / 0 | 1 |
| alguno de ustedes | 54 | 13 | 0 / 40 | compact | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| podemos encontrar | 30 | 30 | 0 / 30 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 30 |
| aludido | 18 | 18 | 0 / 18 | compact | 0 / 0 / 0 | 0 / 0 / 0 | 18 |
| contemplar | 232 | 190 | 0 / 40 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| rendirse | 22 | 22 | 0 / 22 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 22 |
| apocalíptico | 30 | 30 | 0 / 30 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 30 |
| transmutar | 392 | 339 | 0 / 40 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| en trance | 36 | 36 | 0 / 36 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 36 |
| GENIOS PLANETARIOS | 29 | 29 | 0 / 29 | coverage | 0 / 0 / 0 | 0 / 0 / 0 | 29 |

## Independent entry completeness

A fresh source-only agent derives meanings, grammatical distinctions and evidenced specialized provenance from up to one hundred source windows and independent source-book evidence, without seeing either entry. Another fresh agent sees randomized entries plus those requirements. Every claimed material gap receives a fresh second check with sides reversed. Coverage means an adequate usable translation/context rule; equivalent good wordings qualify equally. This inventory is sampled rather than exhaustive and never enters research/routing.

| Term | Requirements | Adaptive gaps | Reference gaps | Shared gaps | Uncertain | Escalation completeness gains |
|---|---:|---:|---:|---:|---:|---:|

Possible missed escalations (compact branch with confirmed adaptive-only gap): none detected yet. Demonstrated escalation benefits: none detected yet.

## Measured research cost

All adaptive calls include initial proposals, scouts and fallback proposals. Failed attempts and unknown usage stay in the ledger. Source-only/local retrieval, human seed preparation, translation, judging and completeness assessment are separate roles/costs. Input includes cached tokens. Summed call seconds measure model work, not elapsed user latency. The two methods share the frozen runtime/model; the original procedure includes automatic human-review freeze, not human review time.

| Term | Reference calls | Adaptive calls | Reference model seconds | Adaptive model seconds | Reference input | Adaptive input | Reference output | Adaptive output |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Caridad | 24 | 3 | 1152.6 | 172.7 | 323247 | 48114 | 30822 | 4106 |
| Unidad Cósmica | 31 | 1 | 1445.4 | 38.3 | 443616 | 12467 | 37669 | 766 |
| análisis transaccional | 23 | 1 | 958.0 | 31.3 | 351602 | 12156 | 26217 | 532 |
| common presence | 0 | 0 | 0.0 | 0.0 | 0 | 0 | 0 | 0 |
| sujeto mediumnímico | 20 | 1 | 635.8 | 40.9 | 273007 | 11358 | 13611 | 696 |
| energética | 45 | 3 | 1864.0 | 109.2 | 616690 | 39959 | 43686 | 2093 |
| Santidad | 57 | 3 | 2193.1 | 134.2 | 849960 | 47884 | 50013 | 2935 |
| órgano fatal | 20 | 1 | 727.0 | 32.6 | 276652 | 11608 | 16826 | 571 |
| POLIVIDENCIA | 13 | 1 | 635.9 | 34.5 | 216081 | 13441 | 16206 | 732 |
| caos | 6 | 3 | 320.7 | 190.5 | 88106 | 67882 | 7154 | 4592 |
| Mundo Astral | 4 | 3 | 70.2 | 128.1 | 95384 | 50951 | 518 | 2627 |
| ÉTER QUÍMICO | 3 | 1 | 67.8 | 30.4 | 81690 | 12883 | 701 | 530 |
| EL SEPTENARIO TEOSÓFICO | 0 | 1 | 0.0 | 39.2 | 0 | 13198 | 0 | 719 |
| cristónico | 0 | 3 | 0.0 | 132.4 | 0 | 37668 | 0 | 2862 |
| EGO LUNAR | 0 | 3 | 0.0 | 101.9 | 0 | 37417 | 0 | 1937 |
| La Doctrina Secreta | 0 | 3 | 0.0 | 138.5 | 0 | 47736 | 0 | 3393 |
| encarnar | 0 | 3 | 0.0 | 166.7 | 0 | 61979 | 0 | 3650 |
| sí mismo | 0 | 3 | 0.0 | 191.1 | 0 | 66713 | 0 | 4731 |
| SAGRADO ABSOLUTO | 0 | 1 | 0.0 | 45.4 | 0 | 12264 | 0 | 1051 |
| Buddha Intimo | 0 | 1 | 0.0 | 31.5 | 0 | 12028 | 0 | 614 |
| escolasticismo | 0 | 1 | 0.0 | 35.6 | 0 | 11312 | 0 | 626 |
| alguno de ustedes | 0 | 1 | 0.0 | 33.3 | 0 | 12565 | 0 | 603 |
| podemos encontrar | 0 | 3 | 0.0 | 133.4 | 0 | 37916 | 0 | 2843 |
| aludido | 0 | 1 | 0.0 | 43.0 | 0 | 12544 | 0 | 907 |
| contemplar | 0 | 3 | 0.0 | 167.8 | 0 | 48543 | 0 | 3845 |
| rendirse | 0 | 3 | 0.0 | 124.2 | 0 | 37341 | 0 | 2591 |
| apocalíptico | 0 | 3 | 0.0 | 126.3 | 0 | 37048 | 0 | 2915 |
| transmutar | 0 | 3 | 0.0 | 177.2 | 0 | 63820 | 0 | 3754 |
| en trance | 0 | 3 | 0.0 | 149.3 | 0 | 38240 | 0 | 3100 |
| GENIOS PLANETARIOS | 0 | 3 | 0.0 | 123.1 | 0 | 40041 | 0 | 2476 |

Paired research: reference 196 calls, 7823.2 model seconds, 2,811,527 input / 188,022 output; adaptive 10 calls, 386.5 seconds, 135,432 input / 7,593 output.

| Role | Calls | Model seconds | Input | Cached input | Output | Failures | Unknown usage |
|---|---:|---:|---:|---:|---:|---:|---:|
| evaluation | 51 | 2185.42 | 655558 | 72704 | 63046 | 0 | 0 |
| judge | 29 | 1086.677 | 415969 | 64512 | 27712 | 0 | 0 |
| research | 309 | 12973.021 | 4573111 | 720512 | 306220 | 0 | 0 |
| seed-preparation | 37 | 507.46 | 396318 | 30592 | 3082 | 1 | 1 |

| Controller phase | Elapsed seconds | Exit code |
|---|---:|---:|
| seed | 81.678 | 0 |
| seed-audit | 82.337 | 0 |
| no-glossary adaptive-v1 evaluate | 0.952 | 0 |
| no-glossary baseline-human evaluate | 0.57 | 0 |
| no-glossary adaptive-v1 verify | 0.713 | 0 |
| no-glossary baseline-human verify | 0.578 | 0 |
| no-glossary adaptive-v1 verify | 0.775 | 0 |
| no-glossary baseline-human verify | 0.512 | 0 |
| no-glossary adaptive-v1 verify | 0.418 | 0 |
| no-glossary baseline-human verify | 0.421 | 0 |
| no-glossary adaptive-v1 verify | 0.41 | 0 |
| no-glossary baseline-human verify | 0.792 | 0 |
| no-glossary adaptive-v1 verify | 0.456 | 0 |
| no-glossary baseline-human verify | 0.44 | 0 |
| no-glossary adaptive-v1 verify | 0.488 | 0 |
| no-glossary baseline-human verify | 0.399 | 0 |
| no-glossary adaptive-v1 verify | 0.399 | 0 |
| no-glossary baseline-human verify | 0.392 | 0 |
| no-glossary adaptive-v1 verify | 0.407 | 0 |
| no-glossary baseline-human verify | 0.529 | 0 |
| no-glossary adaptive-v1 verify | 0.512 | 0 |
| no-glossary baseline-human verify | 0.557 | 0 |
| no-glossary adaptive-v1 verify | 0.572 | 0 |
| no-glossary baseline-human verify | 0.392 | 0 |
| no-glossary adaptive-v1 verify | 0.393 | 0 |
| no-glossary baseline-human verify | 0.409 | 0 |
| no-glossary adaptive-v1 verify | 0.417 | 0 |
| no-glossary baseline-human verify | 0.767 | 0 |
| no-glossary adaptive-v1 verify | 0.503 | 0 |
| no-glossary baseline-human verify | 0.46 | 0 |
| no-glossary adaptive-v1 verify | 0.42 | 0 |
| no-glossary baseline-human verify | 0.525 | 0 |
| no-glossary adaptive-v1 verify | 0.597 | 0 |
| no-glossary baseline-human verify | 0.451 | 0 |
| no-glossary adaptive-v1 verify | 0.637 | 0 |
| no-glossary baseline-human verify | 0.485 | 0 |
| no-glossary adaptive-v1 verify | 0.42 | 0 |
| no-glossary baseline-human verify | 0.422 | 0 |
| no-glossary adaptive-v1 evaluate | 199.478 | 0 |
| no-glossary adaptive-v1 verify | 1.075 | 0 |
| no-glossary adaptive-v1 evaluate | 315.053 | 0 |
| early neutral/adaptive translations (same frozen functions/checkpoints) | running | pending |

## Confirmed defects and differences

### Mechanical source-form validation

A separate local audit checked 126 emitted source forms. It found 5 zero-hit spellings. Source-only token inflections can generate invalid whole-phrase combinations; labeling those combinations as confirmed is too permissive. The frozen v1 outputs retain these defects for honest evaluation. A generic corpus membership filter is a cheap necessary guard for a follow-up version; it must not use human glossary aliases.

- Mundo Astral: Mundo astrales — no corpus passages.
- Mundo Astral: mundo astrales — no corpus passages.
- Mundo Astral: mundos astrales — no corpus passages.
- Buddha Intimo: Buddha íntima — no corpus passages.
- Buddha Intimo: buddha íntima — no corpus passages.

## Limits and reproducibility

Sparse terms necessarily reuse evidence and are reported separately from disjoint terms. Source-location/adjacent-paragraph and normalized containment filtering suppresses common context leakage; the saved exposure audit is still required and cannot rule out every shorter/reformatted excerpt. Zero-hit entries are retained, not replaced or translated from the old glossary. Capped source scouts can miss rare meanings. Fresh-context same-model judges are independent of research, not a different model family or human panel. Controlled drafts can retain shared unrelated translation errors. Ties alone do not establish entry completeness or universal equivalence. The confirmation policy stays unchanged after seeing new quality findings; later repairs must retain these original results.

Run artifacts: /Users/hans/Desktop/AI-Projects/GnosisTMS/scripts/glossary-research-lab/runs/2026-10-13-adaptive. See analysis-adaptive.json, stage-measurements.csv, phase-timings.json, policy-freeze.json, optimized-freeze.json and per-term prompts, routes, sources, entries, translations and verified judgments. All work uses subscription authentication; production glossary/app files are untouched.
