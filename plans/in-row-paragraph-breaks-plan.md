# In-row paragraph breaks

## Goal

One row is normally one paragraph, but a translator may split a row into
paragraphs without splitting the row. Each such paragraph is set exactly as a
separate row of the same style would be, in the editor's closed display, the
Translate and book previews, and every export.

## Decisions (Hans, 2026-10-28)

- A blank line in a row is a paragraph break; a single return is a line break.
  Return inserts the blank line, Shift+Return a single newline.
- Cmd+S (macOS) / Ctrl+S (other platforms) saves and leaves the field, replacing
  Shift+Return in that role. The field hint reads "Command + S to save" /
  "Ctrl + S to save".
- Headings follow the same rule as every other style.
- No migration. An earlier version of this branch stored line breaks as
  `<br>` and read every return as a paragraph break; existing rows would have
  needed a migration, and edits from older or offline apps could slip past it.

## Existing rows

Hans's 78 local repos (non-subtitle chapters) hold 5,875 text fields with a
return. Every return there rendered as a line break, so the blank-line rule
keeps them as they were, except blank lines, which now set real paragraphs:

| Use of returns | Fields | After this change |
|---|---|---|
| Short lines: verse, prayers, lists | 3,028 | unchanged |
| Paragraphs separated by a blank line | 918 | separate paragraphs |
| Long prose lines, single return | 631 | unchanged (line breaks) |
| Mixed: numbered items, heading + text | 1,298 | unchanged unless blank lines |

## Representation

- A **paragraph break** is a blank line: two newlines with only spaces, tabs,
  CR or inline tags between them (a blank line may cross formatting). Longer
  runs are one break; empty paragraphs are dropped, as empty rows are.
- A single newline is a **line break** inside its paragraph, rendered as every
  view and exporter already renders a newline in a row.
- `<hr>` between two newlines is content, so it does not make a blank line.
- Not split: subtitle (SRT) text, custom HTML rows.
- Unchanged: footnotes (every newline is a paragraph, as before), image
  captions and quote attributions (every newline is a line break).

## Steps

1. **Inline markup (JS).** `splitInlineMarkupTextIntoParagraphs` finds the
   newlines of each blank line across text nodes and splits there, reopening
   formatting that spans the break and dropping empty paragraphs.
2. **Previews.** `buildEditorPreviewDocument` splits each row (other than
   custom HTML and subtitle cues) into paragraph blocks with the row's style and
   `data-row-id`. Footnotes keep one numbering; each note goes with the first
   paragraph that cites it (uncited notes with the last), and the attribution
   stays on the last one. Book preview and HTML/WordPress/Markdown/Vellum/
   plain-text copy follow.
3. **Editor.** The screen model marks row text that splits
   (`textHasParagraphs`: not subtitles, not custom HTML). Its closed display
   wraps each paragraph in a block with a paragraph gap, and its textarea
   carries `data-text-has-paragraphs`, where Return inserts `\n\n` (one `\n`
   after a newline, which turns a line break into a paragraph break). Native
   undo is kept. Cmd/Ctrl+S saves and leaves any row field.
4. **Rust exports.** `row_paragraphs` splits at blank lines with the same
   rule; `push_text_blocks_with_separators` emits one text block per paragraph
   (not in SRT chapters), so PDF, DOCX, RTF, EPUB, HTML, Markdown and plain
   text set them like separate rows. `footnote_paragraphs` is unchanged.
5. **Imports.** Unchanged: DOCX soft returns and HTML `<pre>` lines already
   import as single newlines, which are line breaks.
6. **Tests.** Splitter (formatting across breaks, whitespace lines, runs, tags
   in a blank line, `<hr>`), closed display, preview blocks and footnotes,
   keyboard behavior, Rust splitter and block builder, and a browser check of
   the display, Return, Shift+Return, the hint and Cmd/Ctrl+S.

## Known effects

- Rows with blank lines (918 fields locally, mostly prose) now set separate
  paragraphs instead of an empty line inside one paragraph.
- Prose rows that separate paragraphs with a single return stay as line breaks
  until a translator adds the blank line (Return at the start of the line).
- A heading with a blank line becomes two headings (two contents entries).
- Shift+Return no longer saves; Cmd/Ctrl+S does.

## Status

Implemented 2026-10-28 on `claude/in-row-paragraph-breaks` (draft PR #408).
The first commits used `<br>` line breaks; later commits on the branch replace
them with blank-line paragraphs.
