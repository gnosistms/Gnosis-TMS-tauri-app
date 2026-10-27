# Vellum-style PDF layout

## Agreed target

Use the Vellum style in the supplied feedback screenshots, not the alternate style
in the A5 reference PDF. The latter establishes physical A5 proportions. Retain
Crimson Pro body, Alegreya headings, and the existing decorative initial/flourish.
Treat differences in content, caption length, and omitted publisher logos separately.

- Body: approximately 11.5 pt, 15.5 pt baseline spacing, justified text with a more
  open word rhythm. Tune with the same prose at A5; avoid blanket letter tracking.
- Traditional first-line paragraph indents without extra inter-paragraph gaps;
  omit the indent after chapter openings, headings, separators, and images.
- Lighter subheadings; smaller upright quotations with uppercase right-aligned
  attribution, preserving explicitly authored inline emphasis.
- Smaller centered italic captions with a larger image-to-caption gap.
- More spacious chapter openings, automatically numbered in included book order.
- Running headers: author on left pages, book title on right pages. Omit them on
  title pages, front matter, chapter-opening pages, and inserted blank pages.
- Title pages use uppercase title/subtitle presentation and a flourish; publisher
  logos remain supplied by the user.
- Contents include chapters by default. Add an off-by-default checkbox to include
  H1 headings, excluding a leading H1 already promoted to the chapter title.

## Implementation

1. Persist the contents checkbox per-language in the book composition and pass it
   to native export. Keep existing saved layouts compatible and add focused tests.
2. Share numbered book-entry metadata between PDF chapter openings, contents, and
   composer preview. Resolve H1 contents targets against final pagination.
3. Refine shared chapter PDF typography and A5 geometry. Implement running headers
   using final chapter page ranges so front matter and blank pages remain clear.
4. Compile representative multi-chapter A5 fixtures, inspect whole pages/crops and
   measure typography. Verify contents targets, header exclusions, numbering,
   caption fit, footnotes, and unchanged image-cache reuse.
5. Run relevant frontend/native/browser tests, strict lint, formatting, and build.

## Result and validation

Implemented shared PDF typography: 11.5 pt Crimson Pro with measured 15.56 pt body
baseline spacing, modestly wider word spaces, 1.5em first-line indents, lighter
Alegreya headings, upright 90%-size quotations, uppercase attribution, and centered
75%-size italic captions. A5 uses mirrored 22mm inner / 19mm outer margins.
Paragraph spacing is calibrated to Typst's text-edge metrics so crossing a normal
paragraph boundary has the same baseline distance as a wrapped line; front matter
retains the separately agreed extra paragraph space.

Book chapters are numbered from included order. Header labels come from the title
page's author/title (with the project title as fallback). Final chapter page ranges
exclude chapter openings, all non-chapter sections, and inserted blank pages.
The contents checkbox persists per language, defaults off, previews H1 entries, and
refreshes when chapters are re-included. Native H1 targets move with their headings
and omit a leading H1 already promoted to the chapter title.

Validation:
- Full frontend suite: 3,118 tests passed; workflow suite: 25 passed.
- All 57 native PDF tests passed, including image-cache regressions.
- Three focused Chrome workflows passed; the extended H1 include/exclude/re-include
  case also passed. Inspected the checkbox/contents preview screenshot.
- Both book and standalone chapter PDFs compiled with the bundled offline Typst
  runtime and cached fonts. Inspected chapter, ordinary body, quote, image/caption,
  title, and contents pages.
- Programmatic checks of the 29-page A5 proof verified every header exclusion and
  alternating label, 1.5em indents, regular paragraph baseline spacing, H1-only
  contents entries, 8.625pt captions, and clickable contents targets [5, 5, 25].
- Production Vite build, changed-module ESLint, strict library Clippy (-D warnings),
  Rust formatting, and whitespace checks passed.

Review proof (sample text): /private/tmp/gnosis-vellum-style-a5.pdf.

Status: complete.
