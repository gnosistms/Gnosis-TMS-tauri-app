# Complete, linked footnotes in HTML export

## Problem

HTML clipboard export writes WordPress citation markup and an empty dynamic
footnotes block. The note bodies only travel in post metadata on direct WordPress
export, so a standalone HTML reader never receives them.

## Design references

- Standard Ebooks: superscript citations, numbered notes, and a return arrow to
  the original citation: https://standardebooks.org/manual/1.8.2/7-high-level-structural-patterns
- Project Gutenberg / Distributed Proofreaders: collected notes with reciprocal
  links: https://www.pgdp.net/wiki/CSS_Cookbook/Footnotes
- W3C DPUB-ARIA 1.1: `doc-noteref`, `doc-backlink`, and `doc-endnotes` semantics:
  https://www.w3.org/TR/dpub-aria-1.1/

Use native anchors with descriptive accessible names and focusable note targets.
Keep the export usable without scripts or external styles. Preserve inline note
formatting and links. Repeated markers within a row are preserved by the editor, although Insert
Footnote always creates a new note. If a marker repeats, give each citation a
unique target and each occurrence its own return link. Number notes across the
export in citation order; preserve automatic citations for notes without markers.

## Implementation

1. Separate self-contained HTML footnote rendering from direct WordPress metadata
   serialization. Include a visible Footnotes heading and ordered list in a static
   HTML block. Leave direct WordPress and editor preview behavior intact.
2. Update serializer and clipboard regression tests for complete note bodies,
   reciprocal links, repeated citations (including across separators), escaping,
   row-local marker numbering, and exports without notes.
3. Add a browser regression exercising forward/back navigation and keyboard focus
   in the exported HTML. Inspect the rendered fixture, run the affected and full
   unit suites, and check lint and unused-code audit for regressions.

## Verification

- Implemented self-contained HTML notes with a heading, ordered list, native
  bidirectional anchors, accessible labels, and focusable note targets. Repeated
  citations share a body and have individually labelled return arrows. Direct
  WordPress export retains its native block and separate note metadata.
- Affected serializer/clipboard tests: 66 passed. Full app suite: 2,024 passed.
- Workflow suite: 17 passed outside the sandbox (the sandbox prevented the
  existing launcher tests from starting their temporary servers).
- Browser regression: passed in installed Chrome using an isolated profile.
  Verified every fragment target, real scroll in both directions, keyboard focus,
  repeated citation return destinations, and formatting without scripts. The
  Playwright bundled browser was absent, so a temporary config selected Chrome.
  Inspected the browser screenshot of the rendered notes and return arrows.
- Scoped ESLint and `git diff --check`: passed. Unused-code audit has only the
  pre-existing findings: three scripts, five app-update browser imports, and
  `ensureEditorFootnoteEntry`.
