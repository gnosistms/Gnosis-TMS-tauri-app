# In-row paragraph breaks

## Goal

One row is normally one paragraph, but a translator may press Return inside a
row to split it into paragraphs without splitting the row. Each such paragraph
is set exactly as a separate row of the same style would be, in the editor's
closed display, the Translate and book previews, and every export.

## Decisions (Hans, 2026-10-28)

- A return in a row is a paragraph break. Existing returns are reinterpreted;
  no content migration.
- Shift+Return inserts a line break inside the paragraph.
- Cmd+S (macOS) / Ctrl+S (other platforms) saves and leaves the field, replacing
  Shift+Return in that role.
- Headings follow the same rule as every other style.

## Representation

A textarea draws only LF as a line break (U+2028 renders as a blank space in
both Chromium and WebKit), so a line break is stored as visible inline markup:
`<br>` followed by a newline. Shift+Return inserts `<br>\n`.

- An LF is a **line break** when the last thing before it, ignoring tags,
  spaces, tabs and CR, is `<br>`. Every other LF is a **paragraph break**.
- A `<br>` with no such LF after it is a line break on its own.
- `<br>` is a zero-width void tag like `<hr>`: it adds nothing to visible or
  base text, so word counts, glossary matching and search are unaffected.
- Empty paragraphs are dropped, as empty rows are.
- Custom HTML rows are opaque and unchanged. SRT chapters keep LF as a subtitle
  line, both in the editor and in SRT export.
- Image captions and quote attributions keep LF as a line break; Shift+Return
  there inserts a plain newline.
- Footnotes already treat LF as a paragraph; they gain the same `<br>` line
  break.

## Steps

1. **Inline markup (JS).** Support `br` as a void tag. The parser records which
   `br` absorbs the following LF and which LFs are line breaks. Display
   serialization emits a line break as one `<br>` (dropping its LF), so every
   existing view shows a single break and `footnoteParagraphsHtml` keeps
   splitting only on paragraph LFs. Add `splitInlineMarkupTextIntoParagraphs`,
   which splits at paragraph LFs (keeping `<hr>` inside its paragraph for the
   separator pass), reopening inline tags.
2. **Previews.** `buildEditorPreviewDocument` splits each row (other than
   custom HTML and subtitle cues) into paragraphs, so each is its own block with
   the row's style and `data-row-id`. Footnotes keep one numbering; each note
   goes with the first paragraph that cites it (uncited notes with the last),
   and the attribution stays on the last one. Book preview and
   HTML/WordPress/Markdown/Vellum/plain-text copy follow.
3. **Editor.** Closed display wraps paragraphs in blocks with a paragraph gap
   (not in subtitle chapters). Shift+Return inserts `<br>\n` in text and
   footnote fields (native undo kept; subtitle text keeps a plain newline).
   Cmd/Ctrl+S saves and leaves any row field. Update the "Shift + Return to
   save" hint.
4. **Rust exports.** A shared splitter turns row text into paragraphs whose only
   remaining LFs are line breaks, with `<br>` removed — the in-paragraph format
   every exporter already renders. `push_text_blocks_with_separators` emits one
   text block per paragraph, so PDF, DOCX, RTF, EPUB, HTML, Markdown and plain
   text set them like separate rows. Footnotes use the same splitter
   (`inline_paragraphs`, formerly `footnote_paragraphs`). SRT chapters are not
   split.
5. **Imports.** DOCX `<w:br/>` (text-wrapping breaks) imports as `<br>\n`; page
   and column breaks stay paragraph breaks, and breaks at either end of a
   paragraph are dropped. Add Translation strips the `<br>` so alignment units
   stay one per line. HTML `<pre>` lines import as `<br>\n`; HTML `<br>` was
   already dropped on import and is unchanged.
6. **Tests.** Parser/serializer round trips, block splitting (formatting across
   returns, footnote markers, `<br>` variants, CRLF), preview blocks, keyboard
   behavior, Rust splitter and per-format exports, a Typst render, and a browser
   check of the closed display and previews.

## Known effects

- About 700 existing rows use returns for verse, prayers and lists; they now
  render as one paragraph per line until retyped with Shift+Return.
- Rows merged with Merge keep their original paragraphs.
- A heading with a return becomes two headings (two contents entries).

## Status

Implemented 2026-10-28 on `claude/in-row-paragraph-breaks`, not yet committed.

Verified:

- `npm test`: 3,238 + 26 pass. ESLint: no errors (the one warning in a changed
  file predates this work).
- Rust: 513 `project_import` tests pass (7 opt-in AI/corpus tests ignored);
  clippy clean.
- Typst 0.15.1 render: a stored line break stays inside its paragraph, and a
  return starts a new indented paragraph, in body text and footnotes.
- Playwright (editor regression, export, HTML footnotes, SRT grouping, import
  format): 262 pass. New tests cover the closed display, Shift+Return,
  Cmd/Ctrl+S and the subtitle exception; earlier tests that saved with
  Shift+Return now use the platform's save key.

Not verified: the native Tauri app by hand, and Windows.
