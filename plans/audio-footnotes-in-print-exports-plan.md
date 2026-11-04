# Audio as Footnotes in Print Exports

## Goal

A printed book should not carry an audio address in the middle of a page.
Where an export cannot play audio, the audio becomes a footnote on the row's
text instead of a centered "Audio:" line. Follows
`plans/editor-audio-video-media-plan.md` (step 7, Exports).

## Decisions (from Hans, 2026-11-04)

- Formats that cannot embed an audio player put the audio link in a footnote.
- The footnote reads: caption with its ending punctuation removed, then
  `": "`, then the audio address. Where the format has links, the address is
  a link.
- Audio cannot be attached to a row whose text is empty, since the footnote
  needs text to attach to.
- Formats that embed a player keep doing so (HTML, WordPress, clipboard HTML,
  EPUB's bundled audio).
- User-facing wording that says "image" must not mislead when the row holds
  audio or video ("audio file", "video").

## Defaults I am taking

- **Which exports.** PDF, DOCX, RTF, Markdown, TXT, Vellum, plain-text copy
  and the book preview (which models the PDF). EPUB too, for the audio it
  cannot bundle (WAV and audio by URL); uploaded MP3 and M4A stay embedded.
- **No caption.** The footnote is the address alone.
- **Uploaded audio** has no public address, so its file name stands in, as it
  did on the old line.
- **Which punctuation is removed.** Trailing `. , ; : ! ? …` and their CJK,
  Arabic and Devanagari forms (`。 ， 、 ； ： ！ ？ ، ؛ ؟ । ॥`), repeated, with
  any whitespace and inline tags between them. Closing quotes and brackets
  stay, so a quoted title stays balanced. A shared fixture
  (`tests/fixtures/audio-footnote/caption-cases.json`) keeps Rust and JS in step.
- **Placement.** The reference goes at the end of the row's last paragraph,
  after the row's own footnotes, as a row-level footnote does today.
- **Links.** TXT and plain-text copy show the bare address (no "url (url)").
- **Fallback.** A row whose text is emptied after the audio was attached still
  exports the old centered "Audio:" line, so nothing is lost.
- **Video is unchanged** (still a "Video:" line). Say if it should follow.

## Steps

1. **Rust exports.** `build_export_document` learns the format's media rule.
   For audio it cannot embed, on a row with visible text, it pushes a
   `Footnote` block (anchored to the row's last text block, numbered after the
   row's own footnotes, with a marker that the row's text never cites) instead
   of a `Media` block. `build_scoped_export_document` picks the rule from
   `input.format` (HTML embeds, EPUB embeds what it bundles, the rest
   footnote). Doing this per chapter, before book numbering, keeps footnote
   numbers and markers right in books. The print policy still turns video and
   the empty-row fallback into link lines.
2. **JS exports.** `applyMediaLinkPolicy` (Vellum, plain-text copy, book
   preview) adds the same footnote to the row's last text block, else falls
   back to the link line. Same caption rule, from the shared fixture.
3. **Block audio on empty rows.** URL insert, upload (picker, drop, dropped
   path) and duplicate-to-language refuse audio when the target language's
   row text is empty, with a message saying why.
4. **Wording.** Sweep user-facing strings for "image" that can be shown for
   audio or video and make them name the right kind.
5. **Tests.** Rust tests per format for the footnote, the punctuation rule,
   book numbering and the fallback; JS tests for the policy and the insert
   block; update the media plan's export table.

## As built (2026-11-04)

- Rust: `AudioExport` in `chapter_export.rs` picks the rule from the export
  format; `build_export_document` adds the footnote per chapter, so book
  numbering rebases it like any row footnote. PDF, DOCX, RTF, Markdown and
  TXT need no renderer changes: the audio note is an ordinary row-level
  footnote. Checked in a rendered A5 PDF page.
- JS: `editor-audio-footnote.js` holds the caption rule, the footnote text and
  the empty-row check; `applyMediaLinkPolicy` in `editor-preview.js` adds the
  note to the row's last text block (custom HTML is skipped and falls back).
- Refusal: URL insert shows the reason in the URL box; upload, drop and
  duplicate-to-language show it as a notice.
- Wording: notices, the copy-URL menu item, the reuse and overwrite modals,
  the caption-translation modal and notices, the change view tooltip, the
  history prefix, review and assistant caption labels, the conflict modal, the
  "Has image" filter, the project-search caption label, the export modal notes
  and the Rust row-media errors now name image, audio file or video (or stay
  neutral where the kind is unknown).

## Follow-ups (done)

The three gaps noted while building this (the change view drew a previous
audio or video as a broken `<img>`, the invalid-file modal gave one message
for every refusal, and `runtime.js` reported the audio validation errors as
command failures) were fixed in `plans/editor-media-leftover-gaps-plan.md`.
