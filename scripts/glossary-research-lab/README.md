# Codex glossary research lab

## Active full-procedure preservation experiment

Hans's latest direction supersedes the untested one-call experiment: start with the full pipeline, fix findings lost between stages and the actual consumer, and then test efficiency changes. See `plans/glossary-research-full-preservation.md`. The full-run snapshots are separate from all earlier frozen studies.

`full_research.py prepare --language vi` and `--language en` freeze the full engine, source samples, human/inferred criteria and mirrored real-source fault controls. After explicit execution approval, run `calibrate` first. A failed domain control blocks quality scoring. Use `research` to run the unchanged full sequence, `compile` for the no-new-call preservation projection, and `neutral`, `translate`, `evaluate`, `confirm` for exact no-glossary comparisons. Methods are `full-original` and `full-preserved`; EN has a separate snapshot/run directory. `--indices` selects manifest indexes and `--workers` caps simultaneous calls. Criteria/expected control outcomes never enter research.

`node --test scripts/glossary-research-lab/full_carrythrough.test.mjs scripts/glossary-research-lab/full_research_contracts.test.mjs` includes the real saved fatal branch-loss reproduction and controls for loss of scope and reader notes. `node scripts/glossary-research-lab/full_research_audit.mjs` audits saved full-run records locally without inference. These structural checks cannot establish translation quality or domain-evaluator sensitivity. Every step-retirement gate stays blocked until its named cases, injected faults, acceptable controls, consuming output and no-glossary assessment are complete.

A standalone, checkpointed CLI for testing the Gnosis research procedure with ChatGPT subscription authentication. API credentials are removed from child environments, API fallback is forbidden, and production glossary files are never changed. Each research request, translator, and blind judge runs in a fresh ephemeral Codex session with file/tool access disabled except dictionary-only web search.

## Research one new term

```sh
node scripts/glossary-research-lab/lab.mjs init --term 'doble astral' --run /path/to/new-run
node scripts/glossary-research-lab/lab.mjs prepare --run /path/to/new-run
node scripts/glossary-research-lab/lab.mjs research --methods compact12-precise-nodict --run /path/to/new-run
```

This path needs no existing human glossary or canonical baseline run. Inspect the generated entry and its uncertainties under `terms/01/compact12-precise-nodict/entry.json`. The dataset is currently Spanish to Vietnamese. `init` refuses to replace a frozen manifest.

## Automatic routing confirmation

`adaptive-v1` performs the bounded source-book lookup and initial proposal itself. Its generic router escalates once for explicit lexical/coverage uncertainty or unrepresented lexical contexts, using direct Spanish dictionary evidence, a bounded source-only scout and a final proposal. It does not require manually prepared repair evidence or a human glossary. Every initial/scout/final call is charged to the method. Per-term `route.json` explains the decision; `initial.json` retains the first proposal.

For a new term, use the initialization/preparation commands above and select `research --methods adaptive-v1`. The frozen thirty-term confirmation lives in `runs/2026-10-13-adaptive/`: policy/code/model hashes were recorded before sampling, and all previously tested IDs/equivalent source forms were excluded. `prepare --holdout-policy locations` excludes adjacent source paragraphs and normalized text containment; sparse overlap is explicit. Corpus-confirmed attached-pronoun recall is attempted before reserving sparse infinitive samples. Zero-hit terms are retained.

```sh
node --test scripts/glossary-research-lab/protocol.test.mjs scripts/glossary-research-lab/adaptive.test.mjs
node scripts/glossary-research-lab/lab.mjs research --methods adaptive-v1 --run scripts/glossary-research-lab/runs/2026-10-13-adaptive --workers 6 --jobs 6
# After all thirty adaptive outputs exist, freeze them and run the references/assessments:
python3 scripts/glossary-research-lab/adaptive_benchmark.py --run scripts/glossary-research-lab/runs/2026-10-13-adaptive
python3 scripts/glossary-research-lab/adaptive_report.py
```

The benchmark controller freezes adaptive outputs before human candidate extraction, then runs human seed preparation/auditing, the complete original human-seeded procedure, controlled translation, independent blind judging/confirmation and separate entry completeness assessment. Routed cases also compare against their own initial proposals to measure escalation benefit. All phases are checkpointed and timed; logs remain under `controller-logs/`. `--workers` limits simultaneous model calls per controller; `--jobs` controls simultaneous terms.

**Success requires improvement over translation with no glossary.** Run the no-glossary sidecar alongside or after the controller:

```sh
python3 scripts/glossary-research-lab/no_glossary_comparisons.py --run scripts/glossary-research-lab/runs/2026-10-13-adaptive
python3 scripts/glossary-research-lab/adaptive_report.py
```

It copies the exact shared neutral drafts, checks their source IDs/text, and independently compares both glossary methods with those same drafts. It adds no baseline translation calls. Every non-tie receives a fresh blind second check. Primary results are confirmed gains, harms and net gains against no glossary; ties earn no credit. The report matches passages before comparing method effects, distinguishes acceptable ties from shared unresolved errors, and reports term-clustered uncertainty. Direct glossary comparisons, cost savings and completeness alone cannot establish success. Zero-hit entries have no quality evidence. Earlier reports without this control establish relative behavior only and must not be treated as proof of glossary benefit.

To generate adaptive/neutral translations before the expensive references finish, run `python3 scripts/glossary-research-lab/translate_only.py --run scripts/glossary-research-lab/runs/2026-10-13-adaptive`. This adapter verifies the frozen lab hash and reuses its exact functions with a translation-only command dispatch in a temporary module. Request prompts, model, research code, usage logging and checkpoint keys stay unchanged. The main evaluations later reuse those outputs. `--comparison INDEX:METHOD` on the no-glossary sidecar restricts it to selected existing entries, and can be repeated for focused historical cases.

`completeness --methods adaptive-v1 --reference-method baseline-human --run PATH` derives a fresh source-only sense/grammar/provenance inventory before showing randomized entries to another agent. It confirms every material completeness gap independently. Inventory/review inputs never enter routing or research. See ADAPTIVE_RESULTS.md, the run's analysis-adaptive.json and stage-measurements.csv for status, costs, unresolved cases and limitations. This is an experimental CLI workflow; production routing is not changed by the benchmark.

## Compare recently researched app terms

The separate recent-term test uses saved native app report defaults as its reference, including a clearly labeled review-only proposal. It does not rerun the original pipeline or inject old findings into compact research. `recent_app.mjs freeze` selects all distinct locally saved Gnosis VN ES–VI research terms, preferring a completed run over an incomplete restart. Its default run directory is `runs/2026-10-12-recent-app/`. Use a fresh `--run` path when freezing another test.

```sh
node scripts/glossary-research-lab/recent_app.mjs freeze
node scripts/glossary-research-lab/lab.mjs prepare --run scripts/glossary-research-lab/runs/2026-10-12-recent-app
node scripts/glossary-research-lab/lab.mjs research --methods compact12-precise-nodict --run scripts/glossary-research-lab/runs/2026-10-12-recent-app
node scripts/glossary-research-lab/recent_app.mjs import
node scripts/glossary-research-lab/lab.mjs evaluate --methods compact12-precise-nodict --reference-method previous-app --evaluation-mode controlled --run scripts/glossary-research-lab/runs/2026-10-12-recent-app
node scripts/glossary-research-lab/lab.mjs verify --methods compact12-precise-nodict --reference-method previous-app --evaluation-mode controlled --run scripts/glossary-research-lab/runs/2026-10-12-recent-app
python3 scripts/glossary-research-lab/recent_report.py
```

Import is allowed only after the fresh compact entry exists and checks every original stage hash. The canonical entry builder reconstructs report defaults, including automatic variant exclusions; later unsaved manual edits cannot be recovered. Previous app runs did not reserve the new evaluation sample. The report audits literal full-text exposure and distinguishes native usage from CLI usage, completed from provisional results, and different-model history. The earlier random-sample benchmark remains separate.

The recent Regenerar repair is a separate experimental method, `compact12-clitics-precise-nodict`. First run `node scripts/glossary-research-lab/repair_clitics.mjs --index 5` to freeze corpus-confirmed attached-pronoun forms and nonreserved raw evidence. Then use that method with `--indices 5` for research/evaluate/verify, retaining `--reference-method previous-app --evaluation-mode controlled` for judging. A second isolated comparison uses `--reference-method compact12-precise-nodict`. The repair preserves the original evaluation sample and the exact compact research instructions; only corpus forms and evidence coverage change. It is not yet a universal automatic recall rule.

## Benchmark, run and resume

The user-selected four-term report is generated with `python3 scripts/glossary-research-lab/focused_report.py`. It combines saved-app comparisons for vanidad and Íntimo with fresh human-seeded references for mundos and fatal in `runs/2026-10-12-focused/`. Keep those reference types distinct. The added-term manifest and canonical snapshot are frozen before research; compact prompts use exactly the previously tested instructions.

For that added-term run, pass `--run scripts/glossary-research-lab/runs/2026-10-12-focused` to `prepare`, `seed`, `seed-audit`, `research --methods baseline-human`, `research --methods compact12-precise-nodict`, `evaluate --methods compact12-precise-nodict --reference-method baseline-human --evaluation-mode controlled`, and `verify` with the same evaluation options. Run `audit_exposure.py` with the run path before generating the final report. A human-seeded reference can run from scratch without an unseeded baseline; omit `--ready-only` for that research command because no shared prefix exists. Existing checkpoints resume without repeating completed calls.

```sh
node --test scripts/glossary-research-lab/protocol.test.mjs
python3 scripts/glossary-research-lab/sample_terms.py --glossary /path/to/glossary --run /path/to/new-run
# Pass that same --run path to all subsequent commands for a new run.
node scripts/glossary-research-lab/lab.mjs prepare
node scripts/glossary-research-lab/lab.mjs research --methods baseline
node scripts/glossary-research-lab/lab.mjs seed
node scripts/glossary-research-lab/lab.mjs seed-audit
node scripts/glossary-research-lab/lab.mjs research --methods baseline-human --ready-only
node scripts/glossary-research-lab/lab.mjs research --methods compact12-precise --ready-only
node scripts/glossary-research-lab/lab.mjs evaluate --methods compact12-precise --reference-method baseline-human --evaluation-mode controlled --ready-only
# Measure the additional benefit of the human candidate list.
node scripts/glossary-research-lab/lab.mjs evaluate --methods baseline-human --reference-method baseline --evaluation-mode controlled --ready-only
python3 scripts/glossary-research-lab/analyze.py
python3 scripts/glossary-research-lab/analyze.py --reference-method baseline
python3 scripts/glossary-research-lab/audit_exposure.py
python3 scripts/glossary-research-lab/report_results.py
```

`--start N --limit M` is an inclusive index range, not a count. `--workers 4` limits concurrent model calls within one process; two term jobs run at once. `--ready-only` skips prerequisites that are still pending and can be repeated. Process, term, evaluation, and request locks prevent duplicate jobs in current controllers. Stale locks are recoverable. Missing outputs and failed jobs are not successful results. The default reference is now `baseline-human`; original comparisons remain separately accessible with `--reference-method baseline`.

Default paths are specific to this local experiment; override `--engine`, `--corpus-project`, `--db`, `--language-data`, and `--run` for other datasets. The default model is `gpt-6.1-sol`, matching the configured Codex model when this experiment began. Research preserves canonical reasoning settings; translation uses low and judgment medium. The CLI reports actual usage through JSON events ([authentication](https://learn.chatgpt.com/docs/auth), [noninteractive usage](https://learn.chatgpt.com/docs/non-interactive-mode)).

## Evidence and revised reference

The current run is `runs/2026-10-12/`: seed 2070955783, 30 uniformly sampled active entries out of 866 in the live Gnosis ES–VI glossary. Only source fields enter the sample manifest. Research starts from the first source term; other source aliases are withheld and corpus inflections are found independently. The corpus is an immutable local 2026-10-11 release search database. Exact-text duplicates are removed within each term. Up to 40 passages are held out per term before research; sparse terms use all available within-term distinct passages and explicitly record overlap. Zero-hit terms are retained, never replaced or padded. The current population supplies 750 term-passage comparisons: 14 full samples, 15 sparse terms, and one zero-hit term.

The user revised the reference during testing: the canonical procedure receives candidates from the existing human glossary, after explicit prohibited translations are removed. `seed` and `seed-audit` are isolated baseline-only jobs. They retain exact candidate text, exclusions with note evidence, and uncertainties. The reference receives suggestions at candidate proposal, before checks/counting; the inspected canonical interface's initial “variants” field describes source spellings, so target-list injection is a CLI adapter. Candidates are fallible, not correctness labels. Only target-independent prefix stages are shared with the unseeded run; affected downstream stages are repeated and inherited acquisition costs are included.

Optimized research never receives human targets, notes, exclusions, or seeded reference outputs. Its initial prompt hashes were frozen before human extraction. The judges receive neither glossary and do not know which output used human candidates. Preserve the unseeded procedure to quantify the human candidate advantage independently. Pending old-reference comparisons were superseded when the reference changed; empty superseded checkpoints are not quality results.

## Methods

- `baseline`: immutable snapshot of the canonical engine: dictionary, forms, family, origins, parts/frequencies, candidates/checks, discovery, proposal, two counting passes, consistency, footnotes, summary. Existing glossary inputs are empty. The unchanged report entry builder handles final splitting and pruning. Human review time is excluded by automatically freezing the proposal.
- `baseline-human`: same procedure with the human-derived candidate list and explicit exclusions at candidate proposal. It shares only target-independent evidence with `baseline`.
- `no-count`: stop the unseeded canonical procedure at proposal and omit counting and its dependent work. Rejected early after precision losses in the development pilot.
- `curated-proposal`: repair that truncation with one short curation call. All upstream canonical research still counts toward its cost.
- `compact30`: one proposal call over 30 raw research passages and the shared dictionary evidence. This tests a large workflow replacement, not separate attribution to each omitted stage.
- `compact12`: reduce only the passage cap to 12. Identical evidence at 12 or fewer passages reuses the exact output; the original first-term rerun remains a same-input replication.
- `compact12-repair`: add a brief semantic-category/name-preservation constraint, with the same 12-context cap.
- `compact12-precise`: additionally preserve lexical distinctions when the author compares or defines concepts, scope contextual adjectives, and permit readable contextual honorifics without inventing their expanded initials.
- `compact12-audited`: reuse the precise proposal; add one lexical audit only for competing variants or overlapping source forms across meanings. The audit receives raw evidence and the de novo proposal, never the human reference. Single unambiguous candidates bypass it.
- `compact12-precise-nodict`: remove dictionary acquisition from the precise method, changing no other research prompt or evidence setting.
- `compact12-repair-nodict`: separately registered dictionary-removal hypothesis. Other settings match `compact12-repair`; absent dictionary text can reuse its identical proposal while still charging proposal cost. Execution/quality completion must be checked in the results, not inferred from this list.
- `compact12-clitics-precise-nodict`: corpus-confirmed attached-pronoun recall, tested on Regenerar. Prepare its source-only evidence with `repair_clitics.mjs`.
- `compact12-diverse-precise-nodict`: deterministic TF–IDF context diversity at the same twelve-passage cap. Prepare with `diversify_evidence.py`; unchanged proposal prompt. This is not universally beneficial: retain its documented vanidad and mundos regressions.
- `compact12-provenance-precise-nodict`: bounded independent source-book pair/original-passage evidence plus generic provenance guidance. Prepare with `provenance_evidence.py`; tested successfully on Íntimo's noun/adjective/source relationship.
- `compact12-spanishdict-precise`: add a small Spanish-only published dictionary entry to the diverse-context evidence, using `dictionary_evidence.mjs`. Remove translation tables and all other-language sections. This alone did not fill fatal/vanidad's coverage gaps.
- `compact30-diverse-spanishdict-precise`: change only the context cap to thirty, preserving the exact first twelve. Tested on fatal; did not recover inevitability.
- `compact12-coverage-spanishdict-precise`: one additional Spanish-only source coverage scout over nonreserved bounded headword windows, selecting at most twelve full contexts for the unchanged proposal. The scout's meaning labels are not supplied to the final proposal. Tested on fatal and vanidad; charge both calls. Pool size limits/batching and automatic escalation thresholds remain future work.
- `compact12-scope-precise-nodict`: add a generic category-scope guard to the diverse contexts. Failed to repair mundos' broad celestial-category error by itself.
- `compact12-scope-spanishdict-precise`: add only the small Spanish dictionary evidence to that scope-guard parent. Recovered a broad celestial-body option alongside the planetary option and fixed the confirmed mundos regression.
- `compact12-webdict-precise-nodict`: measured DLE web acquisition experiment, rejected on token cost and retrieval failure. Kept only for reproducibility.

For a standalone de novo run, freeze the source-only sample, run `prepare`, then `research --methods compact12-precise-nodict`. This method does not require the original procedure or human seed preparation. Inspect the resulting `terms/NN/compact12-precise-nodict/entry.json` files. Dictionary-sharing methods and the benchmark audit still have the prerequisites described above. Check the current results before choosing a method for production.

Compact dictionary-sharing methods require the unseeded dictionary stage to be complete. Seeded outputs are never used as their research evidence.

Focused evidence preparation scripts take `--run PATH`: the Python diversity/provenance scripts use `--indices N`, and the Node dictionary script uses `--index N`. Inspect their argument definitions for parent/method overrides. A targeted fallback first prepares diverse evidence, then a Spanish dictionary. The coverage experiment's frozen evidence additionally contains `coveragePool`, taken from all nonreserved passages with full-text containment excluded in both directions. Automatic preparation/routing for this branch is not implemented. Run `research`, `evaluate`, and `verify` with the exact repair method and frozen run path. Existing evidence files refuse replacement; never promote failed evaluation passages into research. `validate_focused.py` audits the actual saved prompts, selected passages and isolated intervention factors.

`sense-audit --run PATH --indices N` asks a fresh source-only agent to group a seeded sample of up to one hundred nonreserved windows for the exact requested form. It is an assessment of meaning distribution, not a count of target-language translations. In the focused mundos experiment it ran after research and was not used to choose the entry. Its assessment tokens remain a separate ledger role.

## Quality and accounting

The controlled protocol generates a neutral Vietnamese draft with no glossary. Each fresh method-specific translator applies only its glossary and necessary grammar changes, preserving other wording. A fresh judge receives only complete Spanish sources and randomized complete A/B translations, scores accuracy/naturalness separately, prioritizes accuracy, and permits ties. The default `--judge-rubric strict` requires a clear, material correctness defect for a win/loss; both accurate versions tie. Naturalness requires a clear fluency defect to prefer a side and is reported separately. Independent absolute grades expose both-acceptable, both-needing-correction, and uncertain comparisons. A deterministic validator converts preferences unsupported by material-error grades to ties; raw answers remain saved. Earlier judgments are retained under `--judge-rubric legacy`, never pooled with strict results. Original independent full translations remain a separately analyzed protocol. IDs must match exactly: missing, extra, and duplicate rows fail validation. Hidden A/B mappings are saved outside prompts. Same-model judges are independent by context, not by model family or human expertise; inspect concrete regressions and judging variability.

Development is indices 1–20; confirmation is 21–30, frozen before judgments. Report term-level preferences, sparse overlap, accuracy regressions, and cluster uncertainty. A favorable aggregate does not establish universal equivalence. Source-book dictionaries/original-language references remain independent research evidence; old human glossary information is confined to reference preparation. Some early canonical prefix runs preceded stricter filtering of preliminary spelling/origin excerpts; audit exposure rather than claiming every stage was completely held out.

Artifacts retain hashes/provenance, raw evidence, stage checkpoints, prompts/schemas/answers, CLI events, model usage, local timings, failures and blind judgments. Input includes cached tokens; output includes reasoning. Research, seed preparation, translation, and judging are separate roles. Reused calls retain their effective cost. Sums of concurrent model-call durations measure work, not elapsed latency. Native-app savings will differ because the CLI adds a substantial fixed per-call prompt/process overhead. Six terms affected by interrupted/overlapping early controllers are excluded from paired cost savings, while their quality evidence is retained; actual wasted/unknown usage remains recorded.

Dictionary limitation: native DLE webview retrieval is unavailable. The adapter records that failure, tries canonical Wiktionary, and allows measured dictionary-only web-search fallback. The CLI cannot enforce production output-token caps. Do not describe this benchmark as identical native retrieval or convert subscription usage into API charges.

Evaluation exposure audit: corpus windows can overlap even when their full-text hashes differ. The saved full-text containment audit detects some reserved passages embedded inside larger research windows. Analysis reports a separate `no_detected_full_text_exposure` group; even this conservative check cannot rule out shorter overlapping excerpts. Reserved passages must not be described as uniformly pristine held-out evidence.

Temporary model-capacity failures receive at most two retries (10 and 30 seconds). Every failed attempt stays in the usage ledger; fresh attempts keep separate raw logs. Other errors fail the job and remain resumable rather than being counted as success.

`verify --methods METHOD --reference-method REFERENCE --evaluation-mode controlled --ready-only` sends non-tie findings to a second fresh blind judge, with newly randomized A/B and no previous reasons/grades. Disputed preferences become ties in separate verified judgments; original votes stay saved. Analysis prefers verified rows when present. This checks claimed differences, not every possible false-negative tie.

The model is frozen in run provenance. Changing models requires a fresh run, so checkpoint reuse cannot silently mix models in a comparison.

Exact-output reuse also inherits the parent's confirmed judgment when the translated passage arrays are identical. This prevents an unchanged sparse-term output from being assigned a different quality score solely through another judge draw. Independent extra votes remain in raw files.

Zero-hit exception: the harness retains the initially zero-hit term as untested and stops before the canonical engine. It does not validate alias recall or the full original workflow for that case. A production router should try targeted spelling/article/phrase variants or obtain an example before treating absence as established. Quality and paired cost figures exclude this untestable case.
