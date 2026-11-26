# Spanish Run/Skip recommendation audit

1. Inspect all seven advisory decisions in Research Studio. Count actual AI answers from Spanish studies, including earlier answers superseded by a refresh. Exclude request failures, cached duplicates, human choices and automatic skips.
2. Test the production questions with varied Spanish terms and plausible counterexamples for any apparently constant decision. Record the model, scope, Run and Skip counts, and limitations.
3. For a decision that stays constant, use that choice without a recommendation request in the tested scope. Preserve manual choice, existing study evidence and eligibility rules. Exercise the affected paths and run the relevant checks.

## Findings · 2026-11-23

Every optional Research Studio step received at least one genuine Run and one genuine Skip. Keep the current decision calls. The Studio already skips the source summary automatically when both source branches were explicitly skipped.

| Studio step | Saved Run | Saved Skip | Fresh Run | Fresh Skip |
| --- | ---: | ---: | ---: | ---: |
| 2a Forms and spellings | 13 | 0 | 9 | 2 |
| 4.1 Dictionary | 10 | 0 | 7 | 3 |
| 4.3 Word parts | 2 | 6 | — | — |
| 4.4.1 Bibliographical sources | 6 | 2 | — | — |
| 4.4.2 Internet sources | 6 | 1 | — | — |
| 4.4.3 Source summary | 1 | 0 | 4 | 3 |
| 5 Compounds and phrases | 4 | 2 | — | — |

### Saved decisions

The local Spanish studies contained 80 recommendation receipts across 37 studies. Extracting each saved request and its model answer from the tool cache gave 53 distinct prompt/model combinations across 12 terms. Repeated combinations agreed and count once. The model IDs were `gpt-6.1-sol` (42) and `gpt-6.2-sol` (11).

To reproduce the count, read the Spanish study manifests under `installations/*/research-studio/*/`, select cache entries with purpose beginning `Recommending Skip or Run for step `, and resolve each request and value from the study’s evidence directory. Group by the displayed step in the prompt evidence, deduplicate by model and full prompt, and require a Run or Skip response with a nonempty reason. All 80 receipts contained valid answers. Manual choices, automatic skips and failure defaults contribute zero votes.

Four steps already had counterexamples in actual use. Word parts received Run for *ilustrados* and Skip for *fantasma*. Both bibliography and internet sources received Run for *perverso* and Skip for *famosa*. Compounds received Run for *antítesis* and Skip for *el tenebroso*. Only one distinct source-summary recommendation was saved, a Run for *batallar de las antítesis*.

### Fresh model tests

The three remaining steps were tested with 28 Spanish-to-English cases covering 20 distinct terms. Each case used the question, evidence preview and JSON instructions built by `recommendStudioStep` and `createStudioTools`. Each prompt went to a fresh, tool-free `gpt-6.2-sol` session through the repository’s Codex CLI testing approach at low reasoning effort. All 28 answers parsed successfully. The new prompts used authored test examples, including two invented Spanish coinages. The saved-study evidence was analyzed locally.

| Step | Run cases | Skip cases |
| --- | --- | --- |
| Forms and spellings | *hablar*, *luz*, *ayer*, *también*, *aunque*, *a menudo*, *crisis*, *ir*, *lápiz* alone | *lápiz* with *lápices*, *feliz* with *felices* |
| Dictionary | *mesa*, *ayer*, *luz*, *sensible*, *sin embargo*, *egregor*, *templanza* in an ordinary sentence | *deslumbrejo* and *parpazul* explicitly coined and defined in the text, *templanza* with a cited sense and grammatical category already supplied |
| Source summary | *sensible* with an earlier source distinguishing two uses, *umbral* with a newly documented sense, *luz* with a disputed attribution, *luz* with a reported reprint | *mesa* with a duplicate sense, *cántaro* with an unrelated shopping result, *voz* with the same passage from the same edition and page |

The paired forms and dictionary tests changed only the supplied evidence for the same headword and flipped the answer in both cases. In the *luz* source-summary pair, the model chose Run twice. For the reprint it questioned whether the passage had been retained and misidentified the skipped bibliographical branch as lexical. That response counts as a Run. These intentionally varied cases test whether a constant choice would work. Their proportions do not estimate how often a translator will see either answer.

The recommendation and countdown unit suites passed all 13 tests.
