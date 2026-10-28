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

## Follow-up: real-data export failures (2026-10-28)
A user reported EPUB export not working. Rendering every locally cached chapter
(3,260 chapter/language pairs) through the EPUB writer found two EPUB-only faults:
- A remote image that cannot be fetched (expired signed link → HTTP 403, an image
  over 25 MB) aborted the whole export. PDF substitutes a placeholder and DOCX a
  link, so one dead link anywhere in a chapter or book blocked only EPUB.
- WebP was re-encoded as full-resolution lossless PNG. Chapters with ~35 web
  photos became 190–295 MB EPUBs and took close to a minute to write.

Fix:
- Remote image failures (download or undecodable content) render an in-book
  notice naming the host and reason, keep the caption, and the export continues.
  Missing uploaded files still fail clearly, matching PDF.
- Opaque WebP becomes JPEG; WebP with transparency stays PNG so it still works on
  dark reading themes. Any raster above 4 megapixels is downscaled (EXIF
  orientation applied); smaller PNG/JPEG/GIF bytes pass through untouched.

- Images load on six worker threads before rendering (numbered in document
  order), already-compressed rasters are stored rather than re-deflated, and
  `export_gtms_chapter_file` emits `chapter-file-export-progress` for EPUB jobs.
  The export modal shows "n of N images" with the PDF progress bar while saving.

Results:
- Real-data probe: 3,249 of 3,260 exports succeed (was 3,247). The 11 remaining
  failures are uploaded images missing from the local repos (rows point at flat
  `chapters/<id>/images/<name>` paths whose files are still in the old nested
  layout); PDF fails the same way, so that is a separate data repair.
- HNHH chapter 07-p2 (vi): 294 MB → 43 MB. Whole HNHH vi book, 92 images:
  31.6 s in a debug build with steady progress, 114 MB (86 JPEG, 5 PNG).
  All generated archives: 1.5 GB → 470 MB.
- EPUBCheck 5.4.0: 3,250 archives (every probe output plus the HNHH book), 0
  errors or warnings.
- Rust EPUB tests: 10 passed. `npm test`: 3,229 frontend and 26 workflow tests
  passed. ESLint clean; clippy reports nothing in the changed files; unused-export
  audit unchanged (345 files, 32 exports, none in changed files).
