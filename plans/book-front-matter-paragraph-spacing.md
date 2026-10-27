# Front-matter paragraph spacing

Reference: the supplied one-page Vellum PDF has 9.20426 pt text, 11.505 pt line
spacing (1.25em), and about 7 pt extra paragraph space (0.75em). The composer uses
1.6em line spacing and renders every saved newline as a BR.

1. Render copyright/dedication text as paragraphs at 1.25 line height with 0.75em
   paragraph spacing. Keep Return as a paragraph and Shift+Return as a soft break.
2. Share limited-text paragraph parsing/rendering/serialization in the frontend.
   Store paragraph boundaries as LF and soft breaks as U+2028. Preserve existing
   blank returns, inline italics, and separators without changing chapter text.
3. Convert front matter into matching paragraph blocks for clipboard/Vellum and
   native document export; render native PDF paragraph boundaries consistently.
4. Cover paragraph/soft-break persistence, italics across paragraphs, blank lines,
   separators, and escaping with focused tests. Check typing, reload, formatting,
   export payloads, and measured spacing in Chrome; visually compare the preview.

Status: complete.

Validation:
- 71 focused frontend tests passed, including the new paragraph/soft-break,
  inline-formatting, blank-line, separator, and escaping tests; ESLint passed.
- Native tests passed: 9 book/SVG, 35 PDF, and 55 document-export tests.
- The composed-book smoke test compiled with the bundled Typst binary and cached
  fonts, including the new front-matter paragraph rules.
- Two Chrome workflows passed: new Return/Shift+Return/paste/save/reopen/export
  coverage for both front-matter editors and the existing book-composer workflow.
- Measured computed CSS: line-height/font-size = 1.25 and paragraph margin/font-size
  = 0.75. Visually inspected the Vietnamese reference-text preview against the
  rendered Vellum PDF. Existing extra blank returns are deliberately preserved.
