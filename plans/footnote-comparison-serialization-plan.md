# Footnote comparison serialization mismatch (review + history panels)

## Problem

Since PR #250 ("Preserve footnote markers during AI review"), the AI review flow
stores footnotes in the persisted labeled serialization
(`serializeEditorFootnotesForLegacy`, e.g. `[1] text\n\n[2] text`), which is also
the format stored on disk and returned by the Rust history command. But the
screen model's `section.footnote` is the plain-text join
(`editorFootnotesPlainText`, no `[N]` labels). Several comparisons and diffs mix
the two formats, so for any row with two or more footnotes (or one footnote with
a marker other than 1):

1. **Review panel — AI review staleness.** `translate-review-pane.js` calls
   `resolveVisibleEditorAiReview` with `activeSection.footnote` (plain), which
   never equals `aiReview.sourceFootnote` (labeled). Every completed review is
   immediately marked stale: "The text changed since the last AI review."
2. **Review panel — Current text diff.** `currentEntry.footnote` (plain) is
   diffed against committed history entries (labeled), so the `[1] [2] [3]`
   labels render struck-through as if deleted, and the "Current text" section
   always shows as changed.
3. **History panel — Current marking.** `editorHistoryEntryMatchesSection`
   compares entry footnote (labeled) to section footnote (plain), so no entry
   is ever marked "Current".
4. **Pending local save entries.** Optimistic history entries are built with the
   plain-text footnote, so they never compare equal to the committed entry that
   lands for the same save, and their diff against committed entries shows the
   same label artifacts.
5. **Restore reconciliation.** `editorRowMatchesHistoryPayload` compares the
   plain-text row footnote to the restore payload footnote (labeled).

## Fix

Canonical rule: any footnote value that is compared with or diffed against a
persisted/history/AI-review footnote must be produced by
`serializeEditorFootnotesForLegacy`.

- `src-ui/screens/translate-review-pane.js` — build the current footnote via
  `serializeEditorFootnotesForLegacy(activeSection?.footnotes ?? activeSection?.footnote ?? "")`
  and use it both for `currentEntry.footnote` and the
  `resolveVisibleEditorAiReview` call.
- `src-ui/app/editor-history.js` — in `editorHistoryEntryMatchesSection`,
  serialize the section side the same way before comparing.
- `src-ui/app/editor-history-state.js` — build optimistic entries with
  `serializeEditorFootnotesForLegacy(row.footnotes?.[languageCode])`; use the
  same serialization on the row side in `editorRowMatchesHistoryPayload`.

Display note: "Current text" and pending-save entries will now render footnotes
with their `[N]` labels, matching how committed history entries already render.

## Tests

- Review pane: a ready review whose `sourceFootnote` is the labeled
  serialization of the section's multi-footnote list is NOT stale; a genuinely
  edited footnote still is.
- `editorHistoryEntryMatchesSection`: labeled entry footnote matches a section
  carrying the equivalent `footnotes` array.
- Optimistic entry builder: multi-footnote row produces the labeled
  serialization.

Out of scope: search/filter uses of the plain footnote text, footnote display in
editor row cards, and the Rust side (already canonical).
