# Footnote click-to-edit (static live-link display)

## Problem

Footnotes are always editable `<textarea>`s when a row is editable, so inline markup
(links, bold, italic) shows as raw HTML (`<a href=…>…</a>`) and never renders as a
live link in the editor. The main text field and image captions both render a static,
inline-markup view when their editor is closed and only become a textarea when the
user clicks to edit. Footnotes lack that toggle.

User decision (2026-06-24): make footnotes **click-to-edit**, mirroring the main
field / image caption pattern.

## Approach

Mirror the existing image-caption static↔edit pattern. A footnote entry renders as a
static, inline-markup display (`renderSanitizedInlineMarkupHtml`, live links) unless
its marker matches the open `footnoteEditor`, in which case it renders the textarea.
Clicking a static footnote opens that entry's editor; blurring closes it.

State already exists: `editorChapter.footnoteEditor = { rowId, languageCode, marker }`
and `editorFootnoteEditorMatches(...)`. Today the render ignores it (always textarea)
and `collapseEmptyEditorFootnote` keeps non-empty footnotes "open". We wire the render
to the state and close the editor on blur.

## Steps

1. **Model** (`editor-screen-model.js`): add `openFootnoteMarker` to the language
   section — the integer marker of the open footnote for this row/language, else null.
   Import `editorFootnoteEditorMatches`.
2. **Render** (`editor-row-render.js`, `renderEditorFootnoteField`): per entry, render
   the textarea when `entry.marker === language.openFootnoteMarker`, else a static
   button (`data-action="open-editor-footnote-entry"`, `data-editor-footnote-display`,
   row/lang/marker datasets) containing `renderSanitizedInlineMarkupHtml(entry.text)`.
3. **Open action** (`editor-persistence-flow.js`): add `openEditorFootnoteEntry(render,
   rowId, languageCode, marker, options)` — set `footnoteEditor` to that marker, render
   preserving viewport, focus the footnote textarea (mirror `openEditorImageCaption`).
4. **Close on blur** (`editor-persistence-flow.js`, `collapseEmptyEditorFootnote`):
   always clear `footnoteEditor` on blur (so it renders static); still normalize away
   empty footnote entries. Keep the pending-open and wrong-row guards.
5. **Wrappers/dispatch** (`translate-flow.js`, `actions/translate-actions.js`): export
   `openEditorFootnoteEntry` with operations; dispatch `open-editor-footnote-entry`
   and add it to the action allowlist.
6. **CSS** (`styles/translate.css`): style the static footnote display button to match
   the footnote text (italic, borderless, clickable), reusing existing footnote-static
   styling.
7. **Tests**: model exposes `openFootnoteMarker`; render shows static vs textarea;
   `openEditorFootnoteEntry` sets `footnoteEditor`; blur closes a non-empty footnote.

## Risks

- Focus/blur timing: `activeElementKeepsEditorControlOpen` already keeps the editor
  open for same-cluster focus and the link modal, so link insertion into a footnote
  keeps it open until the user clicks away. Verify clicking between two footnotes
  closes the first and opens the second.
- Empty footnotes must still collapse (remove marker + entry) on blur.
