# Editable project export chapter titles

- Resolve each language's default chapter title from a leading H1, otherwise the
  chapter name displayed in Projects. Load defaults without changing source rows.
- Make chapter titles editable in the page-one list and persist overrides in the
  existing per-language layouts. Keep selection, focus, ordering, and exclusions.
- Apply the same resolved titles to the chapter preview, contents, native book
  exports, and clipboard/Vellum fallbacks, retaining shared chapter styling.
- Verify leading-H1 versus filename defaults, language isolation, persistence,
  and export output with focused unit, browser, and native tests.

Keep all work local for the combined next release; do not bump or publish.

## Verification

- Five project-export browser scenarios passed, including sequential typing,
  opening-H1 versus Projects-name defaults, per-language edits, reopen persistence,
  contents labels, DOCX input, and adding/editing front matter after title edits.
- Reviewed the screenshot of the editable list and matching chapter preview.
- Native title/DOCX and chapter export tests passed; the real book PDF compile
  passed with an overridden source H1 and contents placed after the chapters.
- ESLint and diff whitespace checks passed. The unused-code audit reports only
  existing findings outside these changes.

Unrelated follow-up: Vellum's existing heading-attachment renderer can omit notes
on headings. This change verifies title selection for those headings and leaves
that renderer unchanged.
