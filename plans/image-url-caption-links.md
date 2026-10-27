# Preserve links in image URL captions

1. Change WordPress caption conversion to retain validated HTTP(S) anchors in the
   editor's canonical inline form, resolving relative destinations from the media
   URL and discarding unrelated attributes and non-content HTML.
2. Preserve existing caption whitespace and generated “More” suffix cleanup. Add
   backend regression tests using the reported LuanXa caption and unsafe/relative
   links, then verify the enriched caption reaches the editor with links intact.
3. Run image import and editor caption tests and review the scoped diff.

Status: complete.

Verified the reported image's live WordPress metadata contains both links. All 39
backend image tests and 30 focused frontend image tests pass. Regression coverage
checks canonical links from the LuanXa response through the export inline parser,
relative destinations, entities, punctuation, unsafe URLs, empty captions, generated
“More” cleanup, and background enrichment preserving current and saved captions.
Focused ESLint, Rust formatting and whitespace checks pass.
