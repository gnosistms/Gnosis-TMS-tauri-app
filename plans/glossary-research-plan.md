# Glossary Research

Status: requirements agreed with Hans on 2026-09-24/25. Not implemented yet.

## Objective

Let a translator research a source-language word from inside Gnosis TMS and get proposed glossary entries back. The research does four things:

1. Looks the word up in a dictionary.
2. Samples real passages from the chosen source texts.
3. Proposes target-language translations with usage notes.
4. After the user has reviewed those proposals, counts how often each translation is judged the most appropriate in a random sample of passages.

The user then reviews the proposed entries and saves each one into the glossary.

The procedure is the one built and benchmarked in the GlossaryGen CLI prototype (`GlossaryGen/variant_tool/`, see its README). First paid run: *fatal* → English with Claude Opus 5.5, 100 paragraphs, $1.74 in total, research plus counting in under 2 minutes. That prototype is the reference implementation for the prompts, the budget logic, the sampling rules and the report layout.

## Scope decisions (from the interview)

| Topic | Decision |
|---|---|
| Entry points | (1) a **Research** button on the Glossary editor page; (2) a **Research glossary terms** button on each source-language field in the chapter editor. |
| Language rule | Research always happens in the glossary's source language. There is no research across languages. The editor entry point can start from any language of a row, but it first finds the matching source-language term. |
| Source texts | "Complete works of Samael Aun Weor" (via the public search API) or "Select projects" (the team's projects). |
| Dictionaries | Tiered. A trusted source per language where we have one (Spanish → RAE/ASALE DLE). Otherwise Wiktionary, then AI web search limited to dictionary sites. Every definition is cited, and when nothing is found the report says so. The model's memory never stands in for a dictionary. |
| Model | A new **Research** action in AI Settings, alongside Translate / Review. Only OpenAI and Claude models are supported. |
| Spending | A limit per run, $4 by default, under Advanced. A request is not sent unless its worst-case cost still fits under the limit. |
| Who can run it | Anyone with `canWriteGlossaries` (translator, admin, owner). |
| Progress | Stays in the modal, with a progress bar and a detailed live log. |
| Review | **Always** pauses after the proposal. Counting starts only after the user confirms or edits the proposed translations. |
| Result | A full page in the app. Each entry has **Update / Keep existing** (or **Add**), can be edited, and has its **own Save button**. |
| History | Kept on this computer only. |
| QA lists | Not included. This is a deliberate exception to the AGENTS.md parity rule, because research proposes translations and QA lists don't hold translations. |

## 1. Glossary editor entry point

- Add a **Research** button just left of **+ New Term** (`src-ui/screens/glossary-editor.js:138`). It is shown under the same permission as + New Term.
- Tooltip, using `tooltipAttributes`: "Research the meaning of a word in the source language and suggest translations in the target language."
- If the team's Research model is not OpenAI or Claude, clicking the button opens a modal that only says: "[User's selected AI] does not support this feature. To use this glossary research tool, please use one of the following AI providers: [list of supported providers]".
- Otherwise it opens the **Research modal** (§3).

## 2. Chapter editor entry point

1. Add a fourth row button to the left of *View / edit comments*, *Mark reviewed* and *Please check* (`src-ui/app/editor-row-render.js`, around lines 100–131). When the comments button is hidden, it sits to the left of the other two.
2. It uses the toolbar's *Derive glossaries* icon (`TOOLBAR_ICONS.deriveGlossaries`, `src-ui/screens/translate-toolbar.js:17`). Tooltip: "Research glossary terms".
3. It is shown only on the source-language field.
4. Clicking it checks the chapter's linked glossary:
   - If the chapter has **no linked glossary**, a message explains that research needs one and how to link it.
   - If the **glossary's source language differs from the chapter's source language**, a message explains the mismatch and names the chapter's source language and the glossary's language pair.
   - Otherwise it navigates to that glossary's page and opens the **preparation modal**.
5. The preparation modal contains:
   - A segmented control labelled "Select the language of the term you want to research". Its options are the languages present in the clicked row, and the source language is selected by default.
   - A text field labelled "Enter the [selected language] word you want to research", with the placeholder "Enter research word or phrase here".
   - Below the field, the row's text in the selected language. It is selectable so the user can copy from it. If that language is empty in the row: "[Language] has no text in this row."
   - Buttons: **Cancel** (secondary; returns to the editor at the same row) and **Next** (primary; disabled while the field is empty).
6. **Next when the selected language is the source language:** open the Research modal pre-filled with the term.
7. **Next when another language is selected:** ask the model which word in this row's source text corresponds to the term.
   - **Low confidence:** show "We can not find a term in [source language] that corresponds to [research term]." with the buttons **Cancel research** (back to the editor) and **Edit research term** (back to the preparation modal).
   - **Found:** show a confirmation: "We have identified that the [source language] term corresponding to [research term] is [identified term]." Below it, the model's own definitions of the source term, written in the selected language. Buttons: **Cancel** (to the editor), **Edit term** (back to the preparation modal) and **Research this term** (primary; opens the Research modal pre-filled with the identified source term).
8. When started from the editor, the Research modal's "Source texts" defaults to the Samael corpus if the glossary's source language is Spanish. Otherwise it defaults to the project the user came from, already ticked in "Select projects".

## 3. Research modal

The markup follows the existing modal pattern (`.modal-backdrop > section.card.modal-card`, `src-ui/app/events/modal-dialog.js`).

- **"Enter the term to research"**: a text field.
- **Add variant or alternative spelling**: a **+** next to that text. Clicking it adds a variant field, and the "+ add variant…" line moves below the new field. Each variant field has a remove button.
  - These reuse the term editor's classes: `term-lane__add-button` / `term-lane__add-icon` for +, and `term-variant-row__action-button--remove` for remove. The existing remove button draws a minus bar, not an ×. The plan follows the existing style, per "follow the style of similar buttons".
  - Typed variants are *hints* for the automatic search for word forms (§5). They don't force a grouping.
- **Report language** selector. It defaults to the glossary's target language. Quick choices are the target language, Spanish and English, with duplicates removed. **Show all…** opens the existing language picker modal (the nested-picker precedent in `target-language-manager-modal.js`).
- **Source texts** selector:
  - **Complete works of Samael Aun Weor** is shown only when the glossary's source language is Spanish.
  - **Select projects** opens a nested modal listing the team's projects with checkboxes, and allows more than one selection. On return, the Research modal lists the selected projects as plain text on one line, with an ellipsis when too long.
- **Advanced** (collapsed): sample size (100 by default; all if fewer exist), spending limit ($4), random seed.
- **Existing-entry check.** Before starting, look the term and its variants up in the glossary.
  - If an entry exists, warn the user and show a short summary of it: its source terms, target variants and notes.
  - Explain that continuing lets them review the results before anything changes.
  - Buttons: **Continue** / **Cancel**.
- **Start** is the primary button.
- Validation for "Select projects": files (chapters) whose languages don't include the glossary's source language are ignored. If **none** of the selected projects' files contain it, stop with an explanation.

## 4. Progress, log and review pause

After Start, the modal becomes the run view. It shows a progress bar with the current step, the cost so far against the limit, and **Cancel**.

Below that is the **live log**: a scroll view that always follows the bottom, like a terminal or Claude Code.

- Major steps are headings: Dictionary, Word forms, Sampling, Discovery, Proposal, Review, Counting, Report.
- Key facts are bold, and colour may be used. Examples: "DLE: found, 6 senses, 2 complex forms"; "256 distinct passages, 265 occurrences"; "sample: 100 passages".
- Everything else is shown raw, in a dim monospace font. That covers:
  - every prompt sent and every answer received;
  - streamed thinking summaries (Claude `display: "summarized"`, OpenAI reasoning summaries);
  - dictionary lookups (tried / found / not found / unreachable);
  - search counts (forms, matches, duplicates removed);
  - for each AI request: its purpose, input/cached/output tokens, cost and time;
  - interim findings ("14 renderings seen; most common sinister (9)").
- No tokens are spent on making the log pretty. The formatting is done in code.

**Review pause (always).** After the proposal, the run stops and shows the proposed entries as an editable list:

- the groups of source terms;
- the target variants, each with its usage note in the target language;
- the general translator note;
- the expression entries;
- existing variants that were carried over as candidates.

The user can edit, add or delete, then click **Count** (primary) or **Cancel**. Only the confirmed version is counted.

Cancel at any point keeps the finished work and the log, marks the run *cancelled*, and allows it to be resumed later from history.

## 5. Research procedure (the prototype's configuration A)

1. **Dictionary** (tiered, in the source language, all senses kept with their labels and linked synonyms/antonyms):
   - **Spanish: DLE.** dle.rae.es blocks scripted clients with a Cloudflare browser check, and we never try to get around it. The page is loaded in a hidden Tauri webview, which is a real browser engine, and the article HTML is read from the DOM. If an interactive check appears, the webview is shown to the user to pass it themselves. If retrieval fails, that is reported as "unreachable", never as "no entry". Complex forms such as *mujer fatal* are read from the head noun's page by their DLE id.
   - **Other languages, or no trusted source:** the Wiktionary REST API, trying the source language's own edition first and then English.
   - **Still nothing:** AI web search limited to dictionary domains, with citations.
   - **Nothing anywhere:** "no dictionary entry found".
2. **Existing entry as a starting point.** If the glossary already has the term, the model uses its source terms to seed the search for word forms, and adds its target variants to the list of candidates. They are counted like any other candidate. If they are never chosen, the report proposes removing them.
3. **Word forms.** The model proposes inflections and alternative spellings, including the user's typed variants. It then checks them against the selected texts by reading how each form is used. A form that doesn't appear can still be kept if the model is highly confident it is the same word (*libro/libros*); it is marked "not found in texts". For the Samael corpus, `/api/sample/forms` supplies the corpus word list too.
4. **Grouping by target language.** Source forms are grouped into entries (TMX units) according to whether the target language can keep them apart:
   - ES→EN: *llave* → *key* and *llaves* → *keys* are two entries.
   - ES→VI: *llave/llaves* → *chìa khóa* is one entry.
   - *negro/negra/negros/negras* → *black* is one entry in both cases.

   The proposal therefore contains **one or more** entries, plus separate expression entries (e.g. *mujer fatal* → *femme fatale*). Derived words (*fatalmente*, *fatalidad*) are listed as suggested separate studies (text only).
5. **Sampling.** The population is every passage in the selected texts that contains any confirmed form, in the research language.
   - Passages with identical text become one item, and every copy's reference is kept.
   - A seeded, uniform random sample of **n** is drawn from the whole population, never from ranked search results.
   - A separate discovery sample, which does not overlap the counted sample, is used for the open reading.
   - Samael corpus: `/api/sample` (already built in GlossaryGen `serve_search.py`, not yet deployed; see Dependencies).
   - Projects: a new backend sampler over the project search index (§7).
6. **Existing translations in projects.** Where a sampled segment already has a target-language translation, it is added to the *initial candidate list* only. It is never treated as authoritative, never shown to the judge as the answer, and never counted.
7. **Discovery → proposal → review pause → freeze.** The confirmed proposal gets a version hash. If the user edits it later, the old counts do not carry over to the new version.
8. **Counting.** For every occurrence in the sample, the model translates its sentence, then names the variant it used. It may also answer "other" (with the rendering it would use) or "unresolved" (with a reason). All counting is done in code:
   - paragraph and occurrence totals are kept separately;
   - every occurrence ends up as a variant, other, unresolved, failed or not run;
   - an "other" answer that names an existing variant counts as that variant, with a flag recording the change.
   - Configuration B (select first, check some) was measured as no cheaper and no more accurate, so it is not offered.
9. **Summary** in the report language. TMX notes are always in the target language, regardless of the report language.

## 6. Report page

A full page in the app with a Back button, like opening a chapter. The order is: proposed entries first, then summary, method, dictionary evidence, other/unresolved cases, cost and log.

Each entry card shows:

- the existing entry (if any) next to the proposed one, as editable fields for source terms, target variants and per-variant notes, and the general note;
- a choice between **Update** and **Keep existing** (or **Add** for new entries and expressions);
- a **Save** button that writes only that entry through the normal term-save path (`glossary-term-draft.js`), so glossary write policy and git sync behave as usual;
- next to each variant, its count as "n of N occurrences · p passages". Clicking a variant expands it in place to show its actual examples: the Spanish passage with the term highlighted, the saved translated sentence with the chosen wording highlighted (labelled "translated sentence, not the full passage"), and the source reference. Five examples show first; **Show more** reveals the rest. None of this makes AI calls.

The page also:

- separates a variant's total count from the number of translated examples saved;
- shows proposals to remove existing variants that were never chosen;
- offers **Export**: the Markdown file for discussing the research with any LLM (the prototype's `discuss_*.md`) plus the JSON bundle.

## 7. Backend work (Rust, `src-tauri/`)

- **Research job.** Follows the PDF-export pattern: a job id (uuid v7), a cancel flag (`Arc<AtomicBool>`), `tauri::async_runtime::spawn`, a `glossary-research-progress` event carrying log lines and progress, and a `cancel_glossary_research(job_id)` command. The checkpoints follow the prototype's stage files, so a run can resume.
- **Storage.** `<app data>/installations/<id>/research/<glossary-id>/<run-id>/`. Local only; nothing is committed to the glossary repo.
- **AI layer:**
  - Return token usage from Claude and OpenAI; `AiPromptResponse` has no usage today.
  - Stream responses so the log can show text as it arrives.
  - Accept per-request effort and `max_tokens`.
  - Use a cached stable prefix (Claude `cache_control`; OpenAI explicit cache breakpoint).
  - Use strict JSON schema output (the OpenAI and Claude paths already exist or are in progress in `claude-opus-5-5-support.md`).
- **Spending control.** Port the prototype's `llm.py` logic:
  - reserve the worst-case cost before sending (all input at the cache-write rate, plus the full `max_tokens` of output, thinking included);
  - replace the reservation with the reported cost when the answer arrives;
  - keep the full reservation for requests whose outcome is unknown.

  Prices live in a table in the app. A model without a price entry cannot guarantee the limit, so it is treated as unsupported.
- **Project sampler.** A new query over `project-search.sqlite3`, filtered by `language_code` = glossary source language. It returns the **whole** matching population (no 500-row cap and no ranking), then removes exact duplicates and draws a seeded sample. For each row it returns the text, the match offsets, and neighbouring rows for context. Chapters whose languages don't include the research language are ignored.
- **Dictionary adapters.** A DLE webview reader, a Wiktionary API client, and an AI web-search fallback.

## 8. Frontend work (`src-ui/`)

- A Research AI action in AI settings (`ai-action-config.js` / `ai-settings-flow.js`), listing only supported models.
- The Research button, preparation modal, confirmation modal, Research modal, project-selection modal and run view (log plus review pause).
- The report page and its per-entry save.
- Editor row button (§2) and navigation to the glossary page and back.
- Follows the module ownership rules in AGENTS.md: `*-flow.js` for intent, and query modules for data.

## Dependencies and open items

1. **Public search API.** `/api/sample`, `/api/sample/forms`, `/api/sample/collocations` and `/api/sample/context` exist in GlossaryGen `serve_search.py` but are not committed or deployed. The public site must be updated before the Samael option works for the team.
2. **DLE in a webview.** Whether dle.rae.es passes its check in a hidden Tauri webview must be tested early. If it doesn't, fall back to showing the webview to the user.
3. **Price table upkeep.** Prices change; the table needs a date and an owner.
4. **More benchmarking.** Configuration A was chosen from one word (*fatal*) in one language (English). Before release, run the prototype on a frequent word and on Vietnamese.
5. **Wiktionary licence.** Definitions are CC BY-SA, so the report must attribute them. Nothing is republished beyond the local report.

## Suggested implementation order

1. AI layer: usage, streaming, schema, effort; spending control; price table.
2. Research job and storage; port of the procedure from the prototype, with deterministic tests using a fake model (as in `variant_tool/test_variant_tool.py`).
3. Project sampler; Samael API client (after the API is deployed).
4. Dictionary adapters (DLE webview first).
5. Glossary-page modal, run view and review pause.
6. Report page with per-entry save.
7. Editor entry point (§2).
