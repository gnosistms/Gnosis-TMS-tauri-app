# Matched reasoning comparison before adopting meaning binding

Hans requested this comparison on 2026-10-14. Keep his criteria outside both
workflows. Keep the computer awake until execution, evaluation and reporting finish.
No production or research-procedure changes are authorized by this experiment.

## Question and cohort

Does the independently researched glossary improve the source-first translation
workflow beyond the extra reasoning that the same workflow can do without a
glossary? Use all 25 frozen mundo paragraphs / 34 occurrences, including ambiguous
cases, ordinary and specialized uses, idioms, geography, physical bodies and the
Sun-containing category. Do not restrict to the 12 previously served paragraphs.
The examples are previously exposed diagnostics, not new holdouts.

## Treatments and compute

Two independent repetitions per treatment. Each repetition has one source-analysis
call followed by one translation call. Both use gpt-6.1-sol, medium reasoning,
identical raw source/neighbor context, schemas, instructions, order, and response
obligations. Both independently establish source meaning and preferred rendering
before seeing an existing translation. Both retain their own choices in transient
analysis and use identical deterministic rendered-span checks. Unknown cases still
receive full translations and remain unknown in binding checks.

The glossary arm additionally receives the frozen, criteria-blind Spanish meaning
inventory during analysis and the ordinary serialized English glossary during
translation. The no-glossary arm receives no corpus/dictionary research, source
meaning inventory, glossary, former choices, outputs, labels or human criteria.
Its own intermediate passage analysis is ordinary workflow reasoning, not a
preexisting/reusable glossary. Both translate every paragraph; no selective gating.

This matches the inference schedule and reasoning settings, not exact consumed
tokens. Glossary information necessarily adds input tokens. Report actual input,
cached input, output, elapsed and failed-attempt costs by arm. Do not pad the
no-glossary prompt with irrelevant text to manufacture numerical equality. If
glossary quality is better but its compute is materially higher, do not attribute
the gain to the glossary without a further budget-matched control. A no-glossary
tie/win with equal or less measured use establishes no observed added value on
this cohort. Historical glossary acquisition/research/count costs are separate,
additional costs; imported evidence costs remain incompletely attributed.

## Evaluation and validity

Freeze both outputs before a separate evaluator reads human criteria. Evaluate
semantic accuracy, terminology policy, naturalness and whole-passage preservation
separately, with independently ordered duplicate comparisons. Use the exact Desktop
criteria plus calibrated source judgments in evaluation only. Repeat a meaningful
fault/acceptable-alternative control for planetary selection and Sun over-application
before accepting evaluator results. Never feed judgments into either workflow.

Report paired effects within each repetition, replicated gains/harms, absolute
failures, grader disagreements and unknowns. Explain any improvement common to both
arms relative to the earlier one-pass no-glossary output; that shared improvement is
evidence for extra reasoning, not glossary value. Deterministic compliance checks
cannot certify source interpretation or linguistic quality. Source-first preferences
remain model judgments, not hidden human expectations.

## Scope

Implement only in scripts/glossary-research-lab, with frozen prompts/input hashes,
isolated subscription execution, tools/plugins/memory disabled and API credentials
removed. Use at most eight intended workflow calls plus evaluator/calibration calls.
Any protocol repair must be generic, bounded, recorded and leave criteria external.
Preserve earlier trials and costs. Do not add this feature to the HTN or app before
this comparison is reported.

Execution notes: one glossary analysis omitted exact surface forms while supplying
explicit preferred renderings. The compiler now uses that supplied rendering as
the sole approved form when the list is absent; it invents no inflection. An
ambiguous catalog link containing two valid ids remains ambiguous and is accepted
as such. Both changes are general and criteria-free. The first controller aborted
a concurrent no-glossary call on the formatting issue; that attempt is recorded as
unknown usage, and completed calls are reused by exact request signatures. Worker
failures now preserve other jobs. There is no linguistic repair from evaluator data.

Conditional budget control (registered before its inference): primary glossary shows
three confirmed policy wins across 50 presentations, but none repeats on the same
paragraph; it consumes about 13% more total tokens. Run two no-glossary repetitions
with identical inputs/schemas/instructions and two calls each, raising only reasoning
effort to high. Record actual usage: this gives a conservative compute bracket, not
pretended exact token equality. Evaluate frozen results against both original arms
in independently ordered external contexts. No per-case outcomes or criteria enter
the control; only the aggregate compute finding motivated this predeclared effort
change. If a token gap remains, disclose it; do not tune vocabulary or selected cases.
The glossary research cost remains additional to its application cost.

The second glossary repetition's acceptedForms lists contain synonyms inconsistent
with its preferredEnglish fields. Its translations often use preferredEnglish but
fail literal checks against those lists. Preserve the raw contract failure; do not
repair outputs after external evaluation. Linguistic scores and protocol compliance
are reported separately.

## Completed result and decision

**Subsequent comparator correction:** the tested glossary omitted planet despite
source support and an independent audit detecting its contextual validity. The
repair stage acknowledged this but did not deliver the candidate. The measured
results concern that deficient entry; they cannot establish whether a complete,
effectively annotated glossary would improve ordinary translation. The earlier
recommendation to favor translation-workflow changes is withdrawn pending that
test. See `plans/glossary-research-mundo-candidate-omission.md`.

The completed comparison is recorded in
`scripts/glossary-research-lab/runs/2026-10-14-equal-compute/RESULTS.md`.
All 25 paragraphs / 34 occurrences were translated in two independent repetitions
per arm. The primary comparison found three glossary terminology gains across 50
presentations, but none repeated on the same paragraph. Against the higher-reasoning
no-glossary control, there were zero confirmed meaning or terminology gains or harms.
One-off whole-passage and naturalness differences went in opposite directions;
neither repeated. The control consumed 109,164 total tokens versus the glossary's
113,043, a 3.6% difference. Different token types and reasoning settings prevent an
exact compute-equivalence claim. Glossary setup costs remain additional.

The comparison establishes no repeatable added glossary quality beyond the shared
source-first reasoning on these previously exposed English mundo cases. Both arms
used source analysis, preserved preferences and deterministic checks, so this
comparison cannot establish whether that shared mechanism is necessary or valuable
relative to a workflow without it. Its production adoption remains unvalidated;
it is not rejected or removed on the basis of this result. The experiment also does
not establish that glossaries lack value generally. Human criteria stayed external.
The second glossary repetition's 23 literal contract errors remain visible and
unrepaired. No production procedure or app change was made.

Clarification from Hans: additional compute is acceptable within reason when it
produces better quality. Optimize quality first, then assess the incremental cost
of a demonstrated improvement. Equal-compute controls distinguish the contribution
of glossary information from reasoning; they are not a requirement to reject any
mechanism that consumes more compute. A separate comparison is needed to measure
the shared source-first selection, preservation and checking mechanism itself.
