# Footnote paragraph indentation

Use one return as a paragraph boundary inside a footnote. Keep the existing
number gutter, leave the first paragraph flush with the note text, and indent
the first line of subsequent paragraphs by 1.5em without extra paragraph space.
Preserve authored empty paragraphs; do not silently rewrite existing notes.

1. Keep the native plain-text textarea while typing, as requested. Format the
   note after blur, without changing its stored text or native editing behavior.
2. Render matching paragraphs in closed/read-only notes, Translate preview,
   book/export preview, and HTML-based exports. Audit other export formats for
   equivalent paragraph preservation and typography where supported.
3. Emit real paragraph boundaries and explicit footnote-local indentation in
   Typst, independent of surrounding body styles. Check DOCX/RTF/EPUB and avoid
   changing ordinary body-text newline handling.
4. Verify focused unit/native/browser regressions, render representative
   multi-paragraph notes, and run repository checks appropriate to the changes.

## Verification

- Native textarea editing stays unchanged; closed/read-only notes format returns
  as paragraphs. Search/diff highlighting and glossary popovers use the same
  sanitized paragraph renderer. Translate and book/export previews share it.
- Typst uses real paragraph breaks, an explicit first-paragraph exemption, and
  paragraph spacing equal to line leading. Rendered a three-paragraph note with
  inherited body indentation to verify the gutter, wrapped lines, and baseline
  spacing visually.
- HTML/WordPress, EPUB, DOCX, and RTF retain paragraph structure and continuation
  indentation. Markdown now emits correctly indented continuation paragraphs.
  Plain text, spreadsheet cells, and Vellum retain their authored returns;
  Vellum owns its destination typography. History/conflict text remains literal
  for comparison. No existing blank-line cleanup or content migration is done.
- All 3,197 frontend tests, 25 workflow tests, and 393 chapter-editor native tests
  pass (7 pre-existing native tests are ignored). The final 75 focused frontend
  regressions also pass after the compatibility/readability cleanup.
- All 14 focused browser cases pass in installed Chrome and WebKit, including
  typing, blur/save/reopen, Translate preview, search, read-only presentation,
  and 20px/28px spacing. Native Windows execution was unavailable.
- Frontend production build, changed-file Rust formatting, and whitespace checks
  pass. ESLint has no errors and retains the existing unused `editorReplace`
  parameter warning. The unused-code audit reports unrelated existing files and
  exports; the new paragraph renderer has no findings. The build retains its
  existing chunk-size warning.

## PR integration on current main

- Isolated this change in a managed worktree based on `origin/main` at
  `1bbfb259`, preserving main's adjacent-footnote comma handling and all unrelated
  work in the original development checkout.
- On the isolated branch, all 3,225 frontend tests, 25 workflow tests, and 398
  native chapter-editor tests pass (7 ignored). Full JavaScript lint, Rust
  formatting, and production build pass. The unused-code audit retains main's
  baseline of 41 files and 16 exports.
- Recheck the focused Chrome/WebKit cases and required GitHub checks before
  merging the PR.
