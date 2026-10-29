# List row style

## Goal

A new row text style, **List**, beside P / H1 / H2 / Q / I / C / <>. A list row
holds a whole (possibly nested) list. The user picks one of four list styles —
bullets, numbers, letters, roman numerals — and the app decides how each nesting
level looks. Lists must draw correctly in the editor, the previews, and every
export that can carry a list, with a readable fallback where a format cannot.

## Data model

No new row fields. The list style is part of the row's `text_style`:

| `text_style`  | Menu label      | Aliases accepted on read |
|---------------|-----------------|--------------------------|
| `list_bullet` | Bullets         | `list`, `ul`, `list-bullet` |
| `list_number` | Numbers         | `ol`, `list-number` |
| `list_letter` | Letters         | `list-letter` |
| `list_roman`  | Roman numerals  | `list-roman` |

Reusing `text_style` means saving, history, sync, conflicts and merges already
work. An older app version normalizes an unknown style to `paragraph`, so a list
row degrades to plain lines there rather than breaking.

Changing to or from a list style never rewrites the row text, so switching back
to P restores the paragraphs exactly.

### Items

The row text (per language, the stored inline markup) is split on `\n`
(`\r\n` normalized):

- Each line is one item. Its nesting level is the number of tab characters at
  the very start of the line; those tabs are removed from the item text.
- Lines whose visible text (tags stripped) is blank are dropped, so paragraph
  rows (blank-line separated) convert into one item per paragraph.
- Levels are normalized in order: the first item is level 0, and an item may be
  at most one level deeper than the item before it (`min(raw, prev + 1)`), capped
  at level 8 (nine levels, the DOCX maximum).
- Numbering restarts in every list row; each item increments the counter of its
  level and resets the counters of deeper levels.
- Inline markup (bold, italic, underline, ruby, links, footnote markers) works
  inside items exactly as in paragraphs. A formatting run that spans a line break
  is closed and reopened per item.
- `<hr>` separators are not split out of list rows.

### Level formats

The format cycles when the depth exceeds the sequence:

| Style    | Level 0 | 1 | 2 | 3 | 4 |
|----------|---------|---|---|---|---|
| Bullets  | disc `•` | circle `◦` | square `▪` | (repeat) | |
| Numbers  | `1.` | `a.` | `i.` | (repeat) | |
| Letters  | `a.` | `i.` | `1.` | (repeat) | |
| Roman    | `I.` | `A.` | `1.` | `a.` | `i.` (repeat) |

Roman follows the classic outline (I. A. 1. a. i.); Numbers follows Word's
default multilevel list (1. a. i.); Letters rotates the same triad to start at
a. Alphabetic counters continue past z as aa, ab, … (CSS and Typst agree; Word's
letter numbering goes aa, bb, … and has no format for aa, ab, so DOCX differs
past 26 items at one letter level).
CSS names: `disc circle square decimal lower-alpha lower-roman upper-alpha
upper-roman`.

## Editor

- `editor-row-text-style.js`: `list_*` constants, `isListRowTextStyle`,
  normalizer aliases, and a List option between C and <> that renders a Lucide
  `list` icon (ISC licence) with tooltip "List". The option is active for every
  list style and keeps the row's current list style when clicked.
  History labels read "List (bullets)" etc.
- New pure module `editor-list.js`: item parsing, level normalization, counters,
  marker text, CSS list-style types, and HTML builders shared by the editor,
  preview and JS exports. It splits *rendered* HTML (with highlights and
  footnote refs already applied) into items, reusing the paragraph splitter so
  inline tags reopen across lines.
- Static (not editing) field: items render as block spans with a hanging marker
  gutter and per-level indentation.
- Editing field: still the textarea, so undo, IME, inline-style shortcuts,
  glossary/search overlays and saving keep working. In list rows it gets a left
  marker gutter and a wide `tab-size`, and a marker overlay mirrors the textarea
  text to draw each item's marker at its first line. Wrapped lines of nested
  items return to the gutter edge while editing (a textarea cannot hang them);
  the static view and every output hang them correctly.
- Keys in a list textarea (`data-text-is-list`, replacing the paragraph flag):
  - Return inserts a new item at the current item's level (one `\n` plus tabs);
    Return on an empty indented item outdents it instead.
  - Tab / Shift+Tab indent / outdent every line touched by the selection
    (indent stops at previous level + 1).
  - Backspace with the caret right after an item's leading tabs outdents.
  All edits go through `execCommand("insertText")`, keeping native undo and the
  beforeinput write gate.
- A settings button (gear) floats in the field's upper-right corner on list
  rows the user can edit. It opens a menu (radio items: Bullets, Numbers,
  Letters, Roman numerals, each with its level-0 marker) that reuses the
  `set-editor-row-text-style` action. The menu keeps textarea focus while open.

## Previews and JS-side outputs (`editor-preview.js` and friends)

- Preview blocks: a list row is one block (not split into paragraphs).
- Preview / book preview HTML: nested `<ul>`/`<ol>` with `list-style-type` set
  per list element; search highlights and footnote refs keep working.
- Copy HTML: same nested lists.
- WordPress: core list blocks (`wp:list` / `wp:list-item`, nested lists inside
  the item) with `{"ordered":true}` and `style="list-style-type:…"` for
  non-decimal ordered levels.
- Plain text copy: indented lines with marker text (fallback).
- Vellum clipboard: indented paragraphs with marker text (fallback; Vellum's
  paste format has no list structure we can rely on).

## Rust exports (`chapter_editor`)

- `normalize_editor_text_style_value` and the export helpers accept the list
  styles. A shared `list_items` / level-format / marker helper mirrors
  `editor-list.js` (same rules, same tests).
- `build_export_document`: a list row becomes one `ExportBlock::Text` with its
  list style and normalized item text (tabs kept, blank lines dropped). Text-
  scanning code (fonts, footnote anchors) keeps working unchanged.
- HTML and EPUB: nested `<ul>`/`<ol>` with `style="list-style-type:…"`.
- Markdown: native nested lists (`-` for bullets, `N.` for ordered levels,
  children indented to the parent's content column). Markdown has no letter or
  roman lists, so those levels fall back to decimal numbers. Two numbered list
  rows in a row merge into one list in CommonMark renderers.
- DOCX: real Word numbering — a `word/numbering.xml` part with one abstract
  definition per list style (nine levels, hanging indents) and one `w:num` per
  list row so numbering restarts; items are paragraphs with `w:numPr`.
- RTF: fallback — paragraphs with hanging indents per level and the marker text
  followed by a tab.
- TXT: fallback — indented lines with marker text.
- PDF (Typst): native `list` / `enum` with per-level markers / numbering.
  Bullets are drawn shapes, since the body fonts may lack ◦ and ▪. Lists get no
  first-line indent or drop cap, and the paragraph after a list starts flush.
- XLSX and SRT: unchanged (raw text; SRT chapters cannot use row styles).

## Tests

- `editor-list.test.js`: parsing, normalization, counters, markers per style,
  HTML splitting with tags spanning lines.
- Row render, preview, WordPress, plain-text and Vellum serializer tests.
- Keyboard handling tests for Return / Tab / Shift+Tab / Backspace.
- Rust unit tests for the shared helpers and each exporter.
- Browser test: set a row to List, indent an item, change the list style,
  check the static field and preview.

## Out of scope / follow-ups

- Importing lists from DOCX/HTML sources as list rows.
- Multi-paragraph list items.
- Telling AI translation to keep leading tabs (the prompt passes text as is).
