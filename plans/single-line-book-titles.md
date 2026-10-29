# Single-line book titles outside the title page

Line breaks typed into the title-page Title field are layout choices for that
page only. Every other place an export names the book or a section uses the
title as one line.

1. Add one shared Rust helper that joins a title's lines with single spaces.
2. EPUB: take `dc:title` from the title page (falling back to the project title,
   as the PDF running header already does) and flatten it; flatten the section
   `<title>` elements and navigation entries too. The title page body keeps
   its `<br/>` breaks.
3. PDF: use the shared helper for the running-header title.
4. Vellum: flatten element titles (the title page element name); the title page
   text itself keeps its breaks.
5. Cover the EPUB metadata/navigation/title page and the Vellum element title
   with tests; run the native export tests and frontend tests.

## Implemented

`book_title` and `single_line_title` in `book_export.rs` are the one rule. The
EPUB `dc:title` now comes from the title page (project title as fallback), and
it, the navigation entries, and the section `<title>` elements are one line; the
title page body keeps `<br/>`. The PDF running header uses the same helpers.
Vellum element titles are one line; the title-page subhead keeps its break.

Validation: 160 native export tests, 3,245 frontend tests and 26 workflow tests
pass; strict all-target Clippy, Rust formatting and ESLint pass.
