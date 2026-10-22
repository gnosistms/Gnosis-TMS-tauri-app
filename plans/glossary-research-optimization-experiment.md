# Codex glossary research optimization experiment

Started 2026-10-12. Scope: a separate CLI experiment; no production glossary writes.

## Protocol

1. Snapshot the current research engine/prompts from the working research checkout. Build subscription-authenticated Codex CLI, corpus, dictionary and frequency adapters, recording each request's wall time and reported input/cached/output tokens, failures and retries. Never fall back to API billing.
2. Uniformly sample 30 active ES–VI glossary entries using a recorded random seed. Read only source terms for selection; keep existing targets/notes out of every research, translation and judge input.
3. Freeze corpus and evidence. Reserve 40 distinct evaluation passages per term before research sampling. For sparse terms use every available distinct passage, disclose overlap where a disjoint sample is impossible, and never pad with duplicates.
4. Run the current procedure as baseline. Record local processing, research calls and counting separately from evaluation translation/judging. Human review time is excluded; the experiment automatically freezes proposals without changing the production review pause.
5. Test one optimization at a time, starting with large stage removals and cheap applicability gates. Keep model and evaluation settings fixed. Preserve checkpoints and reproducible prompts.
6. Translate the same evaluation sources independently with each glossary. A fresh blind judge sees only source and randomized A/B translations, scores accuracy and naturalness and can tie. Audit completeness and report wins/losses/ties by term; use term-level uncertainty rather than treating all passages as independent.
7. Repair quality regressions with targeted checks and rerun. Separate exploratory results from confirmations; report limitations, sparse/zero-hit terms, all failed runs and measured rather than estimated savings.

## Deliverables

- Reusable CLI harness and focused protocol tests.
- Source-only sample manifest, evidence/checkpoints, request ledger and blind judgments.
- Results and recommended conditional procedure with concrete time/token savings and quality evidence.

## Progress

- Located current implementation in sibling `GnosisTMS-research` (prompt version 2026-10-12.4), current ES–VI glossary (866 term files), local public-search corpus and general-language data.
- Codex CLI 0.160.1 reports ChatGPT authentication; official documentation confirms subscription authentication and JSON usage reporting.

- Frozen sample: seed 2070955783, 30 of 866 active source entries. Independent corpus inflections yield 750 term-passage comparisons, deduplicated within each term: 14 terms with 40, 15 sparse, one zero-hit. Sparse overlap is recorded.
- Built immutable canonical-engine snapshot and Codex ChatGPT adapters. Per-request prompts, schemas, outputs, events, usage, failures, and local timings are retained. Focused protocol tests pass.
- Pilot hypotheses: direct 30-context proposal; reduce to 12 contexts; truncate the canonical pipeline before counting. Uncurated truncation was stopped after 3 terms (3 wins, 6 losses, 50 ties).
- Original independently translated outputs had substantial unrelated wording variation. Added a separately analyzed controlled protocol with shared neutral translation drafts. Blind judges still see only complete source and randomized complete translations.
- Repair hypotheses: one curation call after the canonical proposal, and a short precision constraint within the direct 12-context prompt. Both preserve names/category distinctions and forbid unverified expansions of initials.
- Found invalid baseline counting for V.M.: 41 unassigned occurrences but reported complete agreement. Record this audit; no production fix is in scope.
- Stopped overlapping controllers and added process/term/request locks. Preserve failures/unknown usage. Exclude affected terms from paired cost savings while retaining all their quality evidence.
- Next isolated hypothesis, fixed before confirmation judgments: remove dictionary acquisition from the guarded 12-context method. All other prompt/evidence settings stay the same. For absent dictionary text the research input is exactly identical and the existing guarded output can be reused; this does not imply zero proposal cost. Test nonempty dictionary cases separately.
- Development loss: direct entries for extasis offered Samadhi as a target where the source uses extasis to explain Samadhi; 11 accuracy losses on 40 passages. Next one-call patch (compact12-precise) preserves distinct lexical labels and scopes adjectives to their source forms. It also permits a readable contextual honorific without asserting an unverified expansion of initials. Dictionary removal remains a separately registered hypothesis, not yet executed.

## User reference revision

The reference is now the canonical procedure seeded with human glossary candidates. Existing targets and explicit positive/negative translation guidance are read only by isolated baseline seed preparation. The baseline receives the resulting target list at candidate proposal, before candidate checks, discovery, counting, and consistency. The inspected canonical API has an initial source-spelling field rather than an initial target-candidate field, so this is an adapter injection, not a production-code change. Candidates remain fallible suggestions and may be rejected.

The optimized methods remain de novo: they never receive human targets, notes, exclusions, or seeded baseline outputs. Preserve the unseeded canonical reference to measure the human candidate advantage independently. Freeze prompt hashes before human extraction. Fresh blind judges receive only sources and randomized translations; human provenance is not disclosed. Reuse only target-independent prefix stages (dictionary, source forms, family, sample, origins, parts/source frequency); repeat candidate proposal and all downstream stages. Include prefix acquisition in effective reference cost.
- Efficient repair hypothesis: compact12-audited reuses the exact precise proposal and adds one skeptical lexical audit only when it has competing variants or overlapping source forms across meanings. It uses the same 12 raw contexts, no human data. A rare term with one unambiguous candidate bypasses the audit; frequency alone never forces full research. Test versus the revised human-seeded reference, with inherited proposal/dictionary costs included.

## Clear-correctness revision

A win/loss now requires a clear, material source-based correctness difference. Acceptable synonyms, small nuances, stylistic preferences, and uncertain interpretations tie. Naturalness is reported separately and requires a clear fluency problem to prefer a side. Fresh judges independently grade both versions; report both acceptable, both needing correction, and uncertain cases. Overall winner equals accuracy. Preserve legacy judgments, rejudge saved translations into separate strict paths, and enforce the threshold when judge grades contradict its preference.

Next single-change ablation: compact12-precise-nodict removes dictionary acquisition from the precise proposal, with all remaining prompts/context settings identical. Test development first, then confirmation; include proposal cost even when absent dictionary evidence permits exact reuse. This isolates dictionary value from the earlier precision repairs.

- Evaluation audit found overlapping search windows: some reserved complete passages occur inside larger research windows, despite exact hash exclusions. Preserve the frozen results, audit literal full-text containment for each method, and separately analyze terms with no detected exposure. This is a limitation of this corpus sampling protocol, not evidence of human glossary leakage.

- Confirm non-tie accuracy/naturalness findings with a second fresh blind judge who sees only newly randomized source/A/B packets. Preserve first judgments, save verified judgments separately, and turn disputed preferences into ties. This checks reliability of claimed clear differences; ties are not exhaustively rejudged and equivalence remains an exploratory conclusion.

- Rejudge the uncurated and curated truncation pilots against their unseeded canonical parent too. The revised seeded-reference comparison is the target quality bar, but changes both human candidate information and counting; do not attribute its losses solely to removed counting.

## Completion

- Completed the human-seeded reference, unseeded reference, precise compact proposal, dictionary-removal ablation, and conditional-audit method for all 30 sampled entries; 29 supplied passages and one remains explicitly untested for quality.
- Best tested default: one guarded proposal over up to 12 raw passages, no routine dictionary. Across 750 comparisons: 31 confirmed correctness wins, 0 losses, 719 ties against the human-seeded reference. Isolated dictionary removal: 750 ties. All claimed clear differences received a second blind check.
- Across 23 clean paired cost terms: 97.6% known input, 98.5% known output, and 97.9% summed model-call work saved. Six interrupted/overlapping early terms are excluded from paired costs, retained for quality.
- Results, reproducible analysis, stage timings, full prompts/outputs/usage, exposure audit, and CLI instructions are saved. Focused protocol checks pass; production app code and glossary files are unchanged. Earlier pilot scores above are chronological exploratory findings; RESULTS.md contains the final strict confirmed comparisons.
