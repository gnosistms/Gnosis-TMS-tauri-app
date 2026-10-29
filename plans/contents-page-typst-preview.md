# Contents page preview from the PDF typesetter

The title page already previews actual Typst output. Give the table of contents
the same treatment so step 1 shows exactly what the PDF prints, and show
"Rendering…" with a spinner on both pages while Typst works.

Page numbers may be approximate: images are not prepared for the preview.

1. Generalize the title preview job into a book page preview (title and
   contents): one command, one event, superseded jobs cancelled, temporary
   workspaces removed, the active export image cache untouched.
2. Contents page numbers come from a text-only pagination pass over the whole
   book, loaded from the local repo exactly as export loads it. The pass reuses
   the export renderer with images as placeholders (never downloaded or
   decoded), no drop caps and no footnote styling, and reads every contents
   entry's page plus the contents' own starting page with `typst eval`.
   Cache results per book scope, paper, language and repo HEAD so typing in the
   contents title never re-paginates. Concurrent requests share one pass.
3. Render the contents page alone from those numbers through the same
   `gnosis-contents` layout the PDF uses (factored into a literal-entry variant),
   with the page counter set to where the contents falls in the book.
4. Step 1 shows the contents as a form (title, Include H1 headings) beside the
   rendered page, like the title page. Both pages show "Rendering…" and a
   spinner while waiting; stale pages stay dimmed until replaced.
5. Cover pagination parity with the PDF, cache/dedupe, stale responses, the new
   pane, and existing export workflows. Measure the pass on a real book.

## Implemented

- `start_project_book_page_preview` / `book-page-preview` replace the title-only
  job (`page_preview.rs`). Title pages compile as before; contents requests carry
  the book scope and render through `gnosis-contents-entries` with literal
  entries, the book's numbering style, and `#counter(page).update(n)`.
- `TypstLayout::TextOnly` prepares every image as an empty placeholder (never
  fetched), skips drop caps and section images, and appends a metadata rule read
  with `typst eval`. Export output is unchanged: `gnosis-contents` is now
  `gnosis-contents-entries` fed by the queried entries.
- Pagination is cached (4 entries) by repo HEAD plus the normalized book scope,
  language and paper, with the contents title and H1 choice left out of the key.
  Concurrent requests for one key share one pass (`OnceCell`).
- Step 1 shows both proof pages as a form beside the typeset page, with
  "Rendering…" and a spinner while waiting and a dimmed stale page until the
  new one arrives.

## Verified

- Real book (35 Vietnamese chapters, ~400 A5 pages): the text-only pass takes
  0.87–0.93 s after about 1 s of chapter loading in a debug build. Later title
  edits only compile the single contents page.
- The proof contents page is byte-identical (PNG `cmp`) to the contents page
  typeset inside the full book, including roman footers and mirrored margins.
- `cargo test` (1003 passed), the real-Typst PDF export tests, Clippy with
  `-D warnings`, `npm test`, and `tests/browser/project-export.spec.js` (41)
  pass.
- Not yet checked in the native app: `tauri:dev` refuses to start until this
  branch includes v0.8.138.
