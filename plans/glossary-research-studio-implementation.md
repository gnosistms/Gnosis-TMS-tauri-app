# Glossary research studio implementation plan

Status: implemented in the current working tree, 2026-10-15; verification and delivery notes below. The Desktop document and resolved decisions remain the specification.

Implement the human-guided process in [Hans's Desktop plan](</Users/hans/Desktop/Glossary research plan>), steps 1–12, including the added step 4.7. This replaces the previous automated glossary research design. The new Research entry point will open this studio. Preserve the old implementation, experimental runs, and notes as reference material; they are not the specification for this workflow.

The researcher advances through an editable study, approves forms, meanings, and candidates, and tests a draft before opening the existing New Term editor. Back navigation reuses completed work whenever its inputs are unchanged. Research remains saved locally even when the researcher cancels the term editor.

## Scope and preservation

- Implement every step and sub-step above the Desktop plan's deferral line, including optional dictionary, decomposition, provenance, and compound branches.
- Include the new step 12 above the deferral line: process entries split off in 4.7. The older, separately numbered step 12 below the line remains deferred, along with word-family studies, apply-and-sweep, and the other operations below that line. The broader operation inventory from the preceding discussion does not expand this scope.
- Use the glossary editor's Research button for new studies and resuming saved studies. A chapter-editor shortcut is deferred because it is absent from this specification.
- Keep the previous [app requirements](glossary-research-plan.md), HTN designs, experiments under `scripts/glossary-research-lab/`, and old research code intact. Add a concise superseded-status note with a link to this plan when implementation begins; retain their substantive contents and results.
- The previous production experiment is in `/Users/hans/Desktop/AI-Projects/GnosisTMS-research`. Do not delete or reset that checkout, cherry-pick its complete research engine, or import its pipeline as the studio controller. Extract individual helpers only after tests establish that their behavior fits this specification, retaining attribution to their source.
- Use distinct `glossary-research-studio-*` frontend modules, a `glossary_research_studio/` backend module, and a separate versioned study directory. Old runs remain readable through their existing code and exports; automatic conversion of old runs is deferred.
- Research is specific to translation glossaries. Retain the deliberate QA-list exception documented in the original requirements. Any changes to shared glossary/QA resource infrastructure must preserve both consumers.

## Existing integration points

These findings concern the current `GnosisTMS` checkout; the older research checkout is a reference source, not an already-integrated dependency.

| Existing code | Use in the new implementation |
|---|---|
| `src-ui/screens/glossary-editor.js` | Add Research beside New Term, using the glossary-write capability. |
| `src-ui/main.js`, `app/navigation.js`, `app/action-dispatcher.js` | Register the studio screen, navigation lifecycle, and action handlers. |
| `app/query-client.js`, `app/glossary-editor-query.js` | Follow the existing query boundary for loaded data and glossary refreshes. |
| `app/permissions.js`, `app/resource-write-policy.js` | Reuse `canWriteGlossaries` and the existing save policy; do not add permission booleans. |
| `app/ai-action-config.js`, `app/ai-settings-flow.js` | Add a Research AI action; current action IDs cover Translate, Review, and Discuss. |
| `src-tauri/src/ai/mod.rs` | Reuse translation prompt builders, glossary-hint formatting, and preference rules for studio translation tests. |
| `src-tauri/src/ai/types.rs`, `ai/providers/` | Reuse provider credentials and structured output support. `AiPromptResponse` currently contains text only; add usage data if needed for research accounting. |
| `app/editor-ai-batch-request.js` | Existing translation batches default to 15 rows. Reuse applicable contracts without making studio research write chapter translations. |
| `app/glossary-term-draft.js`, `screens/glossary-term-editor-modal.js` | Open and prefill the normal New Term flow; preserve duplicate feedback, queued writes, rollback, and error recovery. |
| `src-tauri/src/project_search/` | Add research queries over selected projects. Ordinary project search has a 500-row cap and ranking; do not sample from that capped result list. |
| `src-tauri/src/project_import/chapter_editor/pdf_export.rs` | Follow its job-ID, cancellation, and progress-event pattern for long operations. |
| `/Users/hans/Desktop/AI-Projects/GlossaryGen/serve_search.py` | Coordinate public-corpus form search, exact populations, sampling, sources, original-language evidence, and bibliographical metadata. Local routes exist; deployed capabilities must be checked separately. |

## Navigation and execution model

Represent steps and nested branches as an explicit workflow with persisted transitions. Each step has a label, required/optional status, parent, dependencies, input signature, output revision, and review status. Separate unfinished edits from the last approved revision.

Persist statuses such as `not-started`, `running`, `awaiting-review`, `complete`, `skipped`, `stale`, `failed`, and `cancelled`. Returning to a complete step displays its saved result. Clicking forward with unchanged approved inputs makes no new AI or search requests.

Each step has Back; the first step returns to the saved-study list. Back during execution cancels or detaches that job before another execution can replace it. Events and completions carry installation, glossary, study, step, attempt, and input-signature identities; obsolete results cannot overwrite a newer revision or another team's screen. A detached job may retain its result only under its original signature.

### Skip behavior

- Direct skips: step 2a, 4.1, 4.3, 4.4, 4.4.1, 4.4.2, and step 5. Step 4.4.1 is available only for the Samael Aun Weor corpus. Required step 2b still runs when 2a is skipped.
- Skipping step 2a restores the forms explicitly entered in scope. Skipping optional evidence removes its contribution from the approved meaning inventory and invalidates dependent work; retained historical files cannot silently contribute.
- Once an optional parent is started, its unmarked child tasks must finish. A Skip request on such a child shows the specified modal: **Skip this step?** / “If you skip [sub-step] then the [parent] part of the research process also needs to be skipped.” / **Don't skip** and **Skip it**. Confirming skips the optional parent and discards its active contribution, retaining an audit history.
- For example, skipping a mandatory part lookup inside 4.3 skips decomposition; skipping 4.4.4 skips provenance. Skipping both 4.4.1 and 4.4.2 automatically skips 4.4 and never runs 4.4.4.
- A required top-level step has no bypass that permits progress with incomplete data. If Skip is offered inside a required branch with no optional ancestor, explain that it cancels the study. Keep its saved work available for resumption.
- Record automatically inapplicable tasks separately from user skips, such as original-language lookup for an ordinary source-language word or decomposition of a noncompound.

### Reuse and invalidation

Compute signatures from actual approved inputs: scope, corpus snapshot, forms, sample IDs/text, active evidence, meaning revisions, assignments, spelling decisions, candidate identities, notes/order, model settings, and prompt/schema versions. Include only the inputs a particular operation consumes.

| Change | Work to invalidate |
|---|---|
| Corpus, research term, source/target language | All dependent acquisition, interpretation, and tests. |
| Approved forms | Exact population, samples, form-dependent evidence, and downstream results. |
| Dictionary/provenance/decomposition decision | Meaning consolidation and downstream work consuming that evidence. |
| Meaning definition or enabled state | Affected assignments, candidates, and tests; retain raw passages and citations. |
| Sample or paragraph removal | Assignments, compound evidence, tests, and counts for affected items. |
| Candidate text or spelling | Candidate tests, selection tests, counts, and draft compilation. |
| Usage note, candidate order, or candidate removal | Every step-9 batch that received the changed entry, including previously passing batches. |
| Research model or prompt version | AI results that depend on that configuration; raw acquisition remains reusable. |

Persist the seed and a corpus revision or captured population fingerprint. Opening an old study uses its captured evidence; refreshing to a newer corpus is an explicit input change. Reuse exact requests at sub-step level so redoing one meaning does not redo unrelated lookups.

## Data and storage

Rust owns persistence, filesystem access, corpus requests, dictionary/web retrieval, and AI execution. Store studies under `<installation-data>/research-studio/<glossary-id>/<study-id>/`, outside glossary git repositories. Use schema versions, atomic checkpoint replacement, serialized study writes, and recoverable interrupted-job records.

Persist these records with stable IDs:

- Study identity, glossary/repository identity, languages, corpus selection, seed, model configuration, current location, and approvals/skips.
- Forms with origin, evidence, exact counts, AI identity decision, selected state, and user override.
- Existing-entry relationships from step 2b, entry IDs/revisions and summaries, chosen research/merge branch, source-variant destination assignments, merge write intents and confirmed outcomes, and collision decisions from step 10b.
- Passages with source text, all references/copies, matched forms, occurrence offsets, context, source revision, and display translations.
- Evidence with exact quotation, URL/book/page or passage reference, language, retrieval status, inferred versus explicit definition, and publication-date range.
- Meanings with target-language definition, evidence IDs, enabled/unused state, and optional verified original-language term.
- One meaning assignment per occurrence, identified by paragraph ID and source span, with unmatched-case decisions, expanded-search provenance, and compound findings. Preserve the whole paragraph as translation context; one paragraph may support several meanings.
- Split-entry queue with parent study, source expressions, originating meaning, routed examples, provisional glossary entry, processing position, child-study identity, and independent save/cancel outcome. Preserve links to the original evidence when removing a meaning or examples from the active parent pipeline.
- Candidates with stable identity, applicable meaning IDs, spelling decisions, confirmation state, target-language usage notes, and global display order. Related inflections can share a candidate-addition group ID while retaining individual target forms, identities, usage counts, and retention decisions. Identical target text can retain several meaning-specific applications.
- Test attempts with input revision, batch membership, prompts, paragraph translations, selected/rendered candidates, assessments, proposed repairs, and user decisions. Persist step-8 cumulative round counts, five-round progress reports, and Stop/Continue decisions. Counts of translation uses point to final completed attempts, never accumulated retries.
- Final editor draft, return location, save-intent identity, and saved term ID when known.

Use TanStack Query for persisted study/history reads and backend snapshots. Keep transient input/focus state local to the studio session. Publish glossary changes through existing glossary query/write-intent paths. Do not create another resource cache or mutation queue.

Check request size against provider limits before execution. Where the specification requires one combined prompt, retain all required evidence in that prompt; if it will not fit, ask the researcher to narrow forms/scope or choose a capable configured model. Do not silently truncate witnesses or substitute a summary for the required combined evidence.

## Corpus and evidence services

Define adapters with equivalent contracts for project corpora and the public Samael corpus: fuzzy form discovery, ranked exact examples, complete exact matching population, seeded sampling, passage/context retrieval, and supported provenance capabilities.

“Elastic-style” means approximate spelling/form retrieval; it does not mandate Elasticsearch. Reuse the current search service's capabilities where they meet the contract. Candidate retrieval and semantic identity verification are separate from exact research counting. Exact matching preserves accents and full lexical units, uses shared glossary matching semantics where applicable, and handles code-point versus JavaScript UTF-16 offsets.

The GlossaryGen source already advertises `/api/search/forms`, `/api/sample`, `/api/sample/forms`, `/api/sample/source-books`, `/api/sample/original-terms`, `/api/sample/near-forms`, and original-language search routes. Verify their payloads, pagination, coverage, and deployed availability before selecting them. Add missing guarantees instead of inferring them from route names. Support the representative-per-form sample locally from a complete population or add an explicit service contract; an existing uniform sampler alone does not implement step 3.

For projects, query selected repositories and source-language rows directly through a dedicated research backend path, with context and references. Exclude chapters lacking the source language. Keep corpus-unavailable distinct from a successful search returning zero results.

Dictionary lookup must distinguish found, no entry, unreachable, and skipped. Preserve source quotations while writing definitions in the glossary target language. Original-language evidence remains in its original language alongside the translated definition. Adapt a legitimate DLE browser reader from the old work if suitable; never treat a blocked retrieval as dictionary absence. Web acquisition needs a backend search/retrieval adapter with cited results, using supported configured providers or a search service; the desktop coding agent's search tools are not an application dependency.

### Bibliographical metadata dependency

Implement the search-tool change in the GlossaryGen repository as a coordinated deliverable. Build author-level metadata when adding or updating a fuente book or author, including author/name variants, book-title variants, AI-verified genuine mentions in Samael's works, counts with supporting references, source publication ranges, and Spanish-translation dates. Version the search rules and verification inputs so changed books or aliases invalidate affected metadata.

Step 4.4.1 retrieves this reusable evidence and counts term occurrences across each author's works. It must not recompute author recognition for every term. Rank potential authors using genuine mentions, term counts, and chronology; retain the evidence behind the AI's proposed source attribution. Sample up to 50 matching passages across the selected author's works, not 50 from a single top-ranked book.

Represent dates as ranges and record uncertainty. Apply the requested eligibility rule: earliest estimated source publication must precede the latest estimated date of the corpus work using the term. For Samael, exclude proposed sources with no Spanish translation or whose first Spanish translation was after 1977. Unknown translation history remains unresolved evidence, not proof that an eligible translation existed.

## Step implementation

### Step 1 Scope

Collect the research term, user-entered forms/spellings, glossary language pair, and research corpus. Use the established Samael-versus-selected-projects choices, with Samael available for Spanish source research. Validate selected projects and source-language availability. Persist scope before any request. If a choice cannot support optional provenance features, show the relevant branch as unavailable with its reason.

### Step 2a Find forms and spellings

Ask AI for inflections and likely borrowing origin. When an origin language is identified, retrieve original spelling and standard phonetic renderings in source and target languages with evidence. Run fuzzy corpus search for the proposed forms, collect the top three results per proposed form, and include spellings discovered in those results.

Use one structured identity-verification prompt for all forms and spellings, with per-form witnesses. Validate that every proposed form receives a decision. Rejected look-alikes leave the active list; keep their disposition in history. Display checkboxes, found/not-found information, editable additions, and overrides. Forms not found are unchecked by default. Save the approved list on Save and continue; skipping uses only scope forms. A manually added form receives an exact count without forcing another AI verification cycle.

### Step 2b Merge with existing glossary terms

Required: search the current glossary for entries likely to contain alternative spellings or inflections of the research term or its approved source forms. Show each related entry with an expandable summary of the full entry. Retain the distinction between likely lexical relationships here and duplicate source variants handled in 10b.

Support the three specified branches:

- Research separately: retain the related-entry/collision list for later resolution and proceed to step 3.
- Re-research existing terms: add their source variants to the source-variant list established in step 1, retaining the user's original forms and removing duplicate strings, then repeat 2a. Carry their target variants forward into the step-6 candidate list. Preserve entry identities, original contents, and provenance linking each carried variant to its existing entry. These are research inputs, not automatic confirmed winners. Save through the same new researched draft, step-10b collision choices, and step-11 save process used for separate research; do not introduce a separate update-each-original-entry workflow.
- Merge source variants only: display the approved scope/2a forms and a destination dropdown for each, labeling each existing entry with its comma-separated source variants. Save the assigned additions into those existing entries, then finish the study without entering step 3. Preserve the entries' target translations, notes, and other existing contents. Use normal permission checks, duplicate validation, and coordinated term writes; retain per-entry outcomes for recovery if a write fails. Mark the study finished only after all selected additions are confirmed saved.

Persist the branch choice against the forms and related-entry revisions so Back navigation does not perform duplicate saves or create an endless unchanged 2a/2b cycle. Recheck newly discovered relationships when relevant inputs change.

### Step 3 Take the research sample

Find the full exact population for all approved forms, deduplicate identical paragraphs, and retain every copy's reference. Select one matching result for each form that occurs, allowing one paragraph to cover several forms. Fill remaining slots with a seeded random sample from remaining distinct results, to at most 100 paragraphs. Do not use fuzzy hits or the ranked top results as the random population.

Record unmatched selected forms and actual sample size. This is a sample with guaranteed form coverage, not a uniform sample of the whole population. If no exact results exist, return an actionable edit-scope/forms state. If covering all found forms requires more than 100 distinct paragraphs, require a scope/form reduction rather than silently violating either requirement.

### Step 4 List and assign meanings

All generated definitions in this section are in the glossary target language.

| Sub-step | Implementation |
|---|---|
| 4.1 Dictionary evidence | Optional cited source-language lookup retaining senses, grammar, complex forms, synonyms/antonyms, and retrieval status. Include original-language spelling and dictionary lookup when a likely origin language is known. |
| 4.2 Corpus inference | Required: gather the top 15 exact results for each approved form and send the complete combined evidence for one meaning-inference task. Deduplicate repeated paragraphs while preserving form associations. Keep this evidence separate from the step-3 test sample. |
| 4.3 Decomposition | Optional: AI proposes parts and meanings; look every relevant part up in a dictionary and the team's glossary; AI summarizes the evidence. All unmarked child tasks are required once started. A noncompound yields a completed not-applicable finding. |
| 4.4.1 Fuentes | Optional, Samael only: query variants in bibliographical sources, assess author-level evidence and chronology, verify originals, and obtain an explicit or inferred definition from up to 50 randomly sampled author passages. |
| 4.4.2 Internet sources | Optional: search possible sources, apply date and Spanish-translation eligibility rules, retrieve explicit definitions or infer from context, and verify original-language terminology. |
| 4.4.4 Source summary | Required when either provenance branch ran: summarize findings and contribute definitions with source references. Both branches skipped means no summary call. |
| 4.5 Meaning inventory | Consolidate contributions without losing their citations. Show editable definitions, Use this definition checkboxes, Add meaning, and Save and continue. It is always required in this workflow because 4.2 is required. |
| 4.6 Meaning assignment | Assign each research-term occurrence to at most one approved meaning, validate complete occurrence accounting, resolve unmatched cases, and show the final usage-example report with whole-paragraph context. |

For unmatched occurrences in 4.6, use the specified modal with source and target paragraph text, the occurrence highlighted, and three actions: drop the paragraph, assign an existing meaning, or add a meaning. The existing-meaning choice starts with Select a definition and disables Continue until selected. Add meaning opens an editable AI recommendation; confirming adds it and assigns the occurrence. Dropping a paragraph removes all its occurrences from the working set. Dropping the only remaining paragraph shows **Cancel the research** with the specified explanation and OK button, then records cancellation while retaining saved work.

For meanings with no assigned passage, scan a shared pool of up to 500 additional distinct exact-match paragraphs, excluding paragraphs already considered, in batches of 50 without replacement. Check each batch against all still-missing meanings and stop searching for each meaning as soon as an example is found. Stop the scan when all missing meanings have an example, the population is exhausted, or the shared 500-paragraph limit is reached. Add recovered examples to the working set and record their origin, even when the total exceeds 100. Include all retained added examples in subsequent tests and display the actual tested total. Exhausted/limit-reached searches without a match mark the meaning unused and exclude it from the remaining workflow. Failed requests do not establish unused status.

Display every meaning and Show usage examples, with source/target paragraphs and references. This final report has Save and continue and no editing controls; Back returns to the relevant editing step. Retain unused meanings and their evidence in the research report with the label No corpus example found. Exclude them from splitting, compound analysis, candidate generation, spelling work, translation tests, and the glossary draft. A change to the study's inputs can trigger renewed example recovery through the normal Back/reuse rules.

### Step 4.7 Split meanings into separate entries

Required: ask AI to inspect examples for each active meaning with corpus evidence and identify surrounding-word patterns that allow more precise glossary matching. If none help, continue unchanged. When splitting helps, create provisional entries in a temporary glossary and a persisted queue for later research. A single meaning may produce several entries, such as `el Ser`, `del Ser`, `al Ser`, and `nuestro Ser`.

If every occurrence of a meaning is covered, remove that meaning from the active original-term pipeline and route its occurrences to queued entries. If coverage is partial, move covered occurrences while retaining the meaning and remaining occurrences for the original term. Preserve whole-paragraph context in each affected study: moving one occurrence must not remove another occurrence in that paragraph from the original study or a different split entry. Keep original evidence and routing history recoverable for Back navigation. Do not save provisional split entries into the real glossary at this point.

Use Gnosis TMS's actual longest-first glossary matching during routing and translation tests, including temporary split entries in the matching context. A match on `el Ser` must take precedence over `Ser`; a string-containment approximation or test of only the unsplit term is insufficient. Record which entry owns each selected match. Changes to split decisions invalidate affected routing, tests, counts, and queued child work. If splitting leaves no active original-term meanings, skip its empty steps 5–11 and go directly to the step-12 queue prompt. Retain the original study as the parent research record; do not open or save an empty original-term entry.

### Step 5 Find compounds and phrases

Optional. For each meaning, examine its assigned examples. Accept a repeated compound/phrase appearing in at least two results, or a one-example construction whose special meaning is not understandable from its individual words. Display the requested introductory text, expandable evidence, and Save and continue. Persist findings for further consideration; this step does not launch separate phrase or word-family research.

### Step 6 Build translation candidates

For every active meaning with corpus examples, propose words or phrases from its definition, assigned passages, relevant originals, and saved compound findings. In the re-research branch, also add target variants from the participating existing entries to this candidate inventory, retaining their origin. Associate carried targets with the meanings they may render instead of forcing them into every meaning. Meanings without corpus examples remain report-only and do not receive candidates. Show candidates grouped by definition and allow additions/removals; do not silently discard a carried target before this review. Existing targets undergo the same subsequent spelling, confirmation, translation tests, and usage-based retention as other candidates. Use the Desktop instructions and Save and continue label; its prose reference to Approve and continue describes the same approval action. Approve candidate revisions before spelling work.

### Step 7 Standardize spelling

Screen all approved target candidates for spelling uncertainty. For uncertain names/borrowings, retrieve fuzzy corpus evidence and internet evidence, passing up to 20 corpus results plus web findings to AI. Classify likely origin as corpus sources, elsewhere, or corpus-original/unknown.

For corpus-source borrowings, inspect source spellings and original-language books when translations are involved. For other borrowings, establish target-language conventional spelling. For unknown/original terms, propose retaining source spelling or a target-language phonetic rendering. Store evidence and the spelling decision; retain source matching aliases independently of standardized target spelling. No uncertain candidates means completion without unnecessary lookups.

### Step 8 Test candidates within each meaning

Select one initial confirmed candidate per meaning. Test its assigned occurrences using only that meaning's confirmed translations and notes for those occurrences, while translating the whole paragraph as context. Other occurrences in that paragraph retain their own meanings and must not be forced into the meaning currently being tested. Assess the targeted occurrences and full translations for incorrect meaning, grammar, clumsiness, or unnatural wording.

One candidate addition may include several explicitly listed inflections of the same word, such as walk, walked, and walking. Add and test them together in one step-8 iteration; the group counts as one candidate addition and does not consume a separate repair round for each inflection. Each form remains an individual target variant with its own usage notes as needed, counts, and step-10 retention checkbox. This applies to the initial candidate and later additions. Do not collapse their usage counts into one aggregate or treat an unlisted form as explicitly confirmed merely because a related inflection was added.

If a candidate already on the approved list would fix a problem, add it to confirmed translations and update clear selection notes. If a new candidate is needed, add it temporarily, retranslate, and show the new result for the user to approve permanently or suggest a different temporary candidate. Retry all paragraphs for the affected meaning with the revised set, retaining attempts. Move on only when its current translations pass. Report-only meanings without examples do not enter this step.

Persist progress after each request and user decision. Step 8 has no fixed maximum number of repair rounds or confirmed translations. A repair round consists of revising the proposal and testing it again; the initial test is not a repair round. Track cumulative rounds for each meaning. Every five completed repair rounds (5, 10, 15, and so on), ask AI to report progress: candidates added or revised, test improvements, and remaining problems, grounded in saved attempts. Display the code-maintained round count with the report and ask the user to Stop or Continue before further rounds. Do not ask to continue repairs that have already passed; show their completion instead.

Continue authorizes the next group of up to five rounds, subject to any other candidate-approval decisions required by step 8. Stop pauses execution and preserves all findings and attempts so the user can resume later; it does not discard the study or mark failed tests passed. Provide Pause/cancel and Back throughout. Restart must preserve the cumulative count and any pending Stop/Continue decision, without repeating a completed report or silently continuing past it. This replaces the earlier five-round failure threshold for step 8; step 9 retains its separate three-unsuccessful-round pause.

### Step 9 Test selection across all meanings

Build the draft using the same glossary-hint serialization, preference rules, and translation prompt builders used by Gnosis TMS. Supply the entire candidate set and definition-derived applicability guidance that will actually be available in the saved entry. Do not supply the expected occurrence-to-meaning assignments to the translating model. Assessment receives those assignments separately.

Translate the current research paragraphs in batches of 15. Require exactly one complete output per input paragraph and assess every researched occurrence separately. Verify which explicitly confirmed target form was actually rendered for each occurrence, recording unresolved span mappings. Inflections introduced together in step 8 are individually identifiable variants for this check and for counts. Membership in that occurrence's assigned meaning's confirmed set is required; an AI claim to have selected a candidate does not substitute for its presence in the translation. Keep distinct paragraph totals separate from occurrence-level test results.

On failure, ask for changes only to usage notes or ordering, apply a new draft revision, and retranslate. A shared-entry edit invalidates earlier passing batches; recheck them before completing the step. Candidate/meaning defects that cannot be fixed with notes or ordering require Back to the relevant step. After three unsuccessful repair rounds for the same batch, pause automatic repair, show remaining failures, and let the user choose how to continue. Retain attempts and the pause state across restart; a rerender or reload must not silently restart the automatic repair allowance. User-directed retry starts another explicitly requested attempt sequence. Finish only when all current paragraphs pass with the same final draft revision.

### Step 10a Review unused translations

Count in code from the final successful step-9 attempt for each batch, never from step 8 or intermediate retries. All counted batches must reference the same final draft revision. For each translation show both the number of researched occurrences using it and the number of distinct paragraphs containing those uses, for example 3 occurrences across 1 paragraph. Count only uses corresponding to the current entry's researched occurrences, not unrelated appearances of the same target text. Show the actual tested occurrence and paragraph totals, including recovered examples. Use occurrence counts for retention defaults: check translations used at least once, and leave zero-use translations unchecked. Allow retaining zero-use candidates. Adapt the Desktop explanatory copy to these confirmed units and totals. Store the retention decision and final draft.

Apply these counts and defaults to each explicit inflection separately, even when several were added as one step-8 group. An unused walking is unchecked for removal without removing a used walk or walked; the user may still select walking to keep it. Commit the chosen removals on Save and continue.

Removing a candidate can affect step-9 ordering/selection, so revalidate affected tests against the retained draft through the existing step-9 machinery before presenting it as tested.

### Step 10b Handle collisions

Required: check the draft source variants against existing entries before step 11. Show colliding entries and give each colliding source variant its own choice: Overwrite stages removal of that source variant from its old entry and stages deletion of the old entry if no source variants would remain; Keep old, drop new removes that source variant from the draft. Provide an Apply to all shortcut for the displayed collisions, while allowing individual choices to be changed afterward. Mixed choices are valid even for source variants belonging to the same existing entry. Compute each affected old entry's final source list from all decisions together. Preserve original entry identities and revisions for conflict checks. Overwrite decisions are local study data until the user clicks Save in step 11. Cancelling leaves existing glossary entries unchanged and retains the staged decisions for later review/resumption.

### Step 11 Open New Term

Persist the draft, then open the existing New Term action with approved source forms, retained target candidates in preference order, usage notes, and applicable general notes/footnote fields. Carry a research-origin context containing study identity, draft revision, and return location. Add Back to research only for research-origin drafts.

The current opener accepts a term ID, and draft initialization is internal. Add a narrow prefill API rather than constructing a second editor or bypassing validation. Normal New Term remains unchanged. Both Cancel and Back to research persist current editor edits before leaving; reopening restores those edits. Changes to candidates or notes invalidate dependent tests. Saving uses the existing term-write coordinator and permission policy.

For a research draft with staged overwrites, step-11 Save applies the new entry and the corresponding old-entry variant removals/deletions as one recoverable logical change. Recheck affected entry revisions and duplicate constraints at save time. Do not first delete old content in a separate action that can remain committed if saving the new entry fails. Extend the existing coordinated write path for the affected entries rather than bypassing it. Cancel or returning to research performs no staged overwrite writes; confirmed merge-only saves from the distinct step-2b branch remain saved.

Re-research follows this same collision-and-save process even when several existing entries contributed inputs. The original-term workflow produces one researched draft; step 10b determines which colliding source variants move to it and which stay in their old entries. Old entries retain all remaining source variants and are deleted only when the saved overwrite leaves none. Entries split off in 4.7 are processed and saved separately through the queue.

Track the queued save outcome: opening the editor or enqueueing a write does not mean the term was saved. Record the resulting term ID after confirmed success so resuming does not create a duplicate. Preserve the editor's attempted draft on failure and retain study data after Save or Cancel. For a research-origin editor, return to the studio queue after Save or Cancel and follow step 12. Normal New Term navigation remains unchanged.

### Step 12 Research queued split entries

After Save or Cancel for the original term, if entries were queued in 4.7, show the specified modal explaining that meanings of the main term can be handled more precisely by the listed compounds and that their translations will now be researched. Also show this prompt directly after 4.7 when splitting leaves no active original-term meanings; skip the empty original-term steps 5–11 and retain the original study as the parent record. Provide Cancel and Continue. Cancelling pauses the saved queue; it does not delete the split entries or the parent study.

On Continue, process each queued entry starting at step 5 and continuing through step 11. Inherit its approved meaning and routed source evidence from 4.7 rather than repeating steps 1–4.7. Each child has its own candidates, spelling decisions, tests, counts, editor draft, and save outcome. Keep the shared temporary glossary available for longest-first matching and retain queue position across restart. Saving or cancelling one child advances to the next queued item; failed saves remain recoverable and are not recorded as successful. Do not start the deferred word-family workflow after the queue finishes.

## Implementation sequence

Deliver focused commits in this order. Milestones are implementation increments; the complete replacement includes all steps 1–12 above the deferral line.

| Milestone | Deliverable and completion condition |
|---|---|
| 1 Workflow contracts | Step definitions, dependency signatures, skip rules, schemas, and fixtures. Encode the confirmed behavioral decisions below and cover transitions before AI orchestration. |
| 2 Saved studio shell | Backend study storage/jobs, history query, Research entry point, screen/navigation, Back/Save and continue, progress, cancellation, and restart recovery with fake tools. No-change Back/Forward performs zero requests. |
| 3 Acquisition services | Corpus adapter contracts, complete project populations, public-service capability checks, dictionary/web adapters, and the coordinated author-metadata service change. Test Rust commands independently before frontend wiring. |
| 4 Forms and meanings | Steps 1–4.7, including required existing-entry handling in 2b, merge-only saves, every optional evidence branch, unmatched-paragraph decisions, bounded rare-meaning recovery, bilingual reports, and persisted split routing/queue. |
| 5 Candidates and spelling | Steps 5–7, editable candidate sets, compound report, verified spellings, and evidence retention. |
| 6 Translation tests | Steps 8–9 using production prompt builders; repair loops, user decisions, complete accounting, and rechecking after shared draft changes. |
| 7 Retention and term save | Steps 10a–12, reliable counts, retained-draft validation, collision handling in 10b, New Term prefill, Back to research, cancellation/resume, confirmed save linkage, and researching queued split entries. |
| 8 Replacement validation | End-to-end checks, real provider/corpus smoke tests, documentation, and routing the product Research entry point to the studio while preserving old code and records. |

Suggested new frontend boundaries: `glossary-research-studio-flow.js` for user intent/navigation; `-query.js` for loaded study/history snapshots; `-workflow.js` for pure transitions/dependencies; `-draft.js` for entry compilation; `-tools.js` for typed IPC requests; `actions/glossary-research-studio-actions.js` for dispatch. Split step renderers and controllers by domain rather than placing the whole workflow in one engine.

Suggested backend boundaries inside `glossary_research_studio/`: `types`, `storage`, `jobs`, `corpus`, `dictionary`, `sources`, `prompts`, and `testing`, with commands registered in `lib.rs`. Start long operations by returning job IDs and emit scoped `glossary-research-studio-progress` events. Keep blocking I/O and provider work off the IPC call path.

Add the Research AI setting through existing team AI configuration and secret handling. Validate provider capabilities per operation, including structured output and web acquisition. Do not provision new credentials or introduce subscription-login execution from the experimental lab. The app uses its configured provider integrations. Unknown failures, rate limits, malformed outputs, and offline transitions preserve checkpoints and allow retry; they never become successful evidence or passing tests.

## Resolved behavioral decisions

- Usage counts, confirmed by Hans on 2026-10-15 and reflected in the updated Desktop document: step 10 uses step 9, taking each batch's final successful results. Step-8 results remain test history and do not determine retention defaults.
- Expanded sample, confirmed by Hans on 2026-10-15: add recovered meaning examples even when this takes the total over 100, include them in subsequent tests, and show the actual total. The initial step-3 cap does not cap the expanded working set.
- Missing-meaning recovery, confirmed by Hans on 2026-10-15: use one shared limit of 500 additional distinct paragraphs, in batches of 50. Check all still-missing meanings in each batch and stop searching for each once an example is found.
- Meaning assignment, confirmed by Hans on 2026-10-15: assign a meaning to each occurrence and keep the whole paragraph as context. Test each occurrence separately. Split-entry routing also operates on occurrences, preserving shared paragraph context for split and unsplit matches.
- Meanings without examples, confirmed by Hans on 2026-10-15: retain them and their evidence in the research report as No corpus example found, but exclude them from all remaining research steps and the glossary draft.
- Step-8 progress decisions, confirmed and amended by Hans on 2026-10-15: no fixed repair-round limit. Count rounds and ask AI to report progress every five rounds, then ask the user to Stop or Continue if repairs are still needed. Preserve saved work on Stop and allow resumption. This supersedes the earlier three- and five-round failure thresholds for step 8.
- Step-9 repair pause, confirmed by Hans on 2026-10-15: after three unsuccessful repair rounds for the same batch, pause and let the user decide how to continue. Keep remaining failures and all saved work; do not silently pass tests or advance the workflow.
- Usage display and retention, confirmed by Hans on 2026-10-15: show both occurrence and distinct paragraph counts for each translation. Use occurrence counts for retention defaults.
- Inflection additions, confirmed by Hans on 2026-10-15: allow multiple inflections of the same word to be added together in step 8, counted as one candidate addition in that iteration. Store and count each inflection separately; step 10 defaults unused inflections off for removal, with the usual user override. This grouping does not merge occurrence counts or make unlisted inflections automatically confirmed.
- Empty original-term workflow, confirmed by Hans on 2026-10-15: when splitting leaves no active original-term meanings, skip its steps 5–11 and go straight to the step-12 split-entry queue prompt. Retain the original study as the parent research record.
- Updated Desktop scope, 2026-10-15: required step 4.7 splits meanings into queued glossary entries using longest-first matching; the new step 12 above the deferral line researches those entries through steps 5–11 after the original term's Save or Cancel.
- Merge-only completion, confirmed by Hans on 2026-10-15 after adding step 2b: save the assigned source variants into the selected existing glossary entries, then finish the study. This branch does not proceed to corpus sampling or further research.
- Re-research inputs, confirmed by Hans on 2026-10-15: add the existing entries' source variants to the step-1 source list, then repeat 2a; add their target variants to the candidate list in step 6. Retain the existing variants as research inputs rather than constructing a fresh proposal that omits them.
- Overwrite timing, confirmed by Hans on 2026-10-15: stage step-10b overwrite decisions until the user clicks Save in step 11. Cancelling leaves existing entries unchanged; keep the staged decisions in the saved research rather than applying them early.
- Collision granularity, confirmed by Hans on 2026-10-15: one Overwrite or Keep old, drop new choice per colliding source variant, with an Apply to all shortcut. Individual choices can differ for variants from the same existing entry.
- Re-research save process, confirmed by Hans on 2026-10-15: use the same new researched draft, per-variant collision decisions in 10b, and staged Save in 11 as separate research. Old entries retain remaining source variants and are deleted only if empty after the saved overwrite; split entries use their separate queue workflows.

All behavioral questions identified in this review, including those introduced by the added existing-entry and collision steps, are resolved above. The Desktop specification together with these confirmed decisions governs implementation. The latest numbering uses 2a for forms, 2b for existing-entry handling, 10a for retention, and 10b for collisions. Chat decisions explicitly revising the Desktop text take precedence over older wording still present there.

## Validation and acceptance

Use deterministic fake corpora, web/dictionary tools, and AI responses for workflow tests. Add semantic fixtures that exercise the intended failure rather than checking only that prompts contain certain words.

- Navigation and storage: unchanged Back/Forward sends no requests; targeted edits invalidate only dependencies; skips remove active contributions; interrupted writes/jobs recover; changed team or obsolete attempt cannot overwrite current state; saved history opens offline.
- Existing entries: skipping 2a still runs 2b; related-entry summaries and all three branches work; merge-only adds source variants without altering targets/notes and finishes after confirmed saves; failed or partial saves remain recoverable; revisiting a completed merge does not repeat it. Re-research combines existing source variants with the step-1 list and repeats 2a, then includes existing target variants for review in step 6 and tests them normally. Several contributing entries still save through the same researched draft and per-variant step-10b decisions, preserving remaining old-entry variants and processing split entries separately.
- Sampling: top-three form witnesses, top-15 meaning evidence, representative coverage, duplicate references, complete populations beyond ordinary search caps, reproducible random fill, missing forms, zero hits, and the 100-paragraph coverage conflict.
- Evidence: dictionary absence versus outage, original-language citations, decomposition child-skip behavior, both provenance branches skipped, author aggregation, false author mentions, uncertain dates, and the pre-1977 Spanish-translation rule.
- Meanings: target-language definitions, editable selection/addition, one assignment per occurrence with whole-paragraph context, several meanings in one paragraph, unmatched modal validation, dropping the last result, batching 50 with no duplicate scans, the 500-result boundary, recovered examples, and unused meanings.
- Candidate testing: temporary suggestions require approval; user alternatives restart affected tests; full paragraphs are preserved; no failed/missing output is counted; all attempts remain available; meanings without corpus examples remain in the report and never enter downstream tasks or the glossary draft. Several explicit inflections may be added in one candidate-addition group and one iteration, but retain separate test identities and counts. Step 8 reports progress and asks Stop/Continue at rounds 5, 10, 15, and later intervals, with no fixed maximum; restart preserves counters, reports, and pending choices. Step 9 pauses after three unsuccessful repair rounds. Initial tests are distinct from repair rounds.
- Final selection: expected meanings are withheld from translation; test prompts use production glossary rules; wrong, absent, or unresolvable rendered candidates fail; changes to notes/order recheck earlier batches; final passing batches all reference one draft revision.
- Counts and save: final-attempt-only counts, occurrence and distinct paragraph counts, correct denominators including recovered examples, repeated uses within one paragraph, occurrence-based retention defaults, zero-use retention, post-pruning invalidation, New Term duplicate feedback, save permission failure, queued-save failure/retry, editor cancellation and Back/resume, and no duplicate term on reopening a saved study.
- Staged overwrites: per-source-variant choices, Apply to all followed by individual overrides, mixed choices within one old entry, no old-entry writes during 10b, Cancel, or Back to research; Save checks current revisions and applies the new entry and related removals/deletions together; failed saves preserve recoverable original contents and staged decisions. Deleting the final source variant removes an old entry only as part of the saved overwrite.
- Splitting and queue: no split, full/partial split, several entries for one meaning, longest-first precedence over the original term, mixed occurrences, queue persistence, Back invalidation, empty original-term handling, and independently saved/cancelled child entries starting at step 5.
- Browser integration: complete steps 1–12 with fake services, skip every optional branch, backtrack after candidate approval, reload during tests, resume after cancelling New Term or the split-queue modal, and verify ordinary glossary and QA editor flows still work.

Exercise Spanish→English and Spanish→Vietnamese cases, including a borrowed name/spelling, ordinary versus specialized use, a rare recovered meaning, and a term requiring different translations across meanings. Compare actual draft-guided translations with their assigned meanings and inspect full paragraphs; passing schemas alone does not establish linguistic quality. Real provider checks use app configuration and record unresolved human judgments.

Run focused Node and Rust tests as each milestone lands. Before completion run `npm test`, `npm run test:rust`, `npm run build`, `npm run lint:js`, `npm run audit:unused`, Rust formatting/Clippy checks, and the relevant Playwright suite. Check native behavior on macOS and Windows, including browser dictionary retrieval, checkpoint replacement, cancellation, modal keyboard/focus behavior, and navigation without scroll loss. Record existing unrelated failures separately rather than changing unrelated code.

The replacement is complete when every in-scope branch is available, its saved study survives backtracking and restart without unnecessary repeated work, tests use the same delivered draft the user saves, and the normal term editor can save or cancel without losing the research. Old code, notes, and research artifacts remain preserved for reference.


## Implementation and verification notes — 2026-10-15

The glossary editor now opens the Studio from Research. The implementation is separate from the old research checkout and lab scripts. Research studies, cached evidence, decisions, test history, and editor drafts persist outside glossary repositories. The normal term editor and write coordinator handle the final save; collision removals and the new entry share a recoverable Git transaction.

The workflow supports non-Spanish sources. Dictionary acquisition selects the native-language Wiktionary edition, then English Wiktionary and cited dictionary web research as needed. Spanish also has DLE. Borrowed words can consult an original-language dictionary independently of optional form discovery. Definitions and usage notes use the glossary target language.

Internet research uses the configured Research model's provider-native cited search (OpenAI or Claude). Other configured providers can perform ordinary research/test prompts; a web-dependent operation explains the capability requirement rather than returning fabricated sources. No credentials were provisioned and no paid provider requests were made during implementation verification.

The coordinated GlossaryGen change adds author-level metadata compilation during search-index rebuilds, with source fingerprints, aliases, book lists, mention witnesses, and invalidation of stale verification. Supplied complete review verdicts produce verified counts; absent reviews remain explicitly unverified. The Studio verifies previously unreviewed witnesses through the configured AI and caches those judgments per installation, independently of the researched term. These service changes have been applied locally and tested, but the live service has not been redeployed or rebuilt. The Studio can use the currently deployed source-books/sampling endpoints and reconstruct shared mention evidence until the compiled metadata is published.

Verification uses deterministic AI/corpus fixtures rather than claims of linguistic correctness. Unit coverage exercises exact sampling, per-occurrence assignment, shared 500-paragraph recovery and expansion beyond 100, missing meanings, longest-first routing, inflection groups, five-round checkpoints without a fixed cap, three-round selection pauses, final-attempt counts, shared-note rechecking, and collision staging. Browser checks cover an English→Vietnamese study and mixed collision decisions through the existing term editor. Rust checks cover checkpoint revisions and interrupted/committed collision-save recovery.

Native DLE webview behavior and real provider linguistic results still require a configured app session. Windows native behavior has not been exercised on this macOS host. The public corpus endpoints were checked live; the full Rust suite and JavaScript suites are run locally. Detailed final check totals and any unrelated lint/audit findings are recorded at delivery.


Final local verification:

- JavaScript: 2,291 unit/integration tests and 23 repository workflow tests passed. The latter need subprocess/local-server access and passed outside the restrictive sandbox.
- Rust: full suite passed with 722 tests and 7 existing ignored tests; two subsequently added recovery tests also passed with the existing stale-entry test (3 targeted checks). Strict Clippy with all targets and warnings denied passed.
- Studio browser integration: four Chrome tests passed, including Back/Forward from final counts to candidates with no new tool requests, cancellation before staged collision writes, save through the normal editor, restart at a five-round checkpoint, and inherited split-entry context.
- Source service: 13 author-metadata, bibliography-inventory, and source-book-status tests passed.
- Production frontend build, Rust formatting, and diff whitespace checks passed. JS lint reports 0 errors and 62 pre-existing warnings, with none in the studio files. The unused-code audit reports existing lab/other-file issues and five existing browser import-resolution issues; no studio modules or imports are reported.

Project evidence supports approximate form recall independently of exact matching. Accent-folded or near-spelling witnesses are passed to identity review; exact population counts continue to distinguish source spellings. Project snapshots also retain a content fingerprint. Expanded meaning searches persist scanned paragraph IDs so pausing or resolving an unmatched example cannot restart the shared 500-paragraph budget. A split expression spanning multiple original-word occurrences becomes one child expression occurrence, retaining its origin links; expressions covering incompatible meanings are rejected rather than silently losing an occurrence.

### Step 2a entry behavior — user clarification, 2026-10-15

Step 1 retains all forms/spellings the researcher already knows. Advancing to 2a automatically runs discovery and corpus verification using those inputs. Show search progress first, then the combined editable/checkable list; Save and continue approves that list. There is no initial Run action in this normal flow. Unchanged Back/Forward reuses completed discovery; failed/interrupted searches remain retryable and optional skipping is retained. Update the workflow entry, review rendering, and browser coverage together.

During step-2a discovery, show a spinner and a concise description of the current activity. Display entered forms immediately, add AI-discovered forms as soon as the proposal arrives, and update individual form statuses after each corpus lookup. Clearly distinguish candidates/evidence from the final batched identity verdict. Keep the list read-only until discovery finishes; then enable additions, edits, and selection. Checkpoint these incremental updates and ignore obsolete job updates after navigation. Test intermediate states with held tool responses, not timing-only sleeps.


Endpoint correction: Hans explicitly prefers fixing the unavailable service endpoint over adding a fallback. Remove the temporary 404 fallback, preserve explicit endpoint errors, isolate the spelling-discovery endpoint and its existing tests from unrelated GlossaryGen changes on current upstream main, validate and deploy the code-only change, then verify the live endpoint. The existing pinned corpus data must remain unchanged. Continue testing progressive discovery and its spinner independently.

### Live endpoint correction and progressive forms — completed 2026-10-15

The missing `/api/search/forms` implementation was local-only. It was isolated from the other GlossaryGen edits on current upstream main, validated against the exact production corpus/release data, committed as `ea3e13bb17d8a40812c6c3255bac9772f9d95f99`, and pushed to `gnosistms/glosario` main. DigitalOcean deployment `7946c048-8c9c-4b74-a854-a4c25670d5a4` is ACTIVE with the existing `20261014-120000` data version. The service suite passed 148 tests with two existing skips, and local/live HTTP checks cover `ser`, `Hasnamuss`, and `Íntimo`. The temporary unavailable-endpoint fallback was removed. Request/operation versions prevent reuse of the earlier spelling-capability response.

Step 2a now starts automatically from scope, shows a keyed spinner and a concise activity label, immediately lists known forms, adds discovered candidates as each retrieval finishes, and updates per-form corpus/identity-review status. The combined list becomes editable when verification finishes. Interrupted searches cannot be approved as completed results. Each incremental update is checkpointed; unchanged Back/Forward reuses the saved results. Six browser tests pass, including held proposal/corpus/verification responses proving the intermediate list and spinner are visible before completion. The frontend regression suite passed 2,292 tests plus 24 workflow tests; targeted studio tests pass 20 checks. Rust studio tests, strict Clippy, frontend build, and whitespace checks pass. The unrelated local source-service edits and original research materials remain preserved.
# Step 2a corrections: case variants, attestation, and layout

1. Deduplicate source forms using NFC-normalized, case-insensitive keys while preserving accents and the first spelling. Apply at discovery, scope, review, and resume boundaries.
2. Determine presence from literal corpus matches, independently of AI identity review. Retrieve exact witnesses for proposed forms and display authoritative paragraph counts. Invalidate earlier cached step 2a results and recheck older studies on opening this step.
3. Present each form in a separate card with its control, corpus status, and contained explanation. Verify plural attestation, duplicate handling, progressive results, and the rendered layout with focused tests and browser checks.


Verification of step 2a corrections (2026-10-15):
- The live literal-form sampling endpoint returned 2,026 distinct paragraphs for `mundos` (2,039 copies), with plural witnesses. General search expanded glossary aliases and returned singular witnesses, explaining the incorrect AI absence verdict.
- Source variants now deduplicate with language-aware case normalization, retaining accents and the first spelling. Exact population counts determine initial inclusion; AI reviews lexical identity only. Old step 2a signatures are invalidated; reopening an older study rechecks it, and the review screen offers a corpus recheck for forms without counts.
- Each variant has its own card, status/count, and explanation. Desktop and narrow-window screenshots were inspected; the narrow grid overflow was fixed and covered by a viewport containment assertion.
- 2,296 JavaScript tests passed. All seven studio browser scenarios passed across the full run and focused reruns, including live progress, plural attestation, case duplicates, and old-study reopening. Production build and focused ESLint passed.

## Saved-study deletion

1. Add a Delete research action to each history card, with a confirmation naming the study and the local files removed. Keep glossary entries and other saved studies unchanged.
2. Add a native storage delete operation for the selected study JSON, unfinished save file, and per-study evidence/tool directory. Serialize deletion with saves, prevent late tool results from recreating deleted files, and keep split-study links valid without deleting other studies.
3. Remove deleted studies from the query cache and refresh history. Verify native file removal/isolation, cancel/delete interactions, reload persistence, and handling of linked studies.

Saved-study deletion implemented and verified (2026-10-15): each history card has Delete research, with Cancel initially focused in a confirmation naming the study. The native operation removes the study JSON, temporary save file, and its tools/evidence directory; glossary entries, shared author evidence, and other studies remain. Surviving parent/child records are detached, and query caches are cleared before history reloads. Serialized saves and guarded tool-cache writes prevent deleted studies from being recreated by late results.

Validation: three native storage tests passed (including file isolation, late writes, and split-study links); two browser scenarios passed (cancel/delete/reopen and error/retry), with a screenshot inspected. `npm test` passed (2,296 application tests and 24 workflow tests), production build and focused ESLint passed, and strict all-target Rust Clippy passed. The unused-code audit still reports the preserved research-lab files and pre-existing browser-import findings; it reports no unused Studio exports.
