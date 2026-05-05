# AI Assistant Reference Translations Prompt Plan

## Goal

Include row translations from columns that are neither the selected source column nor the selected target column in the AI Assistant prompt, so users can ask the model to consult other translators' choices when the source text is ambiguous.

In this context, "reference translation" means any non-empty translation text in the active row whose unique language column code is not the current source column code and not the current target column code. This is column-specific, not semantic-language-specific: if duplicate columns share the same `baseCode`, an unselected same-base sibling column can still be a reference translation.

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
- Defensively skip any entry whose unique `language_code` matches the request row's selected source or target column code, even though the frontend already filters these out.
- Do not filter by semantic `baseCode`; same-base sibling columns are eligible references when they are not the selected source or target column.
- Use the language label supplied by the frontend, falling back to the language code if needed.
- Put all reference translations in this single section.
- Keep the requested user-facing wording "translations into other languages" in the prompt, but document in code/tests that eligibility is based on unique column code so same-base sibling columns may appear.
- Do not include complete history.
- Do not include author, timestamp, revision number, source label, or import provenance.
- Do not present these translations as authoritative.

## Implementation Steps

1. Add a Rust formatter in `src-tauri/src/ai/mod.rs` for `request.row.alternate_language_texts`.
2. Have the formatter filter out empty texts and any entries whose unique `language_code` matches `request.row.source_language_code` or `request.row.target_language_code`.
3. Have the formatter return an empty string when there are no remaining reference translations.
4. Insert the formatted section in `build_assistant_prompt`, near the row language context, likely after `target_language_history` and before `Glossary`.
5. Leave the existing frontend collection and request payload shape unchanged unless tests reveal a mismatch.
6. Add frontend/source tests or equivalent request-payload coverage showing:
   - `currentAssistantContext` or the assistant turn request includes an unselected same-base sibling column such as `zh-Hans-x-2` when the selected target column is `zh-Hans`.
   - The reverse duplicate-base case includes `zh-Hans` when the selected target column is `zh-Hans-x-2`.
   - Only the selected unique source and target column codes are excluded from `alternateLanguageTexts`; entries must not be excluded only because their `baseCode` matches the source or target.
7. Add Rust prompt tests covering:
   - Reference translations are included when `alternate_language_texts` has non-empty entries.
   - Empty reference translations are omitted.
   - Source-language and target-language entries are omitted even if they appear in `alternate_language_texts`.
   - Duplicate-base sibling columns are included when they are not the selected source or target column, e.g. selected target `zh-Hans` and reference entry `zh-Hans-x-2`.
   - The reverse duplicate-base case omits only the selected unique target column, e.g. selected target `zh-Hans-x-2` while `zh-Hans` remains eligible as a reference entry.
   - Empty `language_label` falls back to `language_code`.
   - The section uses only one combined list.
   - The section does not include target-language history/provenance formatting.
   - The exact warning uses "do not consider these authoritative".

## Non-Goals

- Do not add history for non-source, non-target reference-translation columns.
- Do not change target-language history behavior.
- Do not add a UI control for selecting which reference translations are sent.
- Do not change source/target language selection rules.
