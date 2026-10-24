# Glossary popup note grouping

## Scope

Clarify the relationship between translations, usage notes, translator notes,
and footnotes in source and target glossary popups.

## Implementation

1. Group global notes under “Note to Translators:”. Label footnotes “Footnote:”
   only when translator notes are also present. Keep insertion hints independent
   of whether a footnote label is shown.
2. Keep labels close to their text, with a larger gap between note sections.
   Render every translation usage note on an indented line beneath its term.
3. Update the existing browser expectation for footnote-only popups, run focused
   tests and lint, and inspect the combined-note and footnote-only layouts in
   Chrome.

Preserve all existing unrelated working changes. No glossary/QA resource model,
storage, permission, or synchronization behavior changes are involved.

## Validation

- 41 focused glossary tests and 3 existing popup browser tests pass.
- ESLint and scoped diff whitespace checks pass.
- Chrome previews verified both note types together, footnote-only,
  translator-note-only, empty notes, and whitespace-only translator notes.
- Measured section spacing is 14px before a label and 4px below it.
  Usage notes are indented 16px beneath their translations in both popup kinds.
