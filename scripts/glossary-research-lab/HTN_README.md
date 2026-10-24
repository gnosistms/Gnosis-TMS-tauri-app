# Criteria-blind glossary research prototype

The latest scoped experiment is `runs/2026-10-14-candidate-delivery`; see its `RESULTS.md` and `plans/glossary-research-candidate-repair.md`. The original criteria-blind seven-term research records remain in `runs/2026-10-14-htn-blind`. Production integration and full-procedure equivalence remain unvalidated; no original safeguard is retired.

HTN v2 adds structured contextual candidate obligations to the existing audit and checks actual delivery before and after frequency sorting. A broader target cannot discharge a required narrower candidate. Every kept source-supported candidate needs an actual variant and scope. A failed guard allows one conditional closure retry; unresolved delivery blocks final certification. Previous frozen v1 entries require a fresh run with `htn_blind.py --run PATH`, preserving the old evidence.

The scoped candidate-repair run keeps planet and planets and confirms seven repeated terminology improvements against ordinary no-glossary translation and the old entry across 43 paragraphs / 57 occurrences. The translator receives ordinary glossary hints and frequency-order rules, with no extra source-analysis pass. Research-time checking uses independently generated source preferences, never human acceptance criteria. A conditional consumer repair supplies explicit scoped priorities, then remeasures frequency and retranslates. The six checker fault/alternative controls and ten external evaluator controls pass.

Selection remains `needs-review`: a fresh-ID/unseen-name robustness variant still uses worlds in one of two repetitions, and eight source preferences remain unknown per repetition. The configured consumer repair limit is reached; these warnings must appear in the report. Human criteria are read only by the external evaluator after entry/translation freeze and never feed into repairs. The earlier inference that changing translation was preferable to glossary repair is withdrawn: the old comparator omitted planet.

The runtime (`htn_blind.py` and `htn_blind_runtime.mjs`) receives raw source, dictionary and original-work evidence. It decides meanings, identity, candidates and translation quality independently. Neither research, self-check, compiler, frequency judges nor translator receives the Desktop acceptance file, source labels, expected targets, grader verdicts or earlier criterion-aware findings. General design improvements are allowed; per-word answer rules are not. Subscription-authenticated Codex execution uses fresh ephemeral contexts with tools/memory/plugins disabled and API credentials removed.

`htn_core.mjs` owns source identities, coverage, evidence validation, Gnosis matching/hint construction, compilation, source-quoted note edits and frequency sorting. A single repair round routes a discovered linguistic defect to its actual dependency. Persisted budgets cap research at seven distinct tasks per word. Final verification records failures without another repair.

`htn_blind_acceptance.py` is an external harness, never imported by the HTN. It strips roles/labels from raw application paragraphs, acquires independent count samples, and exports results only after final freeze. Only the external evaluator reads human criteria. Its results never feed back into this run. The primary baseline uses the same source neighbors with no glossary. Two independent occurrence-level judgments measure preferred sample use; disagreement remains visible and rare zero-count candidates survive.

```sh
python3 scripts/glossary-research-lab/htn_blind.py --workers 2
python3 scripts/glossary-research-lab/htn_blind_acceptance.py prepare
python3 scripts/glossary-research-lab/htn_blind.py --phase final --workers 2
python3 scripts/glossary-research-lab/htn_blind_acceptance.py evaluate
node --test scripts/glossary-research-lab/htn_core.test.mjs
```

Run one controller per phase/term. Recorded request signatures, locks, schemas, prompts, outputs, retries, execution snapshots and ledgers support review/resume. `research-frozen.json` freezes the independently built entry; `final-frozen.json` precedes external evaluation. Criteria-blind does not mean source-unseen; neighbor/retrieval overlap must be disclosed.

All earlier runs in `runs/2026-10-14-htn`, including v4 and v7, are superseded diagnostics because entry construction knew human requirements. Their costs and useful failure observations are retained. They do not prove the new blind system meets the criteria.

Remaining adoption gates include original full counting semantics, shared-glossary collisions, broader historical/random regression, the actual configured application model, contested human judgments and matched cold-run efficiency comparison. No speed/token saving is claimed before measurement, and unknown obligations remain unknown.
