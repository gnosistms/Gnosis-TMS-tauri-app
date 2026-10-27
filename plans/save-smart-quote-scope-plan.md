# Scope save-time smart quotes to the columns being saved

## Status (2026-09-06)

Implemented (see commits "Scope save-time smart quotes to changed columns"
and "Log skipped batch translations for changed rows").

## Problem

`normalizeEditorRowForPersist` (`editor-persistence-flow.js`) ran
`smartenInlineMarkupQuotes` over **every** language column of a row on every
save, whichever column the save was about. Saving a generated pivot text (or
any other column) therefore rewrote sibling columns — the translate source, a
teammate's language, text imported with straight quotes — from `It's` to
`It’s` in state and in the commit.

Every "did the text change under me?" comparison in the AI flows is a raw
string comparison against a snapshot taken before such a save, so all of them
failed after any save of the same row:

- Translate All batch apply (`editor-ai-translate-all-flow.js`,
  `applyBatchRowResult`) — the field bug: rows containing apostrophes came
  back empty in a 982-row subtitle chapter.
- Single-row AI Translate (`editor-ai-translate-flow.js`, post-call guard).
- AI Review staleness (`editor-ai-review-state.js`), translate action
  staleness (`editor-ai-translate-state.js`), derived-glossary source checks.

A first fix re-snapshotted the batch entries right before the AI call. A code
review showed it fixed one of at least six sites, and changed the prompt
(the refreshed row leaked generated pivot text into `alternateLanguageTexts`).

## Fix

- `editorRowChangedLanguageCodes(row)` in `editor-row-persistence-model.js`:
  the language codes whose field, footnotes, or caption differ from the
  row's persisted values. Rows without persisted tracking report every
  column, preserving the old behaviour for them.
- `normalizeEditorRowForPersist` smartens only those columns. Footnote
  normalization is unchanged.
- The batch-path re-snapshot is removed; the source-changed skip keeps a
  console warning (with `rowMissing`) because a silent skip was what made
  the original bug take hours to diagnose.

## Tests

- `editor-persistence-flow.test.js`: saving one column leaves sibling columns
  byte-identical; rows without persisted tracking are fully smartened.
- `editor-row-persistence-model.test.js`: `editorRowChangedLanguageCodes`.

## Not changed

Imported straight-quote text is no longer migrated to curly quotes as a side
effect of saving another column; it converts when that column itself is
edited and saved.
