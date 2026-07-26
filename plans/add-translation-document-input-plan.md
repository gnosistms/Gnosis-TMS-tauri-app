# Add Translation Document Input Plan

## Summary

Expand **Add translations** from a paste-only modal into the same three-mode input
experience used by **Add files**:

- **Upload** — one `.txt`, `.docx`, or `.rtf` file
- **Paste link** — one public Google Docs link
- **Paste text** — the existing textarea flow

Every source is converted to ordered plain-text lines before the existing target-language,
alignment, mismatch, and fill-empty-only workflow begins. Uploaded formatting, images,
comments, metadata, and footnotes are intentionally discarded: the existing chapter rows
remain authoritative for formatting and structure.

## Implementation Changes

### Shared input modal UI

- Extract the reusable initial-input portion of `project-import-modal.js` into one
  configurable project-document-input module used by both Add files and Add translations.
  This module owns the shared input-mode constants and normalization, transient input-state
  initialization/reset helpers, supported-file configuration, segmented control, upload
  drop target, link field, paste textarea, inline errors, loading/disabled behavior, and
  mode-specific primary-button configuration. Do not build a parallel Add-translation copy
  of those behaviors.
- Parameterize labels, supported-format text, data attributes, actions, multiplicity, and
  link help so both callers retain domain-specific copy:
  - Add files continues to support its current formats, batches, Google Sheets, web pages,
    and local paths.
  - Add translations permits one `.txt`, `.docx`, or `.rtf` file and describes Paste link
    as Google Docs only.
- Generalize the existing `project-import-modal__*` presentation rules to neutral shared
  class names and have both modals use them. Preserve the current Add files appearance and
  behavior; do not duplicate its segmented-control or drop-target CSS.
- Keep only domain-specific orchestration in `project-import-flow.js` and
  `project-add-translation-flow.js`. Add files hands the shared module’s acquired source to
  chapter import; Add translations hands it to plain-text extraction and alignment. Their
  language pickers, progress states, warnings, persistence, and completion behavior do not
  belong in the shared module.
- Render Add translations initially with **Upload** selected, matching Add files. Switching
  modes clears errors and mode-specific transient state but retains the value belonging to
  the newly selected mode. Cancel fully resets the modal.
- Keep the post-input screens already owned by Add translations: target-language selection,
  existing-translation warning, mismatch warning, progress, and apply result. Update their
  copy from “pasted translation” to neutral “translation text” where the message can now
  describe all three input methods.

### Frontend flow and file handling

- Extend `createProjectAddTranslationState()` with `inputMode`, `linkUrl`, link-error state,
  selected file metadata, and an input-resolution status/request identifier. Continue using
  `pastedText` as the single canonical string passed to alignment.
- Add Add-translation actions and input handlers parallel to the established Add files
  actions: choose file, submit link, and submit the acquired source. Route mode selection,
  link/paste input updates, picker setup, byte conversion, file-size validation, loading
  state, and link-error presentation through the shared project-document-input module rather
  than maintaining paired handlers in both flows.
- Accept exactly one upload with a native dialog filter and browser `accept` value covering
  `.txt`, `.docx`, and `.rtf`. Reject unsupported or multiple dropped files with an inline
  actionable error rather than silently selecting one.
- Extend the generic native-drop routing so the shared drop-target behavior can dispatch to
  the currently visible Add files or Add translations target without copying coordinate,
  device-pixel-ratio, hover, or browser-drop logic.
- For Upload, call the new text-extraction command, store its returned text in `pastedText`,
  and advance directly to target-language selection. For Paste link, resolve the Google Doc
  through the existing link resolver, require a DOCX result, extract it through the same
  command, then advance. Paste text validates the textarea and advances without extraction.
- Paste link must accept only `https://docs.google.com/document/...` URLs. Google Sheets,
  arbitrary HTML URLs, and local paths remain available in Add files but are rejected here
  before download with Add-translation-specific copy.
- Reuse the existing “Anyone with the link” error/retry experience for inaccessible Google
  Docs. Preserve the entered URL when retrying.
- Guard asynchronous file/link results with the request identifier plus the open chapter ID,
  so canceling, changing modes, or opening Add translations for another chapter cannot apply
  a stale extraction result.

### Plain-text extraction backend

- Add a non-mutating Tauri command with this interface:

  ```text
  extract_project_translation_text({
    fileName: string,
    bytes: number[]
  }) -> {
    plainText: string,
    unitCount: number
  }
  ```

  The command determines the allowlisted format from the filename, enforces the existing
  25 MB import limit, returns user-facing validation errors, and performs parsing in the
  existing blocking-command pattern. It does not read or modify a project repository.
- Introduce a small shared extraction model—ordered, nonblank text blocks—and join blocks
  with one newline for `pastedText`. Keep intentional line breaks inside a block as separate
  alignment units after normalization. Reject documents that yield no text.
- Refactor the existing TXT and DOCX import parsers only far enough to share their tested
  extraction stages:
  - TXT reuses UTF-8/UTF-16 decoding, trims blank lines, and retains source order.
  - DOCX reuses document XML, paragraph, table-row, and Unicode extraction. Return only each
    parsed row’s `plain_text`; omit footnotes, styles, images, comments, tracked-change
    metadata, and import warnings from the alignment payload.
- Add a focused RTF plain-text extractor in the import backend. Preserve paragraph/line
  order, Unicode and surrogate-pair escapes, Windows-1252 hex escapes, punctuation, tabs,
  and visible list text while discarding styling and non-text destinations. Normalize
  CRLF/CR to LF and reject malformed, unsupported-binary, empty, or image-only documents
  with clear messages. Apply the same imported-row/unit ceiling used for TXT/DOCX to prevent
  pathological alignment inputs.
- Keep RTF scoped to Add translations in this change. Do not add RTF as a new-project file
  import format or create RTF-specific chapter metadata.
- Reuse `resolve_project_import_link` for Google Docs download rather than adding another
  HTTP implementation. Add an optional resolver allowlist (omitted by Add files, `["docx"]`
  for Add translations) so the backend also rejects Google Sheets/HTML results before
  returning their contents.

## Public Interfaces

- New registered Tauri command: `extract_project_translation_text`.
- Backward-compatible extension to `resolve_project_import_link` input:
  `allowedFileTypes?: string[]`; omitted means the existing Add files behavior.
- One shared configurable frontend project-document-input module replaces the current
  Add-files-only initial input implementation and serves both modal flows; existing Add files
  public actions and behavior stay compatible with their current callers.
- No changes to the aligned-translation preflight/apply payloads: all new sources converge on
  the existing `pastedText` field.

## Test Plan

- Renderer tests cover all three Add-translation modes, active segmented-control state,
  supported-format/link copy, disabled/loading buttons, inline errors, and neutral wording
  in later alignment screens. Existing Add files renderer tests must remain unchanged in
  behavior after shared-renderer extraction.
- Frontend flow tests cover TXT/DOCX/RTF selection, browser-picker fallback, drag/drop,
  unsupported and multiple files, Google Docs success/access denial/invalid host,
  resolver type enforcement, retry, cancel, mode switching, stale async completion, and
  convergence of all modes on the existing language/preflight payload.
- Rust extraction tests cover:
  - TXT UTF-8, BOM, UTF-16 LE/BE, blank lines, invalid encoding, empty and oversized input.
  - DOCX paragraphs, tables, Unicode, inline styles, footnotes, comments, images,
    malformed/password-protected archives, empty and oversized input.
  - RTF paragraphs, inline formatting, lists/tabs, escaped braces/backslashes, smart
    punctuation, hex escapes, multilingual Unicode (including surrogate pairs), ignored
    destinations, malformed/binary/image-only, empty and oversized input.
  - Unsupported extensions and the maximum extracted-unit limit.
- Link-resolver tests verify that the optional allowlist leaves Add files unchanged while
  restricting Add translations to Google Docs/DOCX.
- Run `npm test`, focused Rust project-import/aligned-translation tests, `cargo check`, and
  `npm run audit:unused`. Manually smoke-test file picking and native drag/drop on macOS and
  Windows because the two platforms use different picker/drop paths.

## Assumptions

- One Add-translation operation accepts one document; batch translation uploads are out of
  scope.
- Extraction is not previewed or edited for Upload/Paste link. Successful extraction moves
  directly to language selection, matching Add files; Paste text remains the editable mode.
- Google Docs must be exportable through the existing public-link mechanism. Google OAuth or
  private Drive access is out of scope.
- Imported rich content never overwrites or augments existing chapter formatting, footnotes,
  images, row flags, comments, or metadata.
- Existing fill-empty-only, mismatch confirmation, duplicate-language, AI-provider, commit,
  and progress semantics remain unchanged.
