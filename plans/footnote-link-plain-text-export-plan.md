# Footnote links as plain text for print exports

## Goal

For print-oriented export formats, offer an option that prints each footnote link's
URL in parentheses after the link text, so a reader of paper output can still find
the destination. A clickable hyperlink is useless on paper.

## Decisions (confirmed with user)

- **Scope:** footnote links only (not body links).
- **Formats with the checkbox:** DOCX (file), RTF (file), Plain text (copy), Vellum (copy).
- **TXT (file):** unchanged — keeps its existing always-on `(url)` behavior for all
  links and shows **no** checkbox.
- **Default:** unchecked.
- **Skip rule:** do not append `(url)` when the link's visible text already is a URL
  (starts with `http(s)://`, or equals the href ignoring case/trailing slash).

## UI

- Checkbox label: `Show links in footnotes as plain text`
- Tooltip (title attr): explains the print use case (text from the feature request).
- Shown only when the selected export option carries a new `printLinkFallback: true`
  flag, and only when that option's detail pane is actually usable (copy options still
  require the chapter open in the editor).
- The modal opens from both the projects page and editor preview; file options
  (DOCX/RTF) work in both, copy options (Plain text/Vellum) only with the editor open.

## Implementation

### State — `src-ui/app/state.js`
Add `footnoteLinksAsPlainText: false` to `createEditorExportModalState()`.

### Catalog + flow — `src-ui/app/editor-export-flow.js`
- Add `printLinkFallback: true` to `file:docx`, `file:rtf`, `copy:text`, `copy:vellum`.
- Export `toggleEditorExportFootnoteLinks(render, checked)` updating modal state.
- `submitEditorFileExport`: pass `footnoteLinksAsPlainText` into the
  `export_gtms_chapter_file` invoke input.
- `submitEditorCopyExport`: pass the flag into the plain-text and Vellum serializers
  (only meaningful for `text`/`vellum`; HTML keeps clickable links).

### Modal — `src-ui/screens/editor-export-modal.js`
Render the checkbox (driven by `modal.footnoteLinksAsPlainText`) in both the file and
copy detail panes when `option.printLinkFallback` is set. `data-editor-export-footnote-links-toggle`.

### Input handler — `src-ui/app/input-handlers.js`
`handleEditorExportFootnoteLinksToggleInput` → `toggleEditorExportFootnoteLinks`; register it.

### Inline markup helper — `src-ui/app/editor-inline-markup/serialize.js`
`extractInlineMarkupVisibleTextWithLinkUrls(value)` — like the visible-text flatten,
but appends ` (href)` after each `<a>` link whose visible text is not a URL. Pure.

### Plain-text serializer — `src-ui/app/editor-preview.js`
Thread `showFootnoteLinkUrls` through `serializeEditorPreviewPlainText` →
`plainTextWithFootnoteRefs`; footnote text uses the new helper when enabled.

### Vellum — `src-ui/app/vellum-text-editor-content.js`
Thread the flag through `buildVellumTextEditorContentDecodedXml` /
`buildVellumOgElementPrivateDecodedXml` → `buildVellumTextRuns` → footnote attribute
collection → `footnoteBodyText`.

### Rust — `src-tauri/.../chapter_editor/chapter_export.rs`
- `ExportChapterFileInput`: add `#[serde(default)] footnote_links_as_plain_text: bool`.
- `link_text_is_url(text, href)` and `append_link_urls_to_inline(value)` (operates on
  canonical inline markup; copies tags verbatim, appends ` (url)` after each `</a>`).
- Thread the bool into `render_docx_document` / `render_rtf_document`; apply
  `append_link_urls_to_inline` to footnote `text` when set. TXT/HTML/MD/XLSX untouched.

## Tests
- Rust: docx + rtf footnote with link → `(url)` appended when flag set, skipped when
  link text is a URL, untouched when flag unset; TXT unchanged.
- JS: `extractInlineMarkupVisibleTextWithLinkUrls` cases; plain-text + vellum footnote
  output with flag on/off; URL-as-text skip.
