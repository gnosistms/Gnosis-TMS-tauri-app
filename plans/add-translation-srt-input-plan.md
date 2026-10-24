# Add translations SRT input

## Plan

1. Extend the non-mutating translation text extractor to reuse the existing SRT
   parser, extracting only subtitle text in file order. Keep existing encoding,
   size, malformed-input, empty-text, and alignment-unit validation.
2. Allow SRT in the Add translations native/browser pickers and drop validation,
   and update the modal's supported-format guidance.
3. Add focused backend extraction and frontend input regressions, then run the
   relevant Rust tests, frontend tests, and unused-export audit.

SRT input contributes text to the existing alignment workflow. Existing chapter
structure and timing remain authoritative, as with other translation uploads.

## Verification

- Implemented SRT extraction using the existing subtitle parser and enabled SRT
  in picker filters, browser acceptance, drop validation, and modal guidance.
- All 77 Rust chapter-import tests passed, including SRT extraction of multiline
  cues, UTF-8 BOM/CRLF and UTF-16 LE/BE, malformed/empty input, and unit limits.
- All 31 focused Add translations flow/renderer tests passed. Changed JS files
  pass ESLint and the diff passes whitespace checks.
- All 2,908 frontend app/screen tests passed. The 25 workflow tests also passed
  when rerun with local port access: the initial sandboxed run blocked test
  servers with `EPERM` and caused four dev-launcher failures.
- `npm run audit:unused` reports existing unused files/exports and unresolved
  imports outside the changed files; no findings involve Add translations.
- Native macOS/Windows picker interaction has not been manually exercised;
  native file selection and Windows-style dropped paths are covered by flow tests.
