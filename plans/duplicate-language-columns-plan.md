# Duplicate Language Columns Plan

## Summary

Support adding a second translation column for a language that already exists in a chapter, without migrating existing repositories. Existing chapter files remain valid because `baseCode` is optional and defaults to `code`.

Example existing data:

```json
{ "code": "zh-Hans", "name": "Chinese (Simplified)", "role": "target" }
```

New duplicate-language data:

```json
[
  { "code": "zh-Hans", "name": "Chinese 1", "role": "target", "baseCode": "zh-Hans" },
  { "code": "zh-Hans-x-2", "name": "Chinese 2", "role": "target", "baseCode": "zh-Hans" }
]
```

## Core Design

- Keep `language.code` as the unique internal column id and row-field key.
- Add optional `language.baseCode` as the semantic language identity.
- Treat missing `baseCode` as `baseCode = code`.
- Do not rename existing row-field keys when adding a second column.
- When adding a duplicate language through Add translation:
  - Rename the existing matching base-language column display name to `Language 1`.
  - Create a new unique column code such as `zh-Hans-x-2`.
  - Set the new column display name to `Language 2`.
  - Write aligned text into the new column.
- Use the same duplicate-base allocation rules in all three entry points:
  - importing a file with duplicated language columns,
  - inserting aligned text into a language already present in the chapter,
  - adding a new empty duplicate language through Add / Remove Languages.

## Duplicate Entry Points

### 1. Importing Files With Duplicate Language Columns

- During import, detect repeated semantic language headers after normal language-code normalization.
- Keep the first imported language column on the normal code when possible, e.g. `zh-Hans`.
- Allocate unique internal column codes for later duplicates, e.g. `zh-Hans-x-2`, `zh-Hans-x-3`.
- Set `baseCode` on all members of the duplicate group.
- Rename display names for the duplicate group to `Chinese 1`, `Chinese 2`, `Chinese 3`.
- Store row values under the unique internal column codes, not under the repeated base code.
- Preserve source/target role rules:
  - normally only one column should remain `source`;
  - duplicate imported columns for the same base language should default to `target` unless import format clearly marks a source column.

### 2. Inserting Aligned Text Into An Existing Language

- The paste language picker selects a semantic base language, e.g. `zh-Hans`.
- If no chapter language has that base language, create the normal column code, e.g. `zh-Hans`.
- If one or more columns already have that base language, create the next duplicate column code, e.g. `zh-Hans-x-2`.
- Rename the duplicate group display names to numbered names.
- Write aligned text into the new duplicate column only.
- Do not fill empty cells in existing duplicate-base columns.

### 3. Adding A New Empty Duplicate Language

- Add / Remove Languages needs an explicit way to add another column for a language that already exists.
- The language picker should no longer permanently hide existing base languages if the user chooses an “add another column” action.
- When adding another column:
  - allocate the next unique internal column code,
  - set `baseCode` to the selected semantic language,
  - number the duplicate group display names,
  - initialize empty row fields for the new column.
- Removing a duplicate column should remove it from `chapter.languages` but preserve row field data according to the current language removal behavior, so it can be restored by re-adding that exact column if needed.

## Migration And Compatibility

- No repo-wide migration is needed for existing files.
- Existing repositories load unchanged because old language entries have unique normal codes and no `baseCode`.
- New code must read `baseCode` as optional everywhere:

```js
const baseCode = language.baseCode ?? language.code;
```

- The compatibility risk is old app versions writing to repositories after a new app creates duplicate-base columns.
- Once a repository contains duplicate-base language columns, old app versions may render the unique column but will not understand semantic language identity for glossaries, AI workflows, ruby controls, and language selection.

## Version Gate

- Bump the repo/app compatibility version when duplicate-base language columns are created.
- Use the existing update-required mechanism to block older app versions from writing to repos that contain the new schema.
- Forward-compatible read behavior is still required in the new app.
- It is acceptable to write `baseCode` only when needed, but writing it for all languages going forward may simplify logic.

## Affected Areas

- `ChapterLanguage` Rust struct: add optional `baseCode` with camelCase serialization.
- Chapter language normalization: preserve `baseCode`.
- Chapter import:
  - TXT/DOCX import remains single-language unless a future format supplies multiple language columns.
  - XLSX/structured imports must map duplicate semantic language headers to unique internal column codes.
- Add translation:
  - Select by base language.
  - Allocate a unique target column code.
  - Store both target base language and target column code in job signatures/cache.
- Glossaries and AI:
  - Compare glossary language codes to `baseCode`.
  - Continue reading/writing row text by unique `code`.
  - Keep cache keys column-specific where text storage is column-specific.
  - Assistant conversations/cache identity must include the selected source column code as well as row id and target column code, because duplicate source columns can provide different context for the same row and target.
  - AI review prompts should use the semantic base language code/name while review storage, history, and markers continue to use the unique column code.
  - Translation-producing AI actions should apply the same base-language source/target guard as Add Translation unless an explicit same-base alternate-version workflow is added later.
- Duplicated source columns:
  - Treat source selection as column-specific, not language-specific.
  - Use the selected source column's unique `code` for all row reads.
  - Use the selected source column's `baseCode` for semantic language comparisons.
  - Do not treat two source columns with the same `baseCode` as interchangeable.
- Clear Translations and Unreview All:
  - Continue targeting unique column codes.
  - Show duplicate display names such as `Chinese 1` and `Chinese 2` in modal copy and confirmation lists.
  - Clearing or unreviewing one duplicate column must not clear or unreview another column with the same `baseCode`.
- Add / Remove Languages:
  - Preserve `baseCode` when saving.
  - Support adding another empty column for an already-present base language.
- Export:
  - Continue selecting by unique column code.
  - Optionally improve filenames later to use display names for duplicate columns.
- Ruby controls:
  - Use semantic base language instead of raw column code, so `ja-x-2` behaves like Japanese and `zh-Hans-x-2` behaves like Chinese.
- Rendered language metadata:
  - Use semantic `baseCode` for user-agent language behavior such as `lang` attributes, spellcheck locale, typography helpers, ruby controls, and exported HTML metadata.
  - Keep data attributes, row-field keys, selections, history, comments, images, and conflict resolution keyed by unique `code`.

## Implementation Order

1. Add optional `baseCode` to language models in Rust and UI normalization.
2. Add shared helpers for column code, base code, and display label.
3. Add shared duplicate-language allocation and display-numbering helpers.
4. Update imports that can create multiple language columns to allocate duplicate-base columns.
5. Update Add translation to create duplicate-base columns instead of filling empty existing cells.
6. Update Add / Remove Languages to support adding another empty duplicate-base column.
7. Update glossary and AI semantic comparisons to use base codes.
8. Update the language manager to preserve `baseCode`.
9. Add compatibility version gating when duplicate-base columns are written.
10. Add tests for duplicate Chinese/English import, Add translation, Add / Remove Languages, glossary hints, AI translate/review, assistant source switching, clear translations, Unreview All, ruby controls, and export selection.
11. Add smoke coverage for search/replace, target-empty/has-image/has-footnote/reviewed filters, history restore, comments, images, and conflict resolution using duplicate-base target columns.

## Workflow Semantics

### Glossaries With Duplicate Target Columns

- A glossary applies to any target column whose semantic base language matches the glossary target language.
- Example: a Spanish -> Chinese glossary applies to both `Chinese 1` and `Chinese 2` when both have `baseCode: "zh-Hans"`.
- Glossary matching must be target-column-specific:
  - `Chinese 1` highlights use `Chinese 1` row text.
  - `Chinese 2` highlights use `Chinese 2` row text.
  - target-term missing/error states must be computed against the specific target column being rendered.
- Source-language red underlines are also target-column-specific:
  - underline a source term in red when the target column being checked is missing the expected glossary target term;
  - do not underline that source term in red when the target column being checked contains the expected glossary target term;
  - if duplicate target columns disagree, the source underline state follows the active/rendered target column rather than becoming one global source-row state.
- Cache keys must include the unique column code, not only the base language code.
- Source/target semantic checks should compare glossary language codes against `baseCode`.
- Row text reads and highlight map keys should keep using unique `code`.

### AI Translate All With Duplicate Target Columns

- AI Translate All treats duplicated target columns as separate translation targets.
- A user may translate into `Chinese 1`, `Chinese 2`, or both, depending on visible/selected columns and empty-cell state.
- Fill-empty-only applies per unique target column.
- Progress and cache keys must be keyed by unique target column code.
- Prompt language labels should use the semantic base language name, e.g. `Chinese`.
- UI labels should use the display column name, e.g. `Chinese 2`.
- Glossary prioritization and glossary hint lookup should use base-language comparisons, but read/write text from the unique target column.

### Derived Glossaries With Duplicate Target Columns

- Derived glossary results are column-specific because duplicate target columns may contain different translations.
- If the active target is `Chinese 2`, derived glossary context must use `Chinese 2` text, not `Chinese 1`.
- Cache keys must include:
  - source column code,
  - glossary source column code when applicable,
  - target column code,
  - relevant row text hashes.
- Semantic eligibility checks should use base codes.
- Row reads, writes, and cache identity must use unique column codes.
- Batch derive workflows should either:
  - derive separately for each matching target column, or
  - make the target column selection explicit.

### Duplicate Source Columns

- Duplicate source columns are supported only as distinct source columns.
- The selected source column is authoritative for a workflow.
- AI Translate All, AI Review, Add Translation alignment, Assistant context, and glossary/derived-glossary workflows must read source text from the selected source column's unique `code`.
- Semantic checks use the selected source column's `baseCode`.
- Do not treat `Spanish 1` and `Spanish 2` as interchangeable just because both have `baseCode: "es"`.
- Source selectors and UI labels must show display names such as `Spanish 1` and `Spanish 2`.
- Add Translation should block same-base source/target pairs by default, even when the unique column codes differ, e.g. block `Spanish 1 -> Spanish 2`.
- AI Translate, AI Translate All, and Assistant translation actions should follow the same same-base guard unless the user explicitly opts into a future alternate-version workflow.
- Supporting same-base alternate-version workflows should be a separate explicit feature, not implicit translation behavior.

### Batch Editor Operations

- Clear Translations remains a multi-column destructive operation over unique column codes.
- The language checklist and confirmation list must use display names, not only base language names, so duplicate columns are distinguishable.
- Backend `update_gtms_editor_row_fields_batch` calls keep unique column field keys and must leave same-base sibling columns untouched.
- Unreview All remains a target-column operation over one unique column code.
- Backend `clear_gtms_editor_reviewed_markers` calls must only clear markers for the selected unique column code.
- Tests should cover clearing and unreviewing `Chinese 2` while `Chinese 1` remains unchanged.

### Assistant Source Identity

- Assistant context reads source text from the selected source column's unique `code`.
- Assistant thread/cache keys must include selected source column code, target column code, and row id.
- When the user switches from `Spanish 1` to `Spanish 2` for the same row and target, the assistant should open a distinct thread or reset to a no-thread state rather than reusing stale source-context conversation history.
