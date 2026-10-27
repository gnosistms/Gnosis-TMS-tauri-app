# EPUB export

## Goal
Add EPUB to file exports for both individual chapters and composed project books,
using the existing local snapshot and native save flow.

## Design
- Write EPUB 3 packages in Rust with the existing ZIP, XML, image, UUID, and date
  dependencies; do not introduce a separate conversion executable.
- Reuse the shared export document, preserve book order and chapter numbering,
  generate linked navigation, and carry title/language/available author metadata.
- Serialize valid XHTML with inline formatting, ruby, links, separators, captions,
  and linked footnotes. Flatten custom HTML to readable text, with the existing
  omission option, so arbitrary HTML cannot invalidate an ebook.
- Embed uploaded and public URL images for offline reading, converting WebP to PNG
  for reader compatibility; fail clearly if a referenced image cannot be included.
- Add EPUB to the file-format picker and native save filter. Remember successful
  choices through the existing defaults path.

## Steps
1. Implement and test a native EPUB renderer and register it in file export routing.
2. Add the format to the export UI and cover chapter/project command payloads.
3. Run focused Rust/frontend checks, then required repository checks; record results.

## Verification
- Inspect ZIP order/compression, required container/package/navigation files,
  manifest/spine links, XML parsing, text/language escaping, and reading order.
- Exercise formatted/ruby/multilingual content, repeated footnotes, chapter
  numbering/contents links, local images, WebP conversion, and image failures.
- Run frontend export flow/modal tests, npm test, unused-export audit, and build.

## Progress
- Complete: native renderer, chapter/book routing, picker/save filter, and regression
  coverage implemented without adding dependencies.
- Preserves numbering, front matter, ruby/inline styles, linked navigation and
  footnotes, offline images, and RTL reading direction. The EPUB pane explains the
  custom HTML conversion/omission policy.

## Verification results
- `npm test`: 3,179 frontend tests and 25 workflow tests passed. Workflow tests
  require local child-server access and were rerun successfully outside the sandbox.
- Related Rust suite: 390 passed, 7 ignored; includes 6 new EPUB regression tests.
- W3C EPUBCheck 5.4.0: five generated samples (multilingual formatting/ruby,
  footnotes, composed book, converted/embedded images, Arabic/custom HTML) each
  validated with zero errors and warnings.
- Production build, focused ESLint, Rust formatting, and `git diff --check` passed.
- Unused-export audit completed with 345 unused-file and 32 unused-export findings
  elsewhere in the existing workspace; no findings in the changed frontend files.
- For future conformance checks, set `GNOSIS_EPUB_FIXTURE_DIR` when running the
  EPUB Rust tests to save the tested archives for EPUBCheck.
