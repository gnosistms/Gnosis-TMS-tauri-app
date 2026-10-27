# Bring step-1 previews close to PDF typography

1. Audit the native print renderer for every element: language-specific font
   stacks and body size, word/line/paragraph spacing, chapter titles/numbers,
   headings, quotes, attributions, centered/indented text, images/captions,
   separators, footnotes, contents, copyright and dedication.
2. Load the same cached PDF fonts in the webview through a background native job,
   scoped to the active preview. Use local asset URLs and the existing font cache;
   preserve offline reuse and avoid remounting editors or changing export output.
3. Add book-only markup/style rules, including paragraph-indent/drop-cap state,
   casing, and footnotes collected near the page foot. Keep generic editor styles
   and serializers unchanged. Title-page preview remains actual Typst output.
4. Compile representative native output, measure and visually compare with the
   browser preview, add focused element coverage and run export regressions.
   Mirror scoped changes into the running dev checkout and update PR 384.

Pagination, floating image placement and exact glyph fallback remain approximate
in the editable HTML previews; font metrics and element typography should agree.


Completed:
- Browser font loading reuses native PDF font assets and language/script selection.
  Metrics come from the actual cached fonts. Requests return immediately; events
  and web fonts are guarded by request, project, language, team and modal session.
- Book-only typography covers body indents, decorative initials, H1/H2 case and
  weight, chapter titles, quotes, attributions, centered/indented text, rules,
  images/captions, footnotes, contents, copyright and dedication. Modern webviews
  use cap-to-baseline text boxes; older webviews retain a line-box approximation.
- Full-page image/caption groups are centered together; captions and contents
  titles wrap naturally while retaining the user's original text and case.
- Verified using an A5 native PDF proof and a browser proof loaded with the same
  actual font files. Measured body, front-matter, caption and footnote leading.
- Checks: 3,084 frontend tests, 25 workflow tests, 61 native PDF tests, all-target
  strict Clippy, formatting, scoped JS lint, build and whitespace checks pass.
  All 19 export browser tests pass on a fresh server. The live dev frontend's
  element-typography check also passes. The long-running dev server still has the
  known test-fixture issue where dynamic imports can select a stale state module;
  the complete suite uses a fresh server to avoid that fixture-only condition.
  Unused-code audit remains at the existing 41 files and 16 exports.
- Native dev app rebuilt and relaunched; all feature sources mirrored into the
  running checkout, preserving unrelated work. Exact pagination and image float
  placement remain outside the HTML preview's scope.
