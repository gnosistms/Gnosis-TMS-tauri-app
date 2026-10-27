# Project export book composer

## Goal
Replace the single project export screen with a two-page workflow. Page 1 chooses
the book's language, included items, order, and front matter, with a preview/editor
alongside the item list. Page 2 retains the export destinations and format settings.
Single-chapter export keeps its existing workflow.

## Confirmed requirements
- All active project chapters are included initially, using project-list natural
  alphabetical order. Excluded items appear in a separate lower section, hidden
  when empty. Included items can be reordered with glossary-style drag handles.
- A language picker offers the union of chapter languages. The initial selection
  is the first chapter's target language. Missing-language chapters are excluded
  automatically and cannot be included, with the specified standard tooltips.
- Chapter previews reuse the existing preview rendering on a light cream page.
- Users can insert a title page, dedication, table of contents, and copyright page.
  Added sections participate in selection, ordering, and inclusion/exclusion.
- Title-page title, subtitle, author, translator, and publisher logo are editable
  per language. Title defaults to the project title. Publisher logos support native
  file selection/drop and the editor's existing image removal control.
- Dedication content and contents title are editable per language. Contents entries
  reflect included items, excluding title/copyright/contents pages. The latest
  contents title is also stored locally as the default for that language across
  future books.
- Changes persist immediately in local app storage, without a settings Save button.
- Real chevron icons navigate Next and Previous at the top of the modal.
- Book chapters and standalone chapter exports share the same chapter typography,
  title ornament, leading-heading behavior, drop caps, and image/footnote rendering.

## Clarified decisions
- Each language has a separate saved layout and section content.
- Start alphabetically; preserve drag order. Re-include after the nearest lexical
  predecessor, ignoring special sections. Default front matter: title, copyright,
  dedication, contents. Full-page images can be inserted repeatedly.
- Copyright uses a limited text/newline/italic editor, copyright-symbol button,
  and the existing chapter flourish. It aligns at the bottom of the PDF page.
- Full-page image sections have validated image pick/drop and an optional caption.
- PDF is primary; preserve structure in DOCX and Vellum where supported. Other
  formats are fallback representations. Remove team copy from project export.
- Follow Pressbooks/Chicago front-matter ordering and Vellum spread conventions:
  copyright starts verso; other front matter and chapters start recto, with
  blank pages inserted when necessary. Respect the user's custom item order.
- Sources: https://guide.pressbooks.com/chapter/create-and-edit-front-matter/
  and https://faq.vellum.pub/blank-pages-in-pdf/ (consulted 2026-10-26).

## Implementation sequence
1. Add a project-scoped composition model and versioned, per-login local persistence
   using `persistent-store.js`. Reconcile saved item IDs with new/deleted chapters.
   Persist format/options on changes as well as composition/section text. Never
   persist connection passwords or other credential-entry fields in export settings.
2. Render the two-page modal. Reuse the existing glossary drag-handle/dots/drop
   indicator CSS, standard tooltip attributes, shared modal controller, editor image
   removal icon, and chevron assets. Add a focused pointer-drag controller for book
   items without changing glossary behavior. Preserve editing focus while saving.
3. Load selected chapter previews through native chapter reads, with stale-request
   guards. Front-matter editing and saved language values remain local to the app.
   Import publisher images into managed local export assets through Rust commands.
4. Pass the exact ordered composition into native exports and preview serializers.
   Render a real contents list/page references where the format supports them.
   Retain format-specific provenance rules and the existing background PDF job,
   cancellation, font inspection, and font-review flows.
5. Refactor PDF chapter layout into one shared renderer used by standalone chapters
   and each chapter in a book. Apply the chapter-title and drop-cap rules independently
   to every chapter. Keep chapter images within their chapter's layout boundaries.
6. Validate persistence/reconciliation, drag order, language gating, section editing,
   contents inclusion, image handling, actual composed exports, shared chapter style,
   and unchanged standalone exports with unit/native/browser tests and visual QA.

## Current investigation
- Glossary variant drag: `app/events/glossary-term-variant-drag.js` and shared
  `.term-variant-row*` styles in `styles/modals.css`.
- Existing export defaults store only the successful option/destination, so immediate
  project-settings persistence needs a separate normalized composition record.
- Current book export emits internal chapter headings, while the standalone PDF
  renderer applies title ornaments/drop caps once per document. Sharing the complete
  chapter renderer is required to meet the requested typography invariant.

## Validation
Implemented and verified:
- 3,109 frontend tests passed in the full run; 137 focused tests passed after the
  final changes, including the multi-element Vellum archive tests.
- Three Chrome browser checks passed for the two-page workflow, real pointer drag,
  unavailable-language exclusions, separate saved layouts, title/front-matter edits,
  immediate preferences, image picking, and the exact final export order.
- 55 chapter/document export tests and the dedicated book image validation test passed.
  The PDF module suite passed, including generated-source checks for shared chapter
  typography and contents at the back of the book.
- Compiled a real 25-page PDF using the bundled offline Typst runtime and vendored
  drop-cap package. Verified final page locations programmatically, then rendered
  and visually inspected every page: title sizing/logo, bottom-aligned copyright,
  flourish, dedication, blank spread pages, both chapter openers/drop caps,
  full-page image/caption, and back-of-book contents with final page references.
- The production build and changed-module ESLint/whitespace checks passed. The
  unused-code audit flagged no new book/export modules or exports.
- The initial live Vellum UI check timed out. The follow-up below successfully
  verifies native pasting, previews, contents links, and save/reopen behavior.

## Final behavior
Each language keeps its own arranged items, manual exclusions, and section content.
Options save immediately in local account-scoped app storage; no settings are
written to Git. The canonical contents spelling is remembered across projects for
the selected language. Images live in managed local app storage and use the same
size/signature validation as editor images, with additional checks for SVG content.

PDF contents references use Typst metadata/query locations from the final layout,
so the contents can be moved anywhere without guessed page numbers or extra export
jobs. PDF chapters invoke the exact standalone chapter renderer. PDF is the full
book layout; DOCX supplies section breaks and updating page-reference fields;
Vellum supplies ordered elements; other formats are simplified fallbacks.

## Live Vellum verification follow-up

The native app is now reachable. A synthetic six-element book pasted into a
separate `/tmp` Vellum document in the arranged order. Chapters, copyright and
dedication were recognized; `titlepage` and `tableOfContents` are not valid typed
text element names and silently become Uncategorized. Vellum-authored clipboard
capture confirms contents require `OGTableOfContents`; native title pages instead
read receiving-book metadata and do not carry the exported title/author text.

Follow-up steps:
1. Extend the opt-in native clipboard smoke check to write/read book elements and
   capture a Vellum-authored reference without touching user books.
2. Export contents using Vellum's native class so links/page references regenerate.
   Preserve custom title-page text as a formatted, unnumbered text element because
   Vellum's native title page is bound to receiving-book metadata.
3. Paste the corrected output into the scratch book and verify order, content,
   italics, native contents behavior, and persisted structure; add regressions.

The live image test also exposed an existing clipboard-image bug directly affecting
book export: preparation clears the actual `co.180g.Vellum` temporary workspace,
including Vellum's active preview resources. Isolate Gnosis's image workspace under
`gnosis-tms-vellum/co.180g.Vellum` while retaining the archive's expected directory
shape. Repeat image preparation and live paste after restarting the scratch preview.

### Live verification result

- Pasted seven generated elements into Vellum 4.1.7 in a separate scratch book:
  title/subtitle/author/translator/logo, copyright with italics, dedication, two
  numbered chapters, illustration/caption, and contents at the end.
- Corrected contents is recognized as native Table of Contents; following its
  Second Chapter link navigates to the matching chapter preview. It is enabled
  for both ebook and print. No static chapter/page list is archived for it.
- Images render, are embedded in the saved `.vellum` ZIP, and still render after
  closing/reopening the document and after the Gnosis image workspace is cleared.
  Vellum's own preview workspace now remains intact during image preparation.
- Compatibility limit: the exported title is a formatted unnumbered text element;
  Vellum's special native Title Page always uses the receiving book's metadata.
  Native contents follows Vellum's listing rules (it lists this text title and
  omits dedication); PDF/DOCX retain the composer-defined contents membership.
  Full-page images use an unnumbered image-bearing text element in Vellum.
- Focused JS checks: 72 passed. Native clipboard suite: 7 passed, 3 opt-in smoke
  checks ignored in the routine suite; all three smoke checks also run explicitly
  during this verification and passed. Changed-module ESLint and whitespace pass.
- Scratch document: `/tmp/gnosis-book-export-verification.vellum`.

## PR validation on isolated main-based branch

Only the 44 project/book-export files from this chat are included. Unrelated local
work remains in the original checkout. The final branch passes:
- 3,042 frontend tests and 25 workflow tests.
- 907 native tests (13 opt-in checks skipped in the routine suite), plus a real
  25-page Typst book compilation that verifies final contents page references.
- All four project-export browser checks, including loading Save and scrolled
  WordPress tooltip visibility, using the real navigation with mocked native data.
- Strict Rust Clippy, Rust formatting, production frontend build, and npm license
  validation. Frontend lint has no errors; existing warnings remain.
- The unused-code audit has existing findings only; no new export findings remain.

Follow-up polish keeps Save visible with a disabled spinner during font inspection,
uses shared tooltips throughout the modal, and positions the WordPress forget hint
inside its list row so it is not clipped. Required hosted CI is checked before merge.
