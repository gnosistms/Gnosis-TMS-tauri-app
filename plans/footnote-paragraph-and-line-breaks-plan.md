# Footnote paragraphs and line breaks

Status: built on `dev`, 2026-11-04; not yet in a release. Captions and
attributions are the follow-up (Decision 2).

## Goal

Footnotes follow the same rule as row text, so a translator can put a line
break inside a footnote paragraph (verse, an address) instead of every return
becoming a new paragraph.

Hans, 2026-11-04: "However we handle paragraph breaks and line breaks in row
text, we should handle it that way everywhere."

The case that raised it: footnote 4 of hnhh chapter 9 part 2 quotes six lines of
Isaiah 28:10. On gnosisvn.org each line arrived as its own `<p>`, each with a
1.5em first-line indent and the theme's 6px gap below, so the verse reads as six
one-line paragraphs.

## The rule (as in rows, `plans/in-row-paragraph-breaks-plan.md`)

- A **blank line** is a paragraph break: two newlines with only spaces, tabs, CR
  or inline tags between them. A run of blank lines is one break; empty
  paragraphs are dropped.
- A **single newline** is a line break inside its paragraph.
- **Return** inserts a blank line (one newline when the caret already follows a
  newline); **Shift+Return** inserts a single newline. Cmd/Ctrl+S saves and
  leaves the field, as it already does.
- Paragraph layout is unchanged: the first paragraph is flush, later paragraphs
  take the 1.5em first-line indent, and there is no gap in the PDF or book
  preview.
- After a line break the next line starts at the note's left edge, as a line
  break in a body paragraph does today. Verse whose
  lines should all start at an indent is a separate question for rows and
  footnotes alike (see Decisions).

## Today

- Every newline in a footnote is a paragraph (`footnoteParagraphsHtml` /
  `splitHtmlParagraphs` in JS, `footnote_paragraphs` in Rust). An empty line is
  kept as an "authored empty paragraph".
- The footnote textarea lacks `data-text-has-paragraphs`
  (`editor-row-render.js`), so Return and Shift+Return both insert a plain
  newline (`events/keyboard-shortcuts.js`).
- Hans's local repos: 3,196 footnote fields; about 1,210 contain a return. 176
  single notes contain a blank line (an empty paragraph today).
- 103 fields hold several notes, stored as `[1] …` + blank line + `[2] …`. Hans
  takes these for holdovers to be fixed before publishing, but the editor still
  writes this form when one row cites two notes: each note has its own box,
  and the save path (`serializeEditorFootnotesForLegacy`) joins them. JS
  `parseLabeledFootnoteText` and Rust `parse_labeled_footnote_text_for_merge`
  start a note at a `[n]` label, not at a blank line, so blank lines inside a
  note are safe. (A paragraph that itself starts with `[n]` was already
  ambiguous and stays so.)

## Existing footnotes: a content migration

Without a migration every existing multi-paragraph footnote would turn into one
paragraph with line breaks. So:

1. **Migration `0.8.147` (content, project repos).** Add a descriptor to
   `REPO_MIGRATION_REGISTRY` (`repo_migrations.rs`) like `MIGRATION_08138`. For
   every row file and every language's `footnote` string, each newline that is
   not already part of a blank line becomes a blank line. Labeled-note
   separators are already blank lines and stay as they are; nothing else in the
   file changes. It records the id in `.gtms/repo.json` and commits "Separate
   footnote paragraphs with blank lines (0.8.147 migration)" with the
   `GTMS-Migration` trailer. Same preconditions as 0.8.138: it runs during sync
   on a clean working tree and retries on the next sync otherwise.
2. **Effect.** Every footnote looks exactly as before, except that an empty
   paragraph inside a note (176 locally) collapses into an ordinary paragraph
   break.
3. **"Changed after my last edit".** It did not skip migration commits (nor did
   it for 0.8.138). Now a `repo.migrate` commit is neither another person's edit
   nor my check, and a baseline older than the 0.8.147 commit has its footnotes
   rewritten the same way, so the diff shows only people's changes.
4. **History.** A version older than the row's 0.8.147 commit shows its
   footnote as the migration rewrote it, so the migration itself is no History
   entry, and restoring such a version rewrites its footnote before writing it.
   "Undo batch replace" already skips rows changed after the replace, which
   includes migrated ones.
5. **Merges.** Content migrations run before the pull, on each machine that has
   not yet pulled the marker, so both sides of a pull carry migrated text.
   Identical rewrites merge cleanly. An unpushed footnote edit can still meet
   another machine's migration of the same note as an ordinary conflict, as
   with any concurrent edit; both versions are then in the new format.
   (`row_merge.rs` merges two rows into one and keeps each note's text as is.)
6. **Older app versions.** Sync already stops an app older than the version
   that made the remote's latest commit ("Update Gnosis TMS before syncing"), so
   an older app cannot push old-format footnotes into a migrated repo; edits it
   made offline are committed before the update and migrated by the new app.
   Until someone syncs with the new app, the new app shows unmigrated
   multi-paragraph notes as line breaks.
7. **Book redundancy review.** Saved include/exclude choices are keyed by the
   note's text. A migrated note is matched with its previous review ignoring
   whitespace, so its choice carries over. The next review asks AI again about
   pairs that involve a migrated note, and an export reviewed before the
   migration asks to return to redundancy review.
8. **Not migrated:** glossary and QA list notes (3 glossary footnotes contain a
   return; their single returns now read as line breaks when inserted), and
   captions and attributions (every return there was already a line break).

## Changes

1. **One splitting rule.** JS `footnoteParagraphsHtml` splits with
   `isBlankLineNewline` (as `rowTextParagraphsHtml` does) and drops empty
   paragraphs. Rust `footnote_paragraphs` calls `split_inline_paragraphs(value,
   true)`, the `row_paragraphs` rule, and drops empty paragraphs.
2. **Line breaks in every footnote renderer.** Each renders a newline inside a
   footnote paragraph as a line break, the way it already does in row text:
   - JS: the editor's closed footnote display, Translate preview, book preview,
     glossary tooltip (all via `footnoteParagraphsHtml`); WordPress footnote meta
     and copied HTML (`editor-preview.js`, `<br>`); plain-text copy.
   - Rust: HTML, Markdown, DOCX, RTF and TXT (`chapter_export.rs` footnote
     branches), PDF (`render_footnote_typst`: a return inside Typst `#text("…")` is a line break), EPUB,
     `list_style.rs`, and the Vellum export.
3. **Keys.** The footnote textarea carries `data-text-has-paragraphs`, so
   Return and Shift+Return behave exactly as in row text.
4. **Footnote text the app creates** separates paragraphs with blank lines.
   Audit: DOCX import kept each note paragraph on one line and now joins them
   with blank lines, `<w:br/>` staying a line break. HTML, RTF, TXT and link
   import create no footnotes; XLSX import copies the cell. AI prompts say
   nothing about returns and models keep the source's layout. Grouped subtitle
   cues joined their notes with one return and now use a blank line, so each
   cue's note stays its own paragraph. Glossary insertion copies the glossary
   note as it is (see 8 above).
5. **Captions and attributions** (see Decisions). Every newline there is a line
   break today, which the row rule keeps, so no migration is needed. Giving them
   the same keys means a blank line becomes a paragraph break, which each
   caption and attribution renderer must then set. Locally 5 captions contain a
   return and 1 a blank line; no attribution contains a return.
6. **Unchanged:** subtitle text and custom HTML (as in rows). Glossary and QA
   list notes have their own editors; check them separately, together (parity).

## Tests

- Splitters (JS and Rust): line break vs blank line, formatting across both,
  runs of blank lines, tags inside a blank line, `<hr>`, labeled notes with blank
  lines inside, CRLF.
- Each exporter and preview: a footnote with a line break and a paragraph break.
- Migration: single returns, existing blank lines, labeled notes, CRLF, a second
  run changes nothing, other fields untouched, the commit trailer and the
  `repo.json` record.
- "Changed after my last edit" ignores the migration commit; History restore
  converts an old version.
- Keyboard: Return and Shift+Return in a footnote. A browser check of the
  footnote editor and its closed display.

## Decisions (Hans, 2026-11-04: "Yes, build it" with the recommendations)

1. **Older apps.** No schema bump; a release-note line. (The sync version check
   turned out to stop older apps from pushing anyway, see 6 above.)
2. **Captions and attributions.** Right after this change, not in it.
3. **Verse.** Lines after a line break start at the left edge, as in body text.
   Aligning them with the first line's indent would be a new rule for rows and
   footnotes together.

## Release notes line

Footnotes now work like row text: Return starts a new paragraph and
Shift+Return breaks the line inside it. Existing footnotes are converted on the
first sync and look as before, except that an empty paragraph inside a note
becomes an ordinary paragraph break. Everyone on the team should update: an
older app cannot sync with a project once a newer one has.

## After this lands

To set the Isaiah verse, delete the blank lines between its six lines (they
become line breaks) and re-export the post: WordPress then gets one `<p>` with
`<br>` between the lines.
