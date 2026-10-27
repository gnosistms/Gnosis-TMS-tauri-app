# High-level HTN design for deep glossary research

Status: design only, 2026-10-14; amended the same day for per-sense translation-selection testing and related-expression studies. This revision changes the design only; no implementation, model calls, experiments, or glossary changes were made.

## Basis and intended result

The root goal is to produce reviewable glossary entries that preserve the author's meanings, give readers understandable target wording, and actually cause the translating AI to select the correct rendering for each meaning. Describing the correct choices in an entry is insufficient: the entry must be tested through the translation workflow that will consume it. Preference counts describe contextual choices; they do not establish correctness or improvement over translation without a glossary.

This design starts from the original full procedure and its safeguards. The compact route is historical context, not the baseline. The proposed efficiency changes below are hypotheses to validate.

Inspected sources:

- [Original written procedure, October 6–8](</Users/hans/Desktop/AI-Projects/GlossaryGen/procedure-glossary-term-research.md>).
- [Earlier CLI prototype](</Users/hans/Desktop/AI-Projects/GlossaryGen/variant_tool/README.md>) and [original app requirements](</Users/hans/Desktop/AI-Projects/GnosisTMS/plans/glossary-research-plan.md>).
- [Full engine](</Users/hans/Desktop/AI-Projects/GnosisTMS-research/src-ui/app/glossary-research-engine.js:2383>), [research prompts](</Users/hans/Desktop/AI-Projects/GnosisTMS-research/src-ui/app/glossary-research-prompts.js>), [consistency logic](</Users/hans/Desktop/AI-Projects/GnosisTMS-research/src-ui/app/glossary-research-consistency.js>), and [report/save preparation](</Users/hans/Desktop/AI-Projects/GnosisTMS-research/src-ui/app/glossary-research-report-flow.js>).
- [Documented false-friend failure](</Users/hans/Desktop/AI-Projects/GnosisTMS-research/plans/glossary-research-procedure-2026-10.md>), [human-criterion experiments](</Users/hans/Desktop/AI-Projects/GnosisTMS/plans/glossary-research-human-challenge.md>), [full-preservation work](</Users/hans/Desktop/AI-Projects/GnosisTMS/plans/glossary-research-full-preservation.md>), and [twenty safeguard contracts](</Users/hans/Desktop/AI-Projects/GnosisTMS/scripts/glossary-research-lab/full_research_contracts.mjs:2>).
- [Mundo translation-selection experiment](</Users/hans/Desktop/AI-Projects/GlossaryGen/MUNDO_TRANSLATION_TEST_SUMMARY_2026-10-14.md>), [mundo/sensible audit](</Users/hans/Desktop/AI-Projects/GlossaryGen/MUNDO_SENSIBLE_REVIEW_2026-10-14.md>), and [Hans's seven-term acceptance criteria](</Users/hans/Desktop/GLOSSARY RESEARCH SPANISH TEST TERMS>).

History matters: commit `ddb365c6` requires testing every candidate rather than a group representative; `1bd3a1aa` replaces premature interchangeability grouping with contextual consistency testing; `5bb709e6` settles all meanings together so a translation is removed only when no meaning still needs it. The October 6 document's candidate grouping therefore does not describe the latest full engine. Recorded examples and AI assessments identify obligations; they are not all independently human-verified outcomes.

The mundo experiment reports that changing candidate order and an explicit priority note substantially improved selection of "planet" in planet contexts, while descriptive notes alone did little. It establishes a reason to test the entry's behavior rather than infer quality from chosen-variant counts or existing translations. The suggested explanation involving training data is a hypothesis; the observed directional selection error is sufficient to motivate the method. Its targeted sample does not estimate corpus-wide error rates, and it does not establish the same effect for Vietnamese or other terms. The summary's D row does not fully reconcile its listed selections and total errors; retain its reported results as historical evidence and require complete occurrence accounting in future tests.

## What each existing step protects

The table separates linguistic research from safeguards on evidence, judgment, and delivery. Purpose is grounded in the procedure, prompts, comments, and history; the proposed HTN treatment is a design recommendation.

| Existing step | Purpose or error prevented | HTN treatment |
|---|---|---|
| Dictionary lookup | Avoid invented lexical authority; retain ordinary senses, grammatical labels, and complex forms. Distinguish no entry from retrieval failure. | Always obtain or record the status of lexical evidence; reuse a valid article. Missing evidence remains explicit. |
| Form proposal and contextual confirmation | Find inflections, accents, capitalization, joined/hyphenated forms; exclude unrelated homographs and spelling look-alikes. | Establish searchable forms once, including conjugations and gender/number forms; confirm ambiguous forms and test whether their target applicability differs. A surface form may still require occurrence-level disambiguation. |
| Word family and study selection | Find coined derivatives and related concepts; avoid mistaking letter overlap for kinship or silently merging distinct words. | Record form, derivational, and phrase relationships separately. Verify uncertain relatives; propose genuine derivatives for related studies and share reusable evidence without inheriting their parent's translation automatically. |
| Construction/collocation inventory | Detect noun/adjective differences, titles, fixed phrases, and uses that need different wording. | Test sampled phrases with component entries first. Create separate phrase entries for demonstrated failures, including failure to select a correct but construction-specific variant. |
| Population and sampling | Prevent ranked-search bias, duplicate inflation, and mixing discovery examples with counted evidence. | Deterministic shared acquisition: complete population, deduplication, seeded count sample, separate discovery/diagnostic material. |
| Source-book/origin study | Recover borrowed technical meanings, names, quotations, and original designations. Avoid treating a definition or another tradition's equivalent name as the term's own translation. | Cheap provenance screening for every sense; deeper source tracing when borrowing, naming, chronology, or an unexplained meaning matters. |
| Original-language verification | Prevent guessed originals, wrong source editions, and unverified spelling corrections. | Required when an original designation or canonical spelling will influence the entry. Prefer direct aligned evidence; inspect additional passages when unresolved. |
| Source parts and sense inventory | Explain coined words and establish meanings independently of target candidates. Keep ordinary and specialized grammatical uses apart. | Always establish sense/grammar identities; decompose source terms when composition helps establish meaning or transparency. |
| Source sense frequency | Establish familiarity of the actual source sense, rather than letting a common unrelated sense set the benchmark. Distinguish rare words from alleged inventions. | Measure when a familiarity comparison or coinage claim needs it; reuse a matching measurement. Low frequency and dictionary absence alone do not prove authorship. |
| Candidate generation | Avoid a narrow list that dictates the judges' answer; retain plain phrases, technical terms, originals, and alternatives for each sense. | Generate against explicit source meanings; every considered candidate has a recorded disposition. No pre-test grouping as interchangeable. |
| Target word/part checks | Catch false friends and compounds whose parts do not communicate the intended meaning, even when a dictionary lists the whole word. | Screen every candidate; decompose every relevant constructed candidate, including dictionary-listed compounds. Investigate its parts as needed. |
| Target sense frequency | Prevent a common spelling's unrelated sense from making the required rare sense appear familiar. Handle real lexical units and surface forms across languages. | Schedule per language, lexical unit, and needed sense; share valid results across candidates and studies. Whole-word scores alone cannot clear a suspect sense. |
| Unrestricted discovery translation | Find idiomatic renderings and missing meanings without forcing contexts into the candidate list. | Preserve an independent open-reading task; concentrate additional reading on uncovered constructions and meanings. |
| Proposal consolidation | Translate research into usable entries without losing candidates, grammatical applicability, phrase decisions, or defining conditions. | Assemble from the research record; check sense/candidate continuity instead of asking a new call to rediscover everything. |
| Existing-entry comparison | Explain changes while avoiding anchoring independent discovery to previous glossary answers. | Compare after the independent proposal. Existing source forms can assist recall; existing targets remain identified separately from independent evidence. |
| Shared-translation/convergence check | Prevent two distinct source concepts being collapsed into one target; permit genuine equivalence. | Cheap collision lookup for all candidates; semantic investigation only for actual collisions and evidenced contrasts. |
| Human review | Catch project terminology requirements and linguistic judgments that model agreement cannot settle. | Preserve review before the counted proposal is frozen. Required meaning conflicts remain visible for a decision. |
| Freeze/versioning | Ensure counts refer to the proposal actually reviewed; prevent stale results after edits. | Freeze meanings, scopes, originals, and reader guidance with wording. Invalidate dependent results when their assumptions change. |
| Sentence translation, counting, second judge | Verify actual sentence fit; expose disagreement, other renderings, incomplete outputs, and unresolved occurrences. | Label source meanings independently before translation, then test the actual consumer against those labels. Use samples covering every attested sense and report directional selection errors separately from preference counts. Full two-judge measurement remains the baseline; selective second checking is a separately validated efficiency option. |
| Consistency testing | Detect unstable choice between variants; distinguish stylistic alternatives from meaning changes; avoid deleting a variant needed elsewhere. | Check correctness as well as stability: a consistent wrong choice fails. Test contested meanings and overlapping candidate scopes; repair notes/order or promote an evidenced phrase exception, then check every affected sense for regressions. |
| Rare-winner/reader notes | Explain retained opaque terminology, particularly legitimate technical names that cannot be replaced by ordinary wording. | Investigate readability for retained rare/opaque candidates; attach explanations to the delivered entry and intended reader-note path. |
| Form splitting and variant pruning | Give forms separate entries when they require different translations; keep entries compact. | Split by evidenced applicability, using counts as supporting evidence. Rarity alone cannot erase a supported meaning; changing old pruning thresholds is an explicit policy change. |
| Summary, report, save | Make results usable and auditable; prevent summaries, serialization, or save preparation losing findings and restrictions. | Render factual results mechanically where possible; verify the exact saved entry and the guide the translator receives. Narrative summary is optional presentation. |
| Apply-and-sweep follow-up | Find finished translations and notes affected by a rejected target part; prevent recurrence outside the studied word. | Produce an impact-review task when a general exclusion is established. Revision of translations is a separate authorized operation. The written procedure includes this; the engine primarily reports the sweep requirement. |
| Budget, cancellation, persistence | Bound spending and recover work without corrupting partial counts or mixing versions. | Common execution constraints across every method, not extra linguistic branches. Exhausted or skipped evidence is unknown, never a pass. |

## Proposed task hierarchy

An HTN task states what must be established. Its methods are alternative ways to establish it, with evidence-based preconditions and explicit completion conditions. The planner chooses inexpensive applicable methods and can replace a decomposition when new evidence changes its assumptions.

```text
Research expression for a glossary
  Establish research scope and evidence
    Obtain lexical evidence and confirmed forms
    Build population, construction inventory, and samples
    Distinguish same-word forms, derived words, and multi-word expressions
    Screen related words and provenance; propose related studies
  Establish source meanings
    Resolve sense, grammar, and expression boundaries
    Explain composition when relevant
    Trace and verify borrowed meaning when relevant
  Establish usable target renderings for each meaning
    Generate candidates and read contexts independently
    Establish semantic fit and reader comprehension
    Establish familiarity where required
    Preserve source contrasts and verified designations
  Build and review entries
    Assign forms/phrases and operational selection conditions
    Compare with existing entries
    Review and freeze the complete proposal
  Validate the reviewed entries
    Freeze independent source-meaning labels for per-sense test samples
    Translate with the actual glossary consumer and grade variant selection
    Test phrases with component entries before adding phrase entries
    Translate contexts and account for every occurrence
    Repair incorrect or unstable selection; confirm on reserved passages
    Check rare meanings and readability obligations
  Deliver entries and evidence
    Verify saved fields and actual translator input
    Render report and identify downstream impact
```

These are dependencies, not a requirement for one serial call per line. Dictionary retrieval and corpus indexing can be independent. Original verification must precede treating an original as verified; source meanings precede candidate judgments; review precedes counted judgments.

## Methods for the recurring patterns

Methods attach to individual meanings, expressions, or candidates. A word may need several. Each row gives an applicability condition, a decomposition, and a completion condition.

| Method | When applicable | Work and completion condition |
|---|---|---|
| Ordinary contextual sense | Dictionary and contexts explain the use; no unresolved boundary or provenance issue. | Establish sense and grammar → propose ordinary wording → test actual translation against independent source labels. Complete when the entry reliably selects meaning-appropriate wording and the needed sense's familiarity is evidenced or already validly measured. |
| Fixed expression | A dictionary complex form, title, idiom, or recurring construction suggests meaning belongs to a larger unit. | Retrieve whole-expression uses → test the actual consumer with component entries → investigate failed contexts → compare a separate expression entry when warranted. Complete with a tested expression entry or an evidenced decision that components suffice. |
| Productive combination | A headword occurs in many combinations whose modifiers may supply their own meanings. | Study the headword's contribution → sample contrasts across modifiers → test component-entry translation. Keep component entries when selection works; create phrase entries only for demonstrated exceptions. A modifier-derived sense cannot silently become the unmodified default. |
| Related same-word forms | Spellings, conjugations, noun gender/number, or other inflections belong to one lemma. | Confirm identity and corpus uses → include searchable forms → test sense/grammar applicability by form. Complete with a shared entry or linked form entries where different targets are genuinely required. |
| Prefixed/suffixed related word | A corpus word derives from the research term, whether its parts are joined, hyphenated, or spaced. | Verify derivation and variants → propose a related study → resolve the derived meaning and test whole-word translation. Complete as a separately justified lexical entry or a tested compositional treatment; spelling containment alone cannot merge it with the bare lemma. |
| Under-selected sense | Correct target wording is available but the translating AI chooses another variant in independently labelled contexts. | Diagnose consumer behavior → test bounded revisions to notes/order → measure both error directions on all senses → confirm the selected version. Complete with corrected selection or a visible unresolved failure, never a frequency-based declaration of success. |
| Construction-specific selection failure | A verified sense's target is needed only in particular constructions and fails to be selected there from the general entry. | Demonstrate the failure with component entries → test a phrase entry → check other uses of the parent term → move the construction-specific rule only if the phrase entry fixes selection without losing coverage. Rarity alone cannot activate this method. |
| Constructed word | A source or target compound/calque requires readers to recover meaning from parts. | Identify each part's contribution → verify usage of those contributions → measure questionable senses → test the whole in sentences. Complete with a decodable rendering or a plain phrase that preserves the same meaning. |
| Borrowed technical designation | Source citations, aligned originals, distinctive definitions, or quotations indicate borrowing. | Locate the relevant work and edition → verify designation and meaning → separate the author's adaptations and ordinary uses → apply the established-wording policy. Complete with checkable provenance and a rule for exactly which meaning uses that designation. |
| Historical/etymological question | Historical development is needed to distinguish meanings, assess a coinage, or explain the author's use. | State the historical question → locate dated evidence → separate historical derivation from present-day meaning. Complete when that question is answered or explicitly unresolved. Decomposition alone is not etymology; absence alone is not proof of invention. |
| False-friend/familiarity risk | A cognate, unfamiliar technical sense, compound base, or score-setting word may mislead a general reader. | Define the needed sense → reuse or obtain general-usage sense evidence → compare with the corresponding source sense and applicable exceptions. Complete with pass/fail/unknown for this candidate in this sense. |
| Lexical contrast/collision | Another source concept uses the same target, or passages explicitly distinguish related concepts. | Read contrast/equivalence evidence → test target wording in those contexts → keep sharing or repair the affected scope. Complete when no evidenced source distinction is erased. |
| Canonical spelling | A source name has competing spellings and unusually strong original-edition proof. | Verify source identity and spelling → retain observed source forms → propose canonical target form. The narrow numeric-unit shortcut requires the existing unique-match, numeric/unit, and original-edition checks; similarity alone cannot activate it. |
| Unresolved or sparse evidence | No hits, few hits, conflicting evidence, or an uncovered construction. | Read all available sparse uses; obtain specific missing context or a spelling choice; investigate the unresolved question. Complete with supported findings or a visible limitation, without inventing prevalence or silently expanding scope. |

Etymology, phrase research, and component analysis are therefore separate tasks. Detecting one does not automatically require the other two.

## Required test: does the entry cause correct variant selection?

This is a task in each research run, separate from the later benchmark of whether HTN replaces the full procedure safely. Candidate validity asks whether a wording could translate the sense. Selection validation asks whether the delivered entry actually makes the translating AI use it where required. Preference counting and repeated agreement cannot substitute for selection validation.

1. **Define expected source meanings before examining trial translations.** Establish an occurrence-level source-sense inventory from source passages, dictionary/provenance evidence, and any applicable human terminology criteria. Record acceptable target renderings or required terminology, including genuine ambiguous cases. Two independent source-only judgments are the baseline; disagreements need evidence-based adjudication or an ambiguous status. Agreement alone is not truth. Human-required term choice and semantic adequacy remain separate criteria: "world" can convey a planet while still failing an applicable requirement to choose "planet".
2. **Build a sample from search results covering each attested sense.** Sample within sense/construction groups after deduplication; include rare senses, forms that change applicability, idioms, and contrasts likely to expose over-application. A large common sense must not crowd out a minority sense. Use all available contexts for sparse groups and disclose uncertainty; a sense with no suitable passage is untested, not passed. Keep a separate uniform sample for prevalence/counting and regression checks. Diagnostic oversampling never enters unweighted population estimates.
3. **Reserve confirmation passages before tuning.** Split available source locations into development and confirmation sets. Freeze source labels and acceptance criteria independently of the proposed entry. Sparse overlap and unavailable holdouts are disclosed; repeated testing on tuning passages is not fresh confirmation.
4. **Translate through the intended consumer.** Use its actual model, translation instructions, surrounding glossary, entry ordering, matching rules, and serialized notes. The translator receives the source and the glossary guidance it would normally see, not the test labels, expected answer, an evaluator explanation, or a special instruction to choose from numbered options. Grade the final translated wording, recognizing inflection, reordering, implicit expression rendering, and legitimate synonyms. Version the complete test setup as well as the entry; repeat target-language validation independently for English, Vietnamese, or another target.
5. **Score every sense and both directions of confusion.** Report required variant selected, acceptable alternative, wrong sense, project-term failure, ambiguity, failure, and not-run with reconciled denominators. Record substitutions such as planet-sense → world and world-sense → planet separately; retain naturalness and meaning errors separately. Ambiguous cases stay visible outside the decisive error denominator and must not be relabelled merely because a candidate failed. A high overall score cannot conceal a failed minority sense.
6. **Replan only when a failure is found.** Identify whether it comes from a missing/incorrect meaning, matching or form coverage, overlapping notes, candidate order, a persistent learned preference, or phrase scope. If the meaning is wrong, return to meaning research. If the meaning is right but selection fails, test a small bounded set of entry treatments: sharpen a condition, change order, add an explicit priority rule, or investigate a phrase entry under the gate below. Do not automatically force every entry to test four versions. Escalate to human review if the available test cannot distinguish them.
7. **Select and reconfirm a treatment without hiding regressions.** Prefer a treatment meeting the frozen semantic, terminology, and per-sense requirements; an aggregate reduction is insufficient if it creates a material failure in another sense. Re-test all affected senses, especially the reverse error direction and idioms. Confirm the final reviewed/serialized entry on reserved passages. Preserve initial failures, repairs, costs, and any remaining errors in the report.

For *mundo*, the planet/world results activate the under-selected-sense method. A "planet first" ordering and explicit priority note are candidate treatments, not a universal defaulting rule. Their boundary tests include nonplanet worlds, planes, idioms, ambiguous Earth/place uses, and lists whose members do not all fit "planet". Successful English treatment is not an automatic Vietnamese pass. Existing translations reveal a selection habit, not the correct source-sense label.

## Related forms, derived words, and phrase-entry decisions

Maintain a relationship inventory with four practical categories:

| Relationship | Example | Research and entry decision |
|---|---|---|
| Same lemma, different surface form | spelling variants; verb conjugations; gender and number; sensible/sensibles | Search all confirmed forms and test applicability. Share an entry only where its target choices and conditions serve the forms. |
| Multi-word combination | mundos suprasensibles | Test full passages with mundo/mundos and suprasensible/suprasensibles entries, with no phrase entry. Keep this arrangement if the intended meaning and wording are selected correctly. |
| Derived lexical word | sensible → suprasensible/suprasensibles; suffix-derived relatives | Propose research of the derivative and its own forms, using the parent's evidence where applicable. Test the whole derived word's meaning; do not let the bare sensible match count its occurrences as ordinary sensible uses. Hyphenation or spacing does not decide lexical identity. |
| Sense restricted to a construction | centro sensible; cerebro sensible, where a verified sense calls for a distinct target such as sensory | Test whether the general sensible entry selects the required target in those contexts. Consider separate phrase entries only after a demonstrated selection failure. |

Related studies share a dependency record: what belongs to the current lemma, what is a separate proposed study, and which component study is needed before a phrase can be tested fairly. Present derived-word follow-ups for selection; research selected dependencies rather than recursively researching every family member. If a required component has not been researched, a failed phrase translation is inconclusive evidence for a phrase entry. Search and validation must distinguish derived words even where whitespace or punctuation makes their boundaries ambiguous. Record correct/incorrect source spellings and attested inflections explicitly, including named-term plurals such as *hasnamussen* when verified.

For *mundos suprasensibles*, the first test contains both component entries and omits the phrase entry. If it translates correctly, record that composition passed and do not create the extra entry. If it fails, investigate whether the component meanings, selection notes, or whole-expression interpretation are responsible before testing a phrase candidate. The eventual phrase entry must pass the same consumer and source-meaning checks as an ordinary entry.

**Gate for moving a low-usage sense into a phrase entry:** all of the following must hold:

1. Source evidence establishes the construction's intended meaning and appropriate target; minority usage or compound appearance alone is insufficient.
2. That correct target is available in the general/component entry, but the actual translating AI fails to select it in applicable test contexts. This must be a selection failure, not a missing candidate, missing component entry, false source label, or matching bug.
3. A proposed phrase entry corrects the demonstrated failure in a controlled comparison on the same contexts, then on reserved examples where available. Notes/order repair is an alternative to compare when reasonable, not a compulsory long sequence of extra calls.
4. The construction-specific translation is not needed in verified standalone or other uses left without coverage. Preserve any remaining general applicability and test it separately; absence from a small sample is not proof of absence.
5. The phrase entry covers its verified surface forms, and the actual consumer selects it correctly when it overlaps the component entries. Re-test the broader parent uses for over-application or other regressions.

If these conditions hold, the planner can move the construction-specific target and its selection rule into the phrase entry and simplify the parent entry. Keep the underlying meaning and decision history in the research record. If component selection already works, retain the shared treatment regardless of the sense's low frequency. If evidence is insufficient, keep the split proposed or unresolved rather than adopting it automatically.

The supplied "sensory" examples illustrate the decision mechanism, not a ruling that every *centro/cerebro sensible* passage has that target. The earlier audit identifies a borrowed Gurdjieff usage with "feeling" wording. Source-meaning/provenance work must distinguish those contexts before selection is graded; a sensory construction and a borrowed feeling designation cannot silently share one expected answer.

## Shared evidence and preservation

The research record contains stable identities for forms, senses, constructions, candidates, and source passages. Every sense records its definition, grammar, attestation, contrasts, and unresolved questions. Every candidate records the senses/forms it serves, selection conditions, evidence, checks, and disposition. Verified originals and reader explanations have their own provenance. Related forms/words carry explicit relationship types and study status. Source labels, required wording, development/confirmation sample roles, consumer settings, observed substitutions, and phrase-promotion evidence are preserved separately from preference votes.

A useful scope rule is operational: for example, a specialized noun applies only to that named concept; an ordinary adjective retains its ordinary use. A category rendering applies only when the source's relevant members fit that category. A phrase rendering applies to the whole expression and may convey a component implicitly.

The main data-flow risks observed during inspection support this requirement:

- The full engine's `freeze` retains wording, notes, grammar, and originals, but omits structured `senses` and `corpusSense`. Notes may communicate some of this; the omission is a loss of structure, not proof that every translation is wrong.
- The parts prompt allows at most six senses and merges close ones. The preservation audit documents a coarse *fatal* branch combining inevitability, fate, and compulsion. A bounded summary must not set the semantic inventory's maximum resolution.
- Rarity pruning and consistency narrowing can remove a candidate or change its scope. Those decisions need to reach the saved translator guidance, rather than only appearing in the report.

Each obligation ends as satisfied, failed, unknown, or inapplicable with a reason. Budget exhaustion and low evidence cannot convert unknown to satisfied. An evidence-supported rare sense remains available even when the random count sample misses it. A rejected candidate has a sense-specific reason; failure in one sense is not a global word ban.

## Replanning and stopping

Examples of replanning:

- An apparently ordinary sense has a verified original designation: add the borrowed-designation method for that sense, retaining ordinary branches.
- A target compound has a part whose common sense differs: add the component/familiarity investigation for that candidate.
- Open reading discovers a missing idiom: add a phrase task and revalidate the affected entry boundaries.
- Source-labelled planet contexts still produce "world": activate selection repair, test order/priority treatments, and check the reverse direction and nonplanet meanings.
- A construction-specific target is present but unused in its applicable passages: activate the phrase-promotion gate and compare component-only treatment with a phrase entry.
- A derived word is found: propose a related study and confirm its own forms rather than adding its hits to the bare lemma's denominator.
- Two judges disagree because notes overlap: investigate the competing meanings and repair their conditions; do not rerun unrelated dictionary or source-book work.
- An edited proposal changes applicability: invalidate judgments that rely on it. Reuse a judgment only if its full decision packet is unchanged; a changed competing candidate can alter the choice even when the selected wording stays the same.

Investigate one named unresolved question at a time, recording the evidence or decision it should produce. A retry without new evidence or a new diagnostic question is not progress. Bound additional searches/repetitions and present remaining conflicts for review.

A study is ready for delivery when every relevant supported meaning has an applicable rendering or a visible unresolved status; confirmed forms/expressions are assigned; required checks are satisfied or explicitly unknown; the user has reviewed the proposal; actual-consumer selection results are reported per sense with remaining failures visible; requested counting is complete or its incomplete status is disclosed; and meanings, restrictions, originals, and explanations survive into the actual translator input. An entry can be presented for review with unresolved tests, but it cannot be labelled validated while an attested sense or required compound treatment is untested or failing. User edits that change selection conditions, ordering, phrase scope, or available candidates require revalidation of affected decisions.

## Where efficiency should come from

1. Reuse exact dictionary evidence, source passages, and validated language/word/sense measurements. Match the evidence version, lexical forms, sense definition, and method, not just the spelling.
2. Classify one general-corpus sample against several needed senses where the categories allow it, instead of rereading identical sentences separately for each candidate. Cross-language comparison remains sense-specific.
3. Screen cheaply, then trace origins, decompose parts, and investigate collisions only where their obligations arise. Screening includes dictionary labels, available provenance records, construction diversity, and independent reading; model confidence alone cannot bypass a safeguard.
4. Keep separate sense-establishment and candidate-judgment tasks, while sharing evidence. Combining calls must not introduce target framing into source meaning discovery.
5. Reuse contextual translations to diagnose contested choices. Investigate unstable boundaries rather than repeatedly translating every apparently settled context. Selective checking includes random apparently safe cases to detect missed routing.
6. Generate counts, continuity checks, reports, and version checks mechanically. Generate explanatory prose only where someone needs it.
7. Share lexical/provenance work across target languages and family studies; keep target comprehension, grammatical grouping, and candidate judgments language-specific.
8. Use the per-sense selection sample also to inspect phrase composition and form applicability where it covers those obligations. Add only missing cases, keep sample roles explicit, and retain a reserved confirmation set. Activate alternative order/notes and phrase-entry comparisons only after measured failure rather than for every word.

The engine already has batching, checkpoints, and some prior-measurement reuse. The improvement is to make reuse and conditional decomposition cover the whole obligation graph, not to claim these mechanisms are new. No latency or token saving is measured by this design.

## Policy changes and validation before implementation

The existing full route remains the comparison baseline. Hans's amendment adds per-sense actual-consumer selection validation and a measured-failure gate for construction-specific entries as requirements of this design. Conditional second judges, reduced consistency repetitions, optional preference counting, and changes to the 2% pruning/12-word-note rules remain explicit experimental changes. The design retains full counting and two judges where the selected research mode requires them. A future proposal-only mode would show no preference counts and would require a separate product decision; it could not claim validation without the required translation-selection tests.

Validate replacement methods against the exact safeguard they replace, including deliberately injected errors and acceptable alternatives. Use the existing historical failures, then unseen cases with the same mechanisms. Include:

- *sensible/suprasensible*: actual sense and target-part comprehension, not whole-word familiarity; correct discovery and separation of joined, spaced, and hyphenated derivatives.
- *Íntimo*: verified English designation, ordinary adjective and friendship uses, and name versus definition.
- *fatal*: distinct meanings, minority branches, and collocations.
- *vanidad/vanidades*: motivating meaning and form-specific applicability.
- *mundo/mundos*: per-sense selection and both directions of planet/world confusion; order and explicit-priority treatments; modifier scope, category membership including the Sun, and idiomatic phrases; validate English and Vietnamese independently.
- *mundos suprasensibles*: component-only versus phrase-entry consumer tests, with both component entries researched and correctly matched.
- *centro/cerebro sensible*: verify the contextual sense, demonstrate whether its correct target is under-selected, and admit a phrase split only when the failure gate passes. Include a control where component selection already works and no split should occur.
- *Hooltampanas/Hooltanpanas*: canonical provenance plus negative ambiguous-match controls.
- *hasnamuss/hasnamussen*: verified origin, source spelling variants, and plural recognition.
- Related-word contrasts, rare reader notes, zero hits, sparse hits, unavailable dictionaries/frequency data, and edits invalidating judgments.

Measure downstream translation corrections, remaining errors, new errors, terminology compliance, canonical spelling, and naturalness separately against identical no-glossary drafts. Keep targeted diagnostic passages separate from independent random population samples. Check the entry and actual consumer for completeness; intermediate research accuracy alone is insufficient. Include all failed attempts in cost/time and distinguish provisional AI judgments from human validation.

Adoption requires preserved safeguards and demonstrated useful downstream results before accepting efficiency savings. This document specifies that future validation; none was run for this design.
