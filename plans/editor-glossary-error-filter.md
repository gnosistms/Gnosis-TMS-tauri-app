# Has glossary error editor filter

## Implementation

- Add `has-glossary-error` / “Has glossary error” immediately after “Has conflict”.
- Expose `hasErrors` on glossary highlight results using the existing red-mark decision.
- Inject a row predicate from the screen model into the filter layer. Cache
  lightweight direct/derived match diagnostics separately from viewport HTML,
  evaluating them only when this filter is effective, including offscreen rows.
- Preserve search intersection, deleted-row exclusion, conflict precedence,
  counts, and existing render/scroll behavior. No backend or storage changes.
- Keep matching semantics and no-translation exemptions unchanged. Without a
  glossary, matching source term, or target column, no row qualifies.

## Validation

- Cover missing/alternative/empty targets, mixed matches, no-translation,
  overlaps, markup, and direct/derived highlight merging.
- Cover filtering with search, deleted rows, conflict precedence, and chapter
  rows outside the viewport; edits and glossary replacement refresh membership.
- Run the unit/workflow suite and unused-export audit; smoke-check dropdown,
  filtering, and scroll restoration in the available UI test environment.

## Status

Implemented, including both review fixes:

- Exclude custom-HTML rows using the renderer's text-style predicate.
- Retain one diagnostic result per chapter row, invalidate changed text/models,
  and prune deleted entries when the chapter rows change.
- Share match evaluation and direct/derived merge precedence with highlights,
  skipping HTML/tooltips in diagnostic mode.
- Resolve a single derived entry and accept the already-known row, avoiding
  whole-map normalization and repeated chapter-row searches.
- Add regression coverage for more than 400 rows, derived-entry lookup work,
  cache invalidation, custom HTML, and diagnostic/highlight parity.

Validation:

- All 2,159 application tests and 23 workflow tests passed with `npm test` in the isolated PR worktree
  outside the sandbox (required for launcher tests' local servers).
- Both Chrome browser smoke tests passed with macOS and Windows fixture modes:
  offscreen errors, red highlights, search intersection, and scroll restoration.
  This does not constitute native Windows or Tauri testing.
- ESLint for changed application/test modules and `git diff --check` passed.
- On the same local review fixtures, unchanged model builds improved from
  roughly 450 ms to 4–5 ms for 3,000 rows, and from roughly 650 ms to 3 ms for
  800 rows with derived glossaries. These are local benchmark observations;
  regression tests assert reuse and bounded lookup work without timing limits.
- The unused-export audit reports three unrelated script files, five existing
  browser-test absolute imports, and `ensureEditorFootnoteEntry`; no findings
  reference this feature's changes.
