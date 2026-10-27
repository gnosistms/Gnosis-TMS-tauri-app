# Candidate coverage and bounded glossary repair

Hans requested glossary-only correction of underused contextual renderings,
automatic detection, evidence-based usage-note search, and bounded verification
with user-visible failures. His latest steering pauses note experiments to trace
why the experimental mundo entry omitted planet in the first place.

The provenance gate is complete; see
`plans/glossary-research-mundo-candidate-omission.md`. Planet was explicitly rejected,
its contextual validity was recognized by independent audit, and the repair failed
to deliver it. Compilation checked broad meanings rather than audit obligations.
The canonical full procedure already has candidate-preservation guidance that the
prototype weakened. Note experiments remain paused for this investigation report;
the four subsequent items below remain unexecuted.

Hans has now authorized implementation and testing: first preserve planet/planets
in the HTN entry, then demonstrate its use in ordinary translation. Resume the
work below. Add structured contextual candidate obligations to the existing audit
and compiler, revise the one-word-per-broad-sense/rejection-preservation prompts,
and verify compiled candidate coverage after sorting. Use a fresh run to preserve
old evidence. Test no glossary, the old entry and the automatically repaired entry
with identical ordinary translation prompts, low reasoning and two repetitions.
Use the existing hard cases plus a separately sampled reserved source cohort.
Repair agents see only raw evidence and their own runtime findings; assessment
criteria stay external. At most two repair attempts; failures remain reported.

## First gate: provenance and missing-candidate investigation

Trace the exact entry used in the matched comparison back through source inventory,
target generation, candidate dispositions, audit, compilation, self-check and
frequency sorting. Distinguish the experimental HTN from the original full research
procedure. Determine whether planet was never generated, explicitly rejected, or
lost during delivery. Inspect supplied dictionary/source evidence and prompts for
systemic causes. Preserve the old results; qualify conclusions if the comparator
was deficient. Do not attribute an experimental defect to production without proof.

## Subsequent authorized work

1. Test ordinary translation with no glossary, the original experimental entry,
   a candidate-complete entry, and usage-note/priority variants. No pretranslation
   source-analysis pass in the translator. Keep frequency semantics truthful:
   diagnostic preference-order overrides must be explicit; final frequency order
   is measured separately from conditional selection priority.
2. Build a generic research-time detector from independently established source
   meanings and target candidates. Check missing candidates separately from
   failure to select an available candidate. Assess detection on actual failures,
   fault injections and acceptable counterexamples; disagreements remain unknown.
3. Route candidate omissions back to target research; route selection failures to
   concise, evidence-supported applicability/preference notes. The repair agent
   receives no human per-term criteria or external grading. Preserve evidence and
   rare meanings through compilation and frequency sorting.
4. Verify repaired entries using ordinary translation on development and reserved
   examples, including counterexamples to overcorrection. At most two repair
   attempts per term/language. On exhaustion retain unresolved status, evidence,
   failed examples and a user-facing report; never silently certify success.

## Constraints and validation

Use the existing isolated ChatGPT-subscription transport, fresh contexts,
tools/memory/plugins disabled, and no API credentials. Human acceptance criteria
stay in a separate external evaluator after runtime outputs freeze. Runtime source
contracts may be generated independently from source, never copied from criteria.
All measured and failed attempts count toward cost. Keep the computer awake during
execution and reporting. Scope edits to lab and related planning documents;
production integration follows demonstrated results, not a successful hand patch.

## Current implementation and test run

The HTN v2 uses candidate_contracts.mjs in its existing target/audit/compiler
methods. Audit outputs have source-quoted contextual delivery obligations; compiled
and frequency-sorted entries must retain their targets and scope. Kept candidate
dispositions must correspond to delivered variants. Failed delivery triggers one
conditional closure retry; remaining failures block certification and are recorded.
The research budget increases from seven to eight distinct tasks only to accommodate
that conditional closure and final verification. Legacy frozen outputs require a
fresh run rather than silently receiving a new certification.

The isolated run is runs/2026-10-14-candidate-delivery. It imports criteria-blind
source findings, not acceptance labels. Fresh source audit and target repair produce
the entry; literal preservation is checked through the real Gnosis hint builder.
Ordinary low-reasoning translations compare no glossary, the old deficient entry
and the repaired entry in two repetitions. Main cases comprise 25 historical hard
paragraphs and 12 source-sampled paragraphs reserved from the new note author.

Before repaired translation output was available, a source-only morphology check
found that the 12 random examples contained no mundos plurals. Add all six sampled
paragraphs containing mundos as a separate plural cohort, including nonplanetary
uses. This selection uses only Spanish word shape, not target judgments. Two
unprimed source readings establish their provisional preferred renderings before
seeing glossary or translations. Runtime selection checking uses these readings
and earlier criteria-blind source readings; no human criteria. A second note repair
is conditional on its own findings and is tested again with frequency remeasurement.

Retain the rejected first audit/entry attempt, which over-expanded obligations and
included unsupported quotations. The contract caught it. Audit requirements were
clarified generically: necessary contextual distinctions, headword contribution,
attested senses and usable scopes, rather than exhaustive synonyms/compound labels.
Source evidence validation includes already supplied neighboring paragraphs and
source quotations carried in the inventory, while rejecting invented quotations.

## Completed scoped result (2026-10-15)

See runs/2026-10-14-candidate-delivery/RESULTS.md and results.json. Candidate delivery
passes, including planet and planets through the real hint path and final frequency
sorting. Thirty-three structural/regression unit tests pass. The criteria-blind
checker passes six fault/alternative controls, including a bad researched-word
rendering with an unrelated correct planet elsewhere. External grading passes ten
mirrored controls after clarifying that term policy includes negative applicability
boundaries; the failed first calibration remains counted.

Both independent ordinary translation repetitions improve all seven externally
identified planetary passages relative to both controls (14 confirmed policy gains,
zero policy or researched-term meaning harms across 86 presentations). This confirms
glossary-only feasibility for the original cases. There is no extra translation-time
source-analysis pass and final order remains frequency-based.

The original source-derived validation has no detected failures after its conditional
consumer repair, with eight unknown preferences per repetition. A further robustness
probe changes source IDs and Hercólubus to a new planet name, Orvantis. The plural
rendering changes between worlds and planets across repetitions. Record this as an
unresolved robustness warning; do not change notes from external criteria or hide the
warning because the old cases pass. One unrelated spelling-discussion error (Juan
changed to John while keeping the author's letter decomposition) also creates an
isolated passage-level harm versus no glossary. Overall selection status is
needs-review; configured retries are exhausted, not silently extended.

The discarded over-expansive audit/entry attempt, structural closure retry, failed
subscription launches/rate-limit attempts, and both evaluator calibrations are in
the request ledger. Imported source research and historical source preferences cost
extra. No broad cost/speed win or production rollout is claimed.
