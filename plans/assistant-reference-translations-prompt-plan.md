# AI Assistant Reference Translations Prompt Plan

## Goal

Include row translations for languages that are neither the selected source language nor the selected target language in the AI Assistant prompt, so users can ask the model to consult other translators' choices when the source text is ambiguous.

In this context, "reference translation" means any non-empty translation text in the active row whose language is not the current source and not the current target.

## Current State

- The frontend already collects these texts as `alternateLanguageTexts` in `src-ui/app/editor-ai-assistant-flow.js`.
- The frontend already sends `alternateLanguageTexts` inside the `row` object for `run_ai_assistant_turn`.
- The Rust prompt builder currently does not format `row.alternate_language_texts` into the prompt.
- Target-language history is handled separately and includes provenance/history details. Reference translations should not use that format.

## Prompt Format

Add one prompt section for all reference translations.

Use this wording:

```text
The following is a list of translations into other languages. They may have errors, so do not consider these authoritative unless the user explicitly asks you to consult them. These will be useful in cases where the source is ambiguous and the user asks you to look at what translators of other languages did with the same source text.

Reference language translations:
English: [english reference translation]
Italian: [Italian reference translation]
Russian: [Russian reference translation]
```

Implementation details:

- Include only non-empty reference translation texts.
- Defensively skip any entry whose language code matches the request row's source or target language, even though the frontend already filters these out.
- Use the language label supplied by the frontend, falling back to the language code if needed.
- Put all reference translations in this single section.
- Do not include complete history.
- Do not include author, timestamp, revision number, source label, or import provenance.
- Do not present these translations as authoritative.

## Implementation Steps

1. Add a Rust formatter in `src-tauri/src/ai/mod.rs` for `request.row.alternate_language_texts`.
2. Have the formatter filter out empty texts and any entries whose `language_code` matches `request.row.source_language_code` or `request.row.target_language_code`.
3. Have the formatter return an empty string when there are no remaining reference translations.
4. Insert the formatted section in `build_assistant_prompt`, near the row language context, likely after `target_language_history` and before `Glossary`.
5. Leave the existing frontend collection and request payload shape unchanged unless tests reveal a mismatch.
6. Add Rust prompt tests covering:
   - Reference translations are included when `alternate_language_texts` has non-empty entries.
   - Empty reference translations are omitted.
   - Source-language and target-language entries are omitted even if they appear in `alternate_language_texts`.
   - Empty `language_label` falls back to `language_code`.
   - The section uses only one combined list.
   - The section does not include target-language history/provenance formatting.
   - The exact warning uses "do not consider these authoritative".

## Non-Goals

- Do not add history for non-source, non-target languages.
- Do not change target-language history behavior.
- Do not add a UI control for selecting which reference translations are sent.
- Do not change source/target language selection rules.
