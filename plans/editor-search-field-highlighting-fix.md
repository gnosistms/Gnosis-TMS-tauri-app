# Highlight editor search matches in every text field

## Plan
1. Trace search sections, match coordinates, and rendering for body text, individual footnotes, and image captions, including open editors and read-only fields.
2. Reuse the existing sanitized search-highlighting pipeline in each field, preserving inline markup, glossary highlights, authored newlines, and separate footnote identities.
3. Add regressions for body, multiple footnotes, and image captions, plus browser coverage for editable and read-only rendering. Validate, commit the focused correction to PR #371, and merge after the updated checks pass.

## Validation
- Search already included attachments, but their closed renderers skipped marks and their open editors lacked search layers.
- Closed fields reuse sanitized inline rendering with search ranges. Mounted attachment updates match the owning row and individual footnote marker, keeping note offsets independent and preserving change diffs.
- New unit regressions fail on the previous renderer and pass with the correction.
- All 2,992 frontend tests and 25 workflow tests pass. Nine focused browser checks pass across formatting shortcuts, footnote spacing, and search highlighting (seven existing PR cases and two new search cases, run in two batches).
- Browser coverage includes body, multiple footnotes, captions, attachment-only queries, case sensitivity, clearing queries, and live typing in both attachment editors without losing focus. Screenshots of closed fields and editing overlays were visually inspected.
- Production build and scoped lint pass (one pre-existing unused argument warning).

- A final typing regression catches leading spaces in an open footnote. Search overlays use the current textarea value so normalization cannot shift the highlights; this fails before the refinement.
