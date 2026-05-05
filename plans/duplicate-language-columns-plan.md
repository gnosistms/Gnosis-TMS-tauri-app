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
- Add / Remove Languages:
  - Preserve `baseCode` when saving.
  - Support adding another empty column for an already-present base language.
- Export:
  - Continue selecting by unique column code.
  - Optionally improve filenames later to use display names for duplicate columns.
- Ruby controls:
  - Use semantic base language instead of raw column code, so `ja-x-2` behaves like Japanese and `zh-Hans-x-2` behaves like Chinese.

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
10. Add tests for duplicate Chinese/English import, Add translation, Add / Remove Languages, glossary hints, AI translate/review, ruby controls, and export selection.
