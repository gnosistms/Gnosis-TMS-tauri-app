# Book export review fixes

## Scope

Fix the three reviewed export inconsistencies: optional H1 contents entries and
chapter-only contents, generated chapter numbers in document/clipboard exports,
and missing book image resources in Markdown. Preserve PDF/Vellum numbering and
source chapter content, and keep the dev app current without replacing unrelated
local work.

## Steps

1. Share contents and chapter-number derivation within each stack; apply it to
   native document formats, DOCX links, clipboard, and WordPress. Keep Vellum's
   native element numbering free of duplicate prefixes.
2. Bundle local book images beside Markdown exports and use relative, portable
   links while retaining existing remote image links.
3. Add regression tests for mixed numbered chapters, optional H1 entries,
   excluded front matter, DOCX destinations, and Markdown assets; run required
   frontend/native checks, mirror these changes to the dev checkout, rebuild the
   dev backend, and commit/push focused changes to the integration PR.

## Status

Complete. Native document exports, clipboard, and WordPress use chapter-only
contents with optional indented H1 entries and consecutive chapter numbers.
DOCX includes numbered headings and links H1 contents entries to bookmarks in
the heading paragraphs. PDF/Vellum retain their structural numbering metadata.
Markdown book assets are copied into `<filename>.assets` beside the document;
relative URLs encode spaces and URL punctuation.

Validation:

- 3,095 frontend unit/screen tests and 25 workflow tests passed.
- 937 native tests passed, 13 ignored; strict Clippy and Rust formatting passed.
- All 30 export browser workflows passed (one stale title-card selector updated
  and its workflow rerun).
- Frontend production build and focused ESLint passed; unused-code audit remains
  at the baseline 41 files and 16 exports.
- Export changes mirrored into the dev checkout after checking its files against
  the integration baseline; the native dev app rebuilt and restarted successfully.
