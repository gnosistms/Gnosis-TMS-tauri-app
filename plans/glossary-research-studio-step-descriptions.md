# Glossary Research Studio: step descriptions

## Goal

Show one short sentence under each step title in the research studio that tells
the researcher what the step does. The sentence uses the study's own term,
corpus and sample size where they help.

## Design

- `src-ui/app/glossary-research-studio-step-descriptions.js` exports
  `studioStepDescription(study, stepId)`, a pure function returning plain text
  (the screen escapes it). Every entry in `STUDIO_STEPS` has a description.
- The corpus is "the complete works of Samael Aun Weor" or "the selected
  projects", matching the corpus choice in step 1.
- The sample size is the research sample from step 3: paragraphs in
  `study.passages` that were not added later by the missing-meaning search
  (`recovered`).
- `renderGlossaryResearchStudio` adds `<p class="studio-step-description">`
  to `.studio-step-header`, after the language pair. It takes the full header
  width, so it sits on its own line under the title.

## Descriptions

T = research term, C = research corpus, N = sample size, L = target language.

| Step | Description |
|---|---|
| 1 Scope | Choose the term to research, any forms you already know, and the corpus to research it in. |
| 2a List other forms and spellings | Find other forms and spellings of T in C, and count the paragraphs that use each. |
| 2b Existing entries | Check the glossary for entries that already cover T or its forms, and decide how to handle them. |
| 3 Research sample | Choose a sample of paragraphs from C that use T, as evidence for the following steps. |
| 4.1 Dictionary | Look up T in dictionaries and list its senses. |
| 4.2 Corpus meanings | Read the sample paragraphs to find the meanings of T in C. |
| 4.3 Word parts | Check whether the parts of T, such as its root words or affixes, explain a meaning not yet found. |
| 4.4.1 Bibliographical sources | Find earlier authors from whom T may have been borrowed, and the meanings they gave it. |
| 4.4.2 Internet sources | Search primary sources on the internet for further meanings or the origin of T. |
| 4.4.3 Source summary | Combine the bibliographical and internet findings into one summary. |
| 4.5 Review meanings | Combine all findings into one list of meanings of T, and choose the definitions to use. |
| 4.6 Assign meanings | In a sample of N paragraphs from C, identify which meaning of T is used. |
| 4.7 Split entries | Find fixed expressions with T that always carry one meaning and could become separate glossary entries. |
| 5 Compounds and phrases | Find recurring compounds and phrases with T that should inform its translations. |
| 6 Translation candidates | Suggest L translations for each meaning of T, and choose which to use. |
| 7 Standardize spelling | Check the spelling of translations that may be uncertain, such as borrowed names. |
| 8 Test each meaning | Translate each meaning's sample paragraphs with its translations, and revise translations that fail. |
| 9 Test complete entry | Translate the sample paragraphs with the complete entry, as translators will see it, to check that it leads to the right translation. |
| 10a Review usage | Count how often each translation was used, and choose which to keep. |
| 10b Resolve collisions | Decide what to do where a form of T is already a source form of another glossary entry. |
| 11 Save glossary entry | Open the finished entry in the term editor to review and save it. |
| 12 Split-entry queue | Research the expressions split off in step 4.7 as their own entries. |

## Tests

- Unit: every step has a description; 4.6 counts only the step 3 sample and
  names each corpus; terms are escaped in the rendered header.
- Browser: check the header layout at desktop and narrow widths.
