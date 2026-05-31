# WordPress Footnotes Preview and Copy HTML Plan

## Summary

Gnosis TMS should let an editor update the HNHH translation, switch to Preview, and use Copy HTML to paste directly into the WordPress block editor with native-looking Gutenberg footnotes. The immediate proof-of-concept is a static HTML mockup using local HNHH chapter 2 data from the GnosisVN team data store.

Local data source:

- Project: `/Users/hans/Library/Application Support/com.gnosis.tms/installations/installation-125730441/projects/hnhh`
- Chapter: `chapters/hnhh-chapter-02`
- Target language: `vi`
- Current data shape: 37 rows, 16 Vietnamese row footnote fields

Reference WordPress page:

- `https://gnosisvn.org/2017/01/18/chuong-2-con-nguoi/`
- Current published HTML uses Gutenberg footnotes: inline `sup.fn` anchors plus one final `ol.wp-block-footnotes`.

## Mockup Plan

Create a static HTML mockup, for example:

- `previews/wordpress-footnotes-hnhh-chapter-02.html`

The mockup should include only:

- a preview document for HNHH chapter 2 in Vietnamese
- a `Copy HTML` button
- minimal status text such as `Copied`

The mockup should not include the full Gnosis TMS editor. Its job is to test the final preview and paste payload behavior in isolation.

The mockup should read or embed the local chapter 2 row data, render rows in order by `structure.order_key`, and produce a WordPress-style preview where footnote markers are converted into linked references.

## WordPress Footnote HTML Target

Generated inline references should match the current WordPress/Gutenberg pattern:

```html
<sup data-fn="stable-id" class="fn">
  <a id="stable-id-link" href="#stable-id">1</a>
</sup>
```

Generated footnote section:

```html
<ol class="wp-block-footnotes">
  <li id="stable-id">
    Footnote text
    <a href="#stable-id-link" aria-label="Chuyển đến phần tham khảo chú thích cuối trang 1">↩︎</a>
  </li>
</ol>
```

Expected behavior:

- inline footnote numbers link to the matching footnote item
- each footnote item has a backlink to its inline reference
- all footnotes appear in one section at the bottom of the copied content
- the preview visually resembles WordPress enough to verify numbering and navigation
- the copied HTML contains only the paste payload, not mockup UI

## Copy HTML Behavior

The `Copy HTML` button should copy the same HTML that should be pasted into WordPress.

Copied output should include:

- paragraph, heading, quote, centered, and indented text markup from preview rows
- inline `sup.fn` references
- one final `<ol class="wp-block-footnotes">`
- auto-linked plain URLs inside footnote bodies
- no mockup CSS, wrappers, toolbar markup, or status UI

Plain URLs in footnotes should be converted into clickable `<a href="...">...</a>` links before copying.

## Footnote Model and Migration

Support multiple footnotes per row/language. The normalized app model should treat footnotes as an ordered list:

```js
row.footnotes[languageCode] = [
  { marker: 1, text: "First footnote text" },
  { marker: 2, text: "Second footnote text" }
]
```

Main text should use plain row-local numeric markers that match those footnote entries:

```text
Elohim [1] đồng thời là nam và nữ. Khi ... [2]
```

Existing project data uses one string per row/language:

```json
{
  "footnote": "Existing single footnote text"
}
```

Handle old data with a soft migration:

- old empty `footnote` string loads as `[]`
- old non-empty `footnote` string loads as `[{ "marker": 1, "text": "..." }]`
- no one-time repo rewrite is required
- when a row is saved after editing, write the new structured footnotes shape
- during the transition, also write legacy `footnote` as a readable fallback so older app versions degrade gracefully
- for one note, legacy `footnote` should be that note's text
- for multiple notes, legacy `footnote` should join notes with blank lines and row-local labels, such as `[1] First note\n\n[2] Second note`

Avoid a hard migration until the feature is proven because project repos are Git-backed and shared by teams. Lazy migration on save keeps old rows readable and updates only rows that users actually touch.

## Marker Handling

The local HNHH chapter 2 data currently stores footnote placement with plain text markers such as:

- `[1]`
- `[2]`
- `[]`
- `[?]`

The published WordPress page has these converted into real footnote anchors at exact text positions.

For the first production version, use `[1]`, `[2]`, `[3]`, etc. as editable footnote markers. These markers are row-local: every row starts at `[1]`. They are plain text inside the existing main textarea because native textareas cannot contain real draggable inline chips. The app can still render markers as rounded `1`, `2`, `3` chips in non-editing surfaces such as static row display and preview.

When the user clicks the footnote button:

- the `*` add-footnote button stays visible all the time while the row/language is editable
- determine the next available row-local footnote number for that row/language, such as `1`, then `2`, then `3`
- if the main text field is focused, insert `[N]` at the current caret position
- if no usable caret is available, append `[N]` to the end of the row text
- create the matching footnote entry if it does not exist
- open a matching footnote text editor for that row/language and marker number
- if clicked again, add a second, third, fourth, etc. footnote textarea
- do not add a duplicate marker for an existing footnote number

Each footnote textarea should have a non-editable marker prefix:

- first textarea begins with fixed `[1]`
- second textarea begins with fixed `[2]`
- third textarea begins with fixed `[3]`
- the marker prefix is rendered outside the textarea or otherwise made non-editable, so the user cannot delete it from the footnote body

Escaped markers:

- parse only unescaped markers like `[1]`, `[2]`, `[3]`
- escaped markers like `\[2\]` are treated as literal text, not footnote references
- stored main text preserves the escape
- static display, preview, and Copy HTML should render escaped markers as literal visible text, for example `\[2\]` displays and copies as `[2]`

When the row saves or the user blurs out, normalize in this exact order:

- parse all unescaped markers in the main row text
- match parsed markers to existing footnote entries by marker number
- if the same marker appears more than once in the main row text, keep the first instance as the real marker and replace all later duplicates with escaped literal markers like `\[2\]`
- for every non-empty footnote entry with no matching marker, append its current marker to the end of the main text
- replace any remaining unescaped marker in the main row text with no corresponding footnote entry with an escaped literal marker, for example `[100]` becomes `\[100\]`
- delete every empty footnote entry that has no matching marker
- keep every empty footnote entry that has a matching marker
- renumber the remaining footnotes by first marker appearance in the main row text
- atomically rewrite the main row text markers, footnote entry `marker` values, and fixed footnote textarea prefixes to the new row-local sequence: `[1]`, `[2]`, `[3]`, etc.

If a row has unsaved in-memory footnote text but the user deletes its marker before save normalization runs, preview and Copy HTML should use the same missing-marker fallback by treating the missing marker as if it appeared at the end of the text. Save/blur normalization persists that cleanup.

Preview and Copy HTML must replace row-local marker numbers with document-global WordPress footnote numbering. For example:

- row A text has `[1]` and `[2]`
- row B text has `[1]` and `[2]`
- preview/copy renders row A as document footnotes 1 and 2
- preview/copy renders row B as document footnotes 3 and 4
- the output uses WordPress `sup.fn` references and `ol.wp-block-footnotes`, not literal `[1]`, `[2]`, `[3]`, `[4]` marker text
- visible Preview mode should render WordPress-style footnote references and the bottom footnote section
- Copy HTML should use the same serializer, minus preview-only wrappers or search markup

For the mockup, use a provisional parser:

- replace bracket markers in row text with footnote references
- split the row footnote field by matching markers where possible
- support multiple footnotes in one row
- if a row has footnote text but no usable marker, append references at the end of the row, matching the missing-marker fallback rule
- preserve line breaks in footnote text as `<br>` where needed
- auto-link URLs in footnotes

Known mismatch to account for:

- the live WordPress page does not always map one local marker to one local note exactly; some links and note placements were manually refined in WordPress.
- the mockup should prove the structure and behavior, not perfectly reproduce every editorial refinement from the published page.

## Production Implementation Plan

After the mockup validates the output shape:

- Add a shared WordPress footnote serializer in the preview/export layer.
- Use it from `serializeEditorPreviewHtml()` so Copy HTML produces WordPress-compatible output.
- Introduce a normalized multiple-footnote model while preserving compatibility with legacy single-string footnote data.
- Insert `[N]` into the main row text when the footnote button is used, using the caret position when available.
- Keep the `*` add-footnote button visible after the first footnote is added.
- Render `[N]` markers as styled chips in static row display and preview, while leaving them as plain text in the active textarea.
- Replace the single footnote textarea with multiple footnote editors, one per footnote entry, each with a fixed non-editable `[N]` prefix.
- Delete empty footnote entries on save/blur and avoid showing them the next time the row opens.
- Apply save-time normalization atomically to main text, structured footnote entries, and legacy fallback `footnote`.
- Map row-local markers to document-global WordPress footnote numbers during preview/copy serialization.
- Render visible Preview mode with WordPress-style footnote refs and a bottom footnote section.
- Use lazy migration on save rather than rewriting all existing project rows up front.

Likely production touchpoints:

- `src-ui/app/editor-preview.js`
- `src-ui/app/editor-preview.test.js`
- `src-ui/app/editor-preview-flow.js` only if Copy HTML needs extra options or status text changes
- editor row loading/normalization and persistence paths for old/new footnote shapes
- editor row rendering and input handlers for multiple labeled footnote editors

## Acceptance Checks

The mockup is successful when:

- HNHH chapter 2 renders with inline footnote numbers instead of visible bracket markers.
- Clicking an inline number jumps to the matching bottom footnote.
- Clicking the bottom backlink jumps back to the inline number.
- A footnotes section appears at the bottom of the document.
- Copy HTML places only the WordPress-ready HTML on the clipboard.
- Pasting into the WordPress block editor creates normal content blocks plus a footnote list compatible with WordPress/Gutenberg.
- URLs inside footnotes are clickable after paste.

Production tests should cover:

- one footnote in one row
- multiple footnotes in one row
- multiple footnotes in one paragraph
- legacy single-string footnote rows load as one `[1]` entry
- edited rows save the new structured footnote shape
- rows with footnote text but no marker
- rows with markers but empty footnote text
- markers with no matching footnote entry are escaped, for example `[100]` becomes `\[100\]`
- escaped markers render and copy as literal marker text, for example `\[100\]` becomes visible `[100]`
- duplicate markers keep only the first valid instance and escape later duplicate instances
- the `*` add-footnote button remains visible after adding the first footnote
- clicking the footnote button inserts the next `[N]` marker at the caret
- clicking the footnote button appends the next `[N]` marker when no caret is available
- each footnote textarea shows a non-editable `[N]` prefix
- empty footnotes are removed on save/blur and do not reopen later
- empty footnotes with matching markers are saved and render as empty footnotes
- save-time normalization renumbers remaining footnotes by first marker appearance in the row text
- save-time normalization updates main text markers, structured footnote entry markers, textarea prefixes, and legacy fallback text together
- deleting a marker does not break preview or Copy HTML; the reference appears at the end
- row-local marker numbering is converted to document-global WordPress numbering in preview/copy
- visible Preview mode uses WordPress-style refs and bottom footnotes, not literal marker text
- deleted rows are excluded
- supported inline formatting is preserved
- plain URLs in footnotes become links
- generated IDs are stable enough for repeated copy operations

## Open Decisions

- Whether to use generated stable IDs based on row ID and footnote index, or fresh UUID-like IDs each time. Stable IDs are preferred for predictable copy output.
