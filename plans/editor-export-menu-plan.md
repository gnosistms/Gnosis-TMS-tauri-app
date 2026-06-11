# Editor Export Menu Plan

## Status (2026-06-10)

- **Phase 1 is implemented** on `feature/editor-export-menu` (commit `1c71db62
  Replace preview Copy HTML with an Export options modal`). Unit tests pass.
- **Phase 2 is implemented** on the same branch: `chapter_export.rs` gained
  xlsx/rtf/md builders behind `export_gtms_chapter_file`, the editor export
  catalog marks `file:xlsx` / `file:rtf` / `file:md` available, and the
  project-export modal (same Rust command) now offers XLSX/RTF/MD too — only
  SRT remains unsupported there. Notes:
  - XLSX mirrors the import column layout and exports **all** chapter
    languages (header row = language codes, footnotes after `***`), so the
    project-export modal intentionally hides the language select for it.
  - RTF embeds png/jpeg via `\pict` with the DOCX max-page scaling; gif and
    unfetchable URLs fall back to a HYPERLINK field.
  - MD appends `[^n]` refs to the row's paragraph and collects definitions at
    the document end.
- The branch was rebased onto local `main` to pick up `9cfcf56c` (window
  `allow-destroy` capability fix) — unrelated to export work.
- **Phase 3 is implemented** on `feature/wordpress-export` — see
  `plans/wordpress-export-plan.md` for the phase plan, including the resolved
  `meta.footnotes` research item (the WordPress.com wp/v2 proxy accepts it).
  Broker OAuth routes shipped on broker `main` (`c9ea0f8`). `link:wordpress`
  is `available: true`. Still open from Phase 2: the DOCX-to-clipboard
  research item (`copy:docx` stays unavailable).
- Manual verification still pending: macOS + Windows file dialogs, opening the
  exported xlsx in Excel/Google Sheets, rtf in Word, md rendering on GitHub.

## Goal

Replace the "Copy HTML" button on the editor preview toolbar with an "Export
options" button that opens a modal dialog with room to grow. The modal hosts
every way to get a chapter out of Gnosis TMS, organized into three categories:

1. **Save to file** — HTML, XLSX, DOCX, TXT, RTF, MD via the native file picker
2. **Copy and paste** — Plain text, HTML, DOCX written to the clipboard
3. **Link and transfer** — WordPress post export, copy to another Gnosis TMS team

## UI Design

A two-pane modal (wider than the standard confirm modals):

- **Left pane** — a scrollable, collapsible tree. Top level:
  `Save to file`, `Copy and paste`, `Link and transfer`. Expanding a category
  reveals its individual export options. Selecting an option highlights it and
  drives the right pane.
- **Right pane** — the UI for the selected option.
  - File options: "Click Save to export a [FORMAT] file." with `Cancel | Save`.
  - Copy options: "Click Copy to export [format] data to the clipboard for
    pasting into other apps." with `Cancel | Copy`.
  - Options that are not implemented yet: "This export option is not available
    yet." with `Cancel` only (mirrors the existing project-export
    unsupported-format notice).
  - WordPress / team transfer (later phases): option-specific forms.

The exported content is always the chapter currently open in the editor, in the
language selected in the preview toolbar (`selectedEditorPreviewLanguageCode`).

## Existing Infrastructure to Reuse

- `project-export-flow.js` + `export_gtms_chapter_file` (Rust,
  `src-tauri/src/project_import/chapter_editor/chapter_export.rs`) already
  export a chapter to **docx / txt / html** given installationId, repoName,
  chapterId, languageCode, format, and outputPath from a native save dialog
  (`window.__TAURI__.dialog.save`). XLSX/SRT are rejected with an
  "unsupported function" message.
- `editor-preview.js` `serializeEditorPreviewHtml` emits WordPress block markup
  (`<!-- wp:paragraph -->`, `wp:heading`, `wp:image`, core footnotes refs +
  `wp-block-footnotes` list). This is already the WordPress-friendly HTML the
  Link-and-transfer phase needs.
- `editor-preview-flow.js` `writeHtmlToClipboard` (rich clipboard write with
  plain-text fallback).
- Modal conventions: `state.editorChapter.<modal>` state created in
  `state.js`, preserved across background-sync state rebuilds in
  `editor-state-flow.js`, rendered from `screens/*-modal.js`, actions wired in
  `app/actions/translate-actions.js`, styles in `styles/modals.css`.

## Phases

### Phase 1 — Modal shell + working file/copy exports (this change)

New `editor-export-flow.js` owns an option catalog so future options are
additive:

```js
{ id: "file:html", categoryId: "file", label: "HTML", kind: "file", format: "html", available: true }
```

- Categories: `file` (HTML, XLSX, DOCX, TXT, RTF, MD), `copy` (Plain text,
  HTML, DOCX), `link` (WordPress, Other Gnosis TMS team).
- Available now: file HTML/DOCX/TXT (delegate to `export_gtms_chapter_file`
  after `waitForRepoWriteQueueIdle`, exactly like `project-export-flow.js`),
  copy Plain text, copy HTML.
- Everything else renders the "not available yet" pane (no dead Save button).
- Copy HTML writes `text/html` **and** `text/plain` clipboard flavors
  simultaneously so any paste target gets a usable flavor. Copy Plain text
  writes `text/plain`. (The spec's "copies in several formats simultaneously"
  is implemented as multi-flavor clipboard writes per option; if a single
  "copy everything" action is preferred instead, the catalog supports adding
  one later without restructuring.)
- New `serializeEditorPreviewPlainText(blocks)` in `editor-preview.js`:
  visible text per block, inline footnote refs as `[n]`, image captions as
  their own lines, numbered footnote list appended at the end.
- Modal state: `state.editorChapter.exportModal`
  (`isOpen`, `expandedCategoryIds`, `selectedOptionId`, `status`, `error`),
  preserved across editor state rebuilds for the same chapter.
- Toolbar: `Copy HTML` → `Export options`
  (`data-action="open-editor-export-options"`); the old
  `copy-editor-preview-html` action and `copyEditorPreviewHtml` flow are
  removed (their logic moves into the copy-HTML option).

Files touched: `app/state.js`, `app/editor-preview.js`,
`app/editor-export-flow.js` (new), `app/editor-preview-flow.js`,
`app/translate-flow.js`, `app/actions/translate-actions.js`,
`app/editor-state-flow.js`, `screens/editor-export-modal.js` (new),
`screens/translate.js`, `screens/translate-toolbar.js`, `styles/modals.css`,
plus unit tests for the flow, the renderer, and the plain-text serializer.

### Phase 2 — Remaining file formats (Rust)

Extend `chapter_export.rs` with `xlsx`, `rtf`, and `md` builders behind the
same `export_gtms_chapter_file` command, then flip `available: true` in the
catalog. XLSX should mirror the import column layout
(`chapter_import/xlsx.rs`) so an exported file round-trips. MD maps text
styles to Markdown (headings, `>` quotes, images, `[^n]` footnotes). RTF maps
the same inline segments the DOCX writer already produces.

DOCX-to-clipboard (Copy and paste → DOCX) needs research: browsers cannot put
arbitrary flavors on the clipboard, so this must go through a Rust clipboard
command (custom platform flavors; likely RTF flavor on macOS /
`application/x-...docx` registration on Windows). Keep unavailable until that
research lands.

### Phase 3 — WordPress export

The primary target is **WordPress.com-hosted sites** (that is where the
user's blog lives), which means **OAuth2 against the WordPress.com API** —
regular WordPress.com sites do not support core Application Passwords /
Basic auth against their own `/wp-json`. Research summary (verify before
implementing):

- **Auth (WordPress.com, primary).** Register an app at
  `developer.wordpress.com/apps`. Authorization Code flow:
  `GET https://public-api.wordpress.com/oauth2/authorize` →
  `POST https://public-api.wordpress.com/oauth2/token`. The code exchange
  requires the client secret, so it must run in the **broker service** (same
  pattern as the existing GitHub App auth): the desktop app opens the browser,
  the redirect URI lands on the broker, the broker exchanges the code and
  returns the token to the app. The default token is scoped to the single
  blog the user authorized — sufficient here; avoid the `global` scope.
  Validate tokens via `GET /oauth2/token-info`. (Implicit flow is deprecated
  and its tokens expire after two weeks; password grant is dev-only — don't
  use either.)
- **API calls (WordPress.com).** Use the wp/v2 API proxied through
  WordPress.com with `Authorization: Bearer <token>`:
  create `POST https://public-api.wordpress.com/wp/v2/sites/<site>/posts`,
  overwrite `POST .../posts/<id>`, picker `GET .../posts?search=...`,
  media upload `POST .../sites/<site>/media` (multipart), then rewrite image
  `src` in the block markup to the returned `source_url`.
- **Self-hosted sites (secondary, later).** WordPress ≥ 5.6 supports
  Application Passwords (Basic auth over HTTPS against the site's own
  `/wp-json/wp/v2/...`) with no plugin and no broker involvement. Same
  request shapes, different base URL + auth header. Design the Rust client
  around a site descriptor (base URL + auth mode) so both transports share
  one code path.
- `content` accepts raw block markup — which `serializeEditorPreviewHtml`
  already produces, including `wp:footnotes`-compatible footnote refs. Verify
  the footnote meta requirement: core footnotes store content in post meta
  (`footnotes`), so the export must also send `meta.footnotes` JSON; this is
  the main open research item (including whether the WordPress.com wp/v2
  proxy accepts that meta field).
- All HTTP goes through a new Rust module (`src-tauri/src/wordpress/`) — the
  frontend never holds credentials. Store the OAuth token (or site URL +
  application password) via the existing secret-storage pattern
  (`ai_secret_storage.rs`). Long-running export (media uploads) must emit
  progress via Tauri events, not block the IPC call.
- UI: option pane gets "Connect WordPress.com" (OAuth), "create new post" vs
  "overwrite existing post" (with search picker), and an explicit overwrite
  warning before writing.

### Phase 4 — Copy to another Gnosis TMS team

- UI: team select (only teams where `canWriteChapters(team)` — derived from
  `membershipRole` via `permissions.js`, never a new boolean flag), then
  project select within that team, then Export.
- Backend: new Rust command that copies the chapter directory (chapter.json,
  rows, uploaded image assets) from the source repo into the target team's
  project repo with fresh IDs, routed through the repo write queue and
  committed/synced like any other chapter write. Returns a job/status and
  emits progress events; must not block IPC.
- Frontend invalidates the target team's project queries afterward so the
  copy appears via the normal TanStack snapshot path.

## Testing

- `editor-export-flow.test.js` — catalog integrity, open/toggle/select
  reducers, file submit (injected `saveDialog` / `invoke` /
  `waitForRepoQueue`), copy submit (injected clipboard), unavailable options
  cannot submit, state preserved/reset correctly.
- `editor-export-modal.test.js` — renders categories/options, selected option
  pane, unavailable pane, busy state.
- `editor-preview.test.js` — plain-text serialization incl. footnote markers,
  escaped literal markers, images with captions.
- Manual: macOS + Windows file dialog behavior, clipboard paste into Word /
  Google Docs / plain editor.
