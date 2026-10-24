# AI recommendations for optional research

Add advisory AI recommendations before the skippable Studio operations: 2a, 4.1, 4.3, 4.4.1, 4.4.2, 4.4.3 (Source summary; skipping discards parent source research), and 5. Each gets a specific prompt. The model considers Skip, Run, and uncertainty internally, but returns only Skip or Run as the recommendation; uncertainty, unavailable evidence, malformed responses, and request failure default to Run. Show one short reason, with human Run/Skip controls. Recommendations never approve, skip, advance, or start research by themselves.

Preserve completed studies and evidence. Use the existing configured research provider and tool adapter for either supported provider. Supply only bounded, relevant summaries, grammatical findings, and a few explicitly labeled source excerpts. Cache recommendations by their actual compact inputs and prompt version; record their timing and usage separately from research-stage timings. Navigation back to unchanged data must reuse the recommendation, and stale inputs must not display a current recommendation. Respect cancellation, double-click protection, and team/study ownership checks.

The original Desktop plan numbered this deterministic rule 4.4.3: when both 4.4.1 and 4.4.2 are skipped, skip the source-summary operation 4.4.4. It is not a missing research operation. Expose that rule in the UI and apply it during navigation without an AI request or a manual summary approval. Skipping 4.4.4 after either source branch ran retains the existing confirmation explaining that the whole provenance branch is discarded.

Implementation sequence:
1. Add bounded recommendation inputs, step-specific prompts, conservative output normalization, and an input fingerprint; unit-test uncertainty and evidence limits.
2. Integrate recommendations with entering/resuming optional steps, manual refresh, cancellation, saving and existing Run/Skip actions. Replace step 2a's immediate research start with a recommendation-first choice, as required to let the user decide. Keep previously generated forms and completed stages available.
3. Add a compact accessible recommendation panel and an unnumbered source-summary rule; retain adjacent footer buttons and primary action placement.
4. Verify skip authority, unchanged-input reuse, changed-input refresh, failure behavior, summary-parent confirmation, and no paid work after cancellation using browser regressions; run focused tests, lint and build. No paid research is needed for these checks.

## Numbering and saved-study compatibility

Per the follow-up request, Source summary is now displayed as **4.4.3** throughout the step list, stage heading, recommendation prompt and timing labels. The skip-if-both-branches-skipped rule is unnumbered explanatory text. Existing storage IDs remain stable internally so old evidence references and approved validation signatures are not invalidated by a presentation-only numbering change. No existing study is rewritten or re-researched merely to renumber it.

## Prompt contract

Every prompt asks the model to consider Skip, Run or uncertainty internally; uncertainty must return Run. The only recommendation values accepted by the app are **Skip** and **Run**. Each response also includes one short reason for the human decision. Unknown/malformed outputs and failed requests become Run. Advice cannot approve, advance, run or skip a stage.

### 2a · Forms and spellings

Decide whether to search for additional forms and spellings beyond the user's list. Run if inflections, orthographic variants, transliterations or uncertain form identity could change corpus coverage. Skip only when there is positive reason to believe the supplied forms already cover this lexeme. A familiar word or an empty list is not evidence of completeness.

### 4.1 · Dictionary

Decide whether source-language dictionary research would add needed definitions, grammatical distinctions or reliable etymology. Run for ordinary words without adequate cited dictionary evidence, ambiguous parts of speech, uncertain borrowing or disputed meanings. Skip only when adequate reliable lexical evidence is already supplied, or the term is demonstrably a corpus-specific coinage for which dictionary lookup would add no useful information. Do not assume dictionary absence from unfamiliarity.

### 4.3 · Word parts

Decide whether analyzing meaningful word components would improve interpretation. Run for plausible productive compounds, prefixes or suffixes whose contribution remains unresolved. Skip for an established simple lexeme or where reliable dictionary evidence already resolves the relevant formation. Do not invent word parts from superficial letter resemblance; remote etymology alone does not justify decomposition.

### 4.4.1 · Bibliographical sources

Decide whether comparing the author's bibliographical sources could resolve a material question about specialized meaning, borrowing or original terminology. Run when corpus usage departs from established ordinary senses, a specific source attribution needs checking, or competing source traditions affect interpretation. Skip when dictionary and corpus findings adequately cover the attested uses and there is no unresolved source question. Ordinary use of a word by multiple authors does not establish borrowing. This branch is available only for the Samael Aun Weor corpus.

### 4.4.2 · Internet sources

Decide whether an additional web search for possible sources would resolve a material question left open by dictionary, corpus and any bibliographical findings. Run for an unresolved specialized use, original-language term, chronology or borrowing claim that could affect the glossary. Skip if existing evidence adequately covers the uses and no material source question remains; do not repeat established searches or pursue a remote first attestation for its own sake. Unknown evidence is not evidence of absence.

### 4.4.3 · Source summary

Decide whether to keep source research and run its source-summary operation. Run if either completed source branch contributes supported meanings, useful provenance, relevant uncertainty or conflicting findings that must reach the meaning inventory. A locally assembled summary still counts as Run even if it needs no further AI synthesis. Skip only if the user can safely discard ALL contributions from BOTH source branches without affecting the glossary. Skipping this step discards the entire parent source-research branch, not merely the cost of summarizing it. If both branches were explicitly skipped, the workflow handles this automatically without this recommendation call.

### 5 · Compounds and phrases

Decide whether further compounds-and-phrases research is useful after split-entry review. Run if the supplied evidence suggests recurring fixed expressions, or even one expression with a special meaning not readily understood from its parts, that previous review has not adequately handled. Skip if the completed review already handles such expressions and remaining combinations are ordinary grammar. An empty proposal list or a small excerpt sample alone does not establish that no compounds exist.

## Verification and delivery

Implemented advisory recommendations with bounded inputs, timing records, cancellation, manual refresh and unchanged-input reuse. Back stays read-only. Old form-check results require a human-triggered refresh or Skip rather than silently restarting paid research. No live provider calls were used for verification.

- 183 Studio unit/render checks pass; all 2,505 frontend tests pass.
- All 25 workflow checks pass with local child-process/port access.
- All 50 Studio browser cases are covered successfully across the full suite and final targeted rechecks. The full suite passed 47 cases; three checks required the new recommendation-aware fixture expectations or removal of the unnecessary Back request. All three, plus seven surrounding cases, passed in the final 10-case recheck.
- Focused ESLint, production frontend build and diff whitespace checks pass. The browser screenshot confirms that the recommendation is visible on entering the step and the outline displays Source summary as 4.4.3.
- Native app packaging is blocked before compilation by scripts/guard-rust-build-cache.mjs: about 14.0 GiB free against its 30 GiB floor, with 16.5 GiB protected by running Rust binaries. No build cache or user data was deleted to bypass the guard. The running bundled app must be rebuilt after adequate space is available before it includes these changes.
