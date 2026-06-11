# Editor Insert Link Plan

**Status: implemented** (2026-06-11). All sections below are done; verified with
unit tests (JS + Rust) and in the browser via the `?fixture=editor` dev fixture.

Add an "Insert HTML link" button to the per-row text-style action row (between the
`*` footnote button and the img buttons), backed by first-class `<a href="...">`
support in the inline markup grammar.

## Background / Key Findings

- The inline markup grammar (`src-ui/app/editor-inline-markup/`) has a fixed,
  attribute-less tag set. `<a href="...">` is currently treated as plain text, so
  without grammar support: glossary matching fires inside URLs, static view shows
  escaped tag text, and word counts / search / AI prompts are polluted.
- `serializeNodes` in `serialize.js` is also the canonical markup serializer used by
  `toggleInlineMarkupSelection` rebuilds — without attribute support, any b/i/u
  toggle on a row containing a link would silently strip the href.
- Glossary underlines are **suppressed while the textarea is actively editing**
  (`suppressGlossaryWhileEditing` in `editor-glossary-flow.js`), so raw-text display
  of `<a href="...">` in the textarea has no overlay-alignment problem.
- Glossary `<mark>` injection is generic over element nesting — marks render
  correctly inside `<a>` once it is a supported element. The href lives in the tag
  token, so it is excluded from base/visible text automatically.
- WordPress export content is built in JS via `renderSanitizedInlineMarkupHtml`
  (`editor-preview.js` → `serializeEditorPreviewWordPress`) — links flow through
  once the grammar supports them. The Rust file exports (HTML/TXT/DOCX in
  `chapter_export.rs`) have a separate exact-string `allowed_inline_tag` list that
  needs attribute-aware handling for `<a>`.
- Static display fields are `<button data-editor-display-field>` elements whose
  pointerdown/click activate editing (`translate-editor-dom-events.js`) — link
  clicks must be intercepted there and routed to `openExternalUrl` (runtime.js,
  tauri-plugin-opener).
- Toolbar buttons keep the textarea selection alive via a `mousedown` →
  `preventDefault()` selector list in `translate-editor-dom-events.js`; the link
  button must be added to it.

## Changes

### 1. Grammar: `a` tag with `href` (src-ui/app/editor-inline-markup/)

- `parser.js`: parse attributes in tag tokens. Only `a` accepts attributes, and
  only `href` with a quoted value. Href must be http(s) or the tag is treated as
  plain text (and therefore HTML-escaped on render — safe default for
  `javascript:` etc.). HTML entities in the stored href are decoded on parse;
  serialization re-encodes (round-trip stable after first canonicalization, same
  contract as the `b`→`strong` alias normalization). Element nodes gain an
  `attributes` field. Add `a` to `SUPPORTED_TAGS`; no entry in `STYLE_TO_TAG` /
  `TAG_TO_STYLE` (links are not a toggleable style).
- `serialize.js`: emit ` href="..."` (escaped) in `serializeNodes`,
  `serializeNodesWithAllowedTags`, and `renderNodesForHistoryHtml`.
- `transforms.js`: no logic change needed — `cloneNode` spreads `attributes`, and
  generic element splitting duplicates the link with its href on both halves.
- Tests in `editor-inline-markup.test.js`: round-trip, sanitization (`javascript:`
  href escaped as text), visible/base text excludes href, glossary mark inside a
  link, style toggle preserves href.

### 2. Insert-link UI flow

- `state.js`: `createEditorInsertLinkModalState()` → `{ isOpen, mode:
  "no-selection" | "url", rowId, languageCode, selectionStart, selectionEnd,
  selectedText, urlDraft }` on `state.editorChapter.insertLinkModal`; reset in
  `editor-state-flow.js` alongside `imageInvalidFileModal`.
- New `editor-link-flow.js`: open (reads the cluster textarea selection; collapsed
  → info modal, else URL modal), update draft, validate leniently the way browser
  address bars do (scheme-less input like `google.com/privacy` normalizes to
  `https://…`; requires a dotted hostname or `localhost`; rejects non-http(s)
  schemes such as `mailto:`/`javascript:` and credential-bearing hosts like
  `google.com@evil.com` — the stored markup grammar itself still only accepts
  explicit http(s) hrefs), submit (re-locate textarea, verify the captured selection slice is
  unchanged, wrap selection in canonical `<a href="...">…</a>` — or, when the
  selection sits inside an existing `<a>`, replace that link's href — then apply
  via `applyEditorRowFieldInput` exactly like `toggleEditorInlineStyle`), close.
- New `screens/editor-insert-link-modal.js` with both modal variants per spec
  (eyebrow INSERT LINK; standard `modal-backdrop` / `modal-card` / `field__input`
  classes; Ok disabled until valid; small dark-red error text "Enter a valid URL").
  Mounted in `screens/translate.js` modal chain.
- `editor-row-render.js`: link button in the secondary group, before the image
  buttons; tooltip "Insert HTML link"; unicode 🔗 (U+1F517 + U+FE0E text
  presentation) label.
- Wiring: `translate-actions.js` (`open-editor-insert-link` in
  SESSION_WRITE_ACTIONS + handlers for submit/cancel/info-ok),
  `input-handlers.js` (draft input + live Ok/error toggling, Enter/Escape),
  `focused-input-state.js` selector, `translate-editor-dom-events.js`
  mousedown-preventDefault list.

### 3. Static-view link behavior

- `translate-editor-dom-events.js`: intercept pointerdown/click on `a[href]`
  inside display fields / static text / preview; open via `openExternalUrl`;
  never navigate the webview; do not enter edit mode.
- `styles/translate.css`: link color + underline in static text; glossary mark
  inside a link drops its own underline (mirrors the existing `u:has(mark)` rule)
  and uses pointer cursor; glossary tooltip attributes still work.
- Small error-text style for the modal (`.editor-insert-link-modal__error`) —
  the shared `.modal__error` is a banner box, spec wants discrete small text.

### 4. Rust file exports (`chapter_export.rs`)

- Attribute-aware recognition of canonical `<a href="...">` / `</a>` alongside
  `allowed_inline_tag`. Per-format behavior:
  - **HTML**: real `<a href>` with re-escaped href; orphan `</a>` and non-http(s)
    hrefs escape as text (`sanitize_inline_html` tracks open/close balance).
  - **Markdown**: `[text](<url>)`; consecutive segments sharing an href group into
    one link so mixed styling stays inside the brackets.
  - **DOCX**: field-based hyperlink (`fldChar`/`instrText HYPERLINK`) so paragraph
    rendering stays decoupled from the relationships file; linked runs get the
    standard blue underline.
  - **RTF**: `{\field{\*\fldinst HYPERLINK "url"}{\fldrslt {\ul text}}}` (same
    field form the image-link fallback already used).
  - **TXT**: link text plus a trailing ` (url)` via `txt_inline_text` (the shared
    `inline_visible_text` stays URL-free for ruby extraction).
  - **XLSX**: raw canonical markup in cells, by design — the workbook is the
    round-trip interchange format and the XLSX import stores cell text verbatim.
- `InlineStyleState` carries `link: Option<String>`; `link_grouped_segments`
  groups runs per href for md/rtf/docx.
- Unit tests per format in the existing test module.

## WordPress export validation (added 2026-06-11)

- A temporary Gutenberg validation test (`editor-preview-wordpress-validation.test.js`)
  loaded Gutenberg's own `@wordpress/blocks` + `@wordpress/block-library` (CJS
  builds under a jsdom window) and asserted every exported block parsed valid
  with zero validation issues AND that `serialize(parse(content))` reproduced
  the export byte-for-byte — so the WP editor never rewrites or "recovers" a
  post. **Removed after the manual export was visually verified on
  gnosisvn.org (2026-06-11)** — it was discovery tooling, and the canonical
  markup it derived is now pinned as exact strings by the cheap tests in
  `editor-preview.test.js`. To resurrect it (do this whenever the WordPress
  serializer markup changes, since WordPress moves its canonical forms over
  time — e.g. paragraph `align` → `textAlign`): restore the test file from git
  history and `npm i -D @wordpress/blocks @wordpress/block-library jsdom`, plus
  a `package.json#knip.ignoreDependencies` entry for the two @wordpress
  packages.
- That test forced serializer fixes in `editor-preview.js`: headings gain
  `class="wp-block-heading"`, quotes wrap an inner `wp:paragraph` block,
  indented uses `{"style":{"spacing":{"padding":{"left":"2em"}}}}` (the old bare
  inline style was mangled into nested `<p><p>` by Gutenberg's deprecation
  migration), centered uses `{"style":{"typography":{"textAlign":"center"}}}`,
  images use the canonical `alt=""/>` spacing, and blocks join with `\n\n`.
- The Rust `resize_image_block` exact-match patterns were updated for the
  canonical img spacing (it still accepts the legacy spaced form).
- `tests/fixtures/wordpress-style-sample.html` is an importable chapter with
  every text style, inline markup, a link, ruby, and an image, for manual
  visual verification of the published post. HTML import cannot mark
  indentation or footnotes, so the fixture's rows instruct the user to apply
  the I style and add a footnote by hand after importing.
  `wordpress_style_sample_fixture_imports_with_every_mappable_style` in
  `chapter_import/html.rs` guards the fixture.

## Out of scope / noted

- Project search index (Rust trigram) indexes raw markup today for all tags;
  hrefs add noise there but this predates links. Editor in-app search uses
  visible text and is unaffected.
- AI translate prompts pass raw markup through; verify model link preservation
  separately.
- DOCX true hyperlinks (relationship entries) — future enhancement.
- `renderNodesForHistoryHtml` history pane links render styled but are not
  click-targets (history HTML is informational).
