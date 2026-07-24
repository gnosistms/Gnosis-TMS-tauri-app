# SRT Subtitle Support Plan

> **Status: implemented 2026-07-24.** All phases landed as planned, with one
> deviation: the auto-timing for manually inserted rows is computed in the Rust
> insert command (which already holds the neighbor rows) instead of being
> computed in the frontend and passed over IPC — fewer moving parts, same
> rules. Import writes only the row base timing (`format_metadata.srt`); the
> source language inherits it like every other language until edited.
>
> **Post-implementation additions (same day), from testing with a real
> YouTube auto-caption file:**
> - Cues are located by their `-->` timing lines, not blank-line separation
>   (YouTube puts a blank line inside each cue).
> - Rolling-caption files (many sub-100 ms filler cues whose text is empty or
>   repeated by a neighbor; ≥3 fillers and ≥⅓ of cues) are collapsed at
>   import to one row per spoken line, timed from the line's appearance to the
>   next line's appearance, fillers absorbed so rows stay adjacent. The import
>   notice reports "Merged rolling captions: X cues became N rows"
>   (`srtImportSummary` on the import response). Normal SRT files import
>   unchanged.
> - Rows whose text is empty in a language are exempt from the 250 ms
>   minimum-duration error in that language (an empty cue is deliberate
>   spacing); overlap checks still apply.

Add SRT (SubRip) subtitle files as an import format, an export format (gated on
import provenance), and per-language editable timestamps in the editor.

## Requirements

1. Import `.srt` files as chapters.
2. Export chapters as `.srt` files.
3. The SRT export option is only available for chapters that were imported from
   an SRT file.
4. In the editor, display timestamps on the row card, above each language. Each
   language has its own timestamps.
5. Timestamps are editable: two text fields (start, end) inline on the same
   line. Format is validated on blur; timing-consistency errors (overlap,
   too-short duration) are computed whenever rows are drawn, so errors that
   already existed in the imported file are visible too.
6. Timestamps come from the imported file. Each language's timestamps are
   copies of the imported file's timestamps unless the user edits them.
7. SRT chapters get a "Has timing error" row filter.
8. Rows created manually in an SRT chapter are given automatic timing that
   fits the gap between their neighbors.

## Design

### Timestamp data model

Two layers, mirroring how the rest of the row model separates provenance from
editable state:

**1. Row base timing (row level).** Written once when the row comes into
existence — parsed from the imported file, or computed from neighbors for
manually inserted rows — and not edited afterwards:

- `RowFile.format_metadata.srt` (written by `build_row_file` in
  `src-tauri/src/project_import/chapter_import/write_gtms.rs`, alongside the
  existing `txt`/`docx`/`html`/`xlsx` blocks; also written by the editor's
  insert-row command for SRT chapters):
  ```json
  "srt": { "sequence_number": 12, "start_ms": 62500, "end_ms": 64800 }
  ```
  (`sequence_number` is absent for manually created rows.)

**2. Editable per-language timing (field level).** A new optional member of
the per-language field value:

- Import side: `FieldValue` in `chapter_import/mod.rs` gains
  `timing: Option<FieldTiming>` where `FieldTiming { start_ms: u64, end_ms: u64 }`.
- Editor side: `StoredFieldValue` in `chapter_editor/mod.rs` gains the same
  field with `#[serde(default)]` so existing row files keep deserializing.

Timestamps are stored as **integer milliseconds**, not strings. SRT's
`HH:MM:SS,mmm` has exactly millisecond precision, so ms integers round-trip
losslessly, compare trivially for the ordering validation, and avoid ever
persisting a malformed string. Display formatting happens in the frontend.

**Inheritance rule (requirement 6).** At import, the source language's field
gets `timing` set from the parsed cue. Other languages (added later via
`update_gtms_chapter_languages`, or empty target fields) **inherit by
fallback**: wherever a language's field has no `timing`, the editor and the
exporter fall back to the row's `format_metadata.srt` timing. The first time
the user edits a language's timestamps, a per-language `timing` override is
persisted and the fallback stops applying for that language. This handles
languages added after import with no copy-on-add machinery, and satisfies
"copies of the imported file's timestamps unless the user edits them."

### Timing validation model

Timing errors are **derived state, computed when rows are drawn** — not
stored, and not only checked on blur. This way errors that were already
present in the imported file show up immediately, and an edit to one row
automatically updates the error marks on its neighbors. Blur only performs
*format* validation (can the input be parsed at all); everything else is
recomputed from the persisted row data on render.

For each language independently, using each row's **effective timing**
(per-language override, else the row's base timing), over active rows in
order-key order, three error kinds:

1. **Too short** — `end - start < 250 ms` (this includes `end < start`).
   Conservative minimum readable duration. Marks **both** the start and end
   inputs of that row.
2. **Start overlap** — `start < previous row's effective end`. Marks this
   row's **start** input *and* the previous row's **end** input.
3. **End overlap** — `end > next row's effective start`. Marks this row's
   **end** input *and* the next row's **start** input. (2 and 3 are the same
   comparison seen from both sides — the computation walks adjacent pairs
   once and marks both rows of an overlapping pair.)

Adjacency (`start == previous end`) is not an error; only strict overlap is.

**Marking**: an input in error gets a red outline
(`.translation-timing__input--error`), so the user can see whether the start
or the end time is the problem. All marks are non-blocking — values persist
normally.

The computation lives in a pure helper module (`timing-validation.js`:
sequence of `{startMs, endMs}` in, per-row `{startError, endError}` out) so
the row renderer, the filter, and unit tests share one implementation.

**"Has timing error" filter** (SRT chapters only): a new option in the
editor's existing row-filter system. A row matches when any of its languages'
effective timing has any error above. Because filters already force full
`translate-body` renders (scoped patches are disabled while filtering), the
match set stays correct as edits change which rows are in error.

### Automatic timing for manually created rows

In an SRT chapter, inserting a row computes base timing from its neighbors'
effective timings (in the language-independent base sense — neighbors'
`format_metadata.srt` / overrides are compared via the source language):

- `start`: previous row's end + 1 ms; `0` if inserting at the top.
- `end`: next row's start − 1 ms; if there is no next row (appending at the
  bottom), `start + 10 s`.
- If the gap is too tight (`end - start < 250 ms`), still use
  `end = next start − 1 ms` and let the too-short error show.
- If there is no gap at all (`next start − 1 ms ≤ start`), set
  `end = start + 250 ms` and let the overlap error show on this row's end and
  the next row's start.

Row creation is never blocked for timing reasons — the red outlines tell the
user what to fix. The computed timing is written as the row's
`format_metadata.srt` base timing (see below), so all languages inherit it
exactly like imported rows. Manual rows in non-SRT chapters get no timing.

### Export gating (requirement 3)

`chapter.json` already records `source_files[].format` (`SourceFile` /
`SourceFileMetadata`, `chapter_import/mod.rs:260-277`), and the editor
read-model `StoredChapterFile` (`chapter_editor/mod.rs:819-835`) already
deserializes `source_files`. Gate = **any source file with format `"srt"`**.

- Backend: `export_gtms_chapter_file_sync` (`chapter_export.rs`) accepts
  `"srt"` only after checking the loaded chapter's `source_files` for an SRT
  entry; otherwise returns an error. (Defense in depth — the UI also hides it.)
- Frontend: the chapter payload the UI already receives must expose a
  `sourceFormats` (or boolean `canExportSrt`) field so the export modal can
  gate the option. Find where chapter summaries are serialized for the
  projects list / editor load and add the field there.

The export modal option is **hidden** (not shown-disabled) for non-SRT
chapters, following the existing platform-gating pattern in
`editorExportCategories()` (`src-ui/app/editor-export-flow.js:85-89`) rather
than the `available: false` pattern.

## Implementation Phases

### Phase 1 — Rust: SRT parser + import command

New file `src-tauri/src/project_import/chapter_import/srt.rs`, modeled on
`txt.rs`:

- Decode bytes UTF-8/UTF-16 BOM-aware (reuse txt's decoding helper).
- Parse cue blocks separated by blank lines:
  - optional numeric index line (ignored for ordering; recorded as
    `sequence_number`, falling back to position if absent/non-numeric),
  - timing line `HH:MM:SS,mmm --> HH:MM:SS,mmm` — tolerant parsing: accept
    `.` as the millisecond separator, 1–2 digit hours, surrounding
    whitespace, and ignore trailing SRT position hints (`X1:… Y1:…`),
  - one or more text lines, joined with `\n` into `plain_text` (multi-line
    cues stay one row).
- Reject cues with `end_ms < start_ms` or unparseable timing lines with a
  clear error message including the line number. Cap at the existing
  20,000-row limit; enforce `MAX_IMPORT_FILE_BYTES`.
- Produce a `ParsedWorkbook` with a single source language (like txt), each
  cue an `ImportedRow` whose source-language `FieldValue.timing` is set, and
  per-row SRT metadata threaded through to `format_metadata.srt`.
- `source_format: "srt"` so `SourceFile.format` in `chapter.json` records it.

Wiring:

- `FieldValue` + new `FieldTiming` struct in `chapter_import/mod.rs`; write it
  in `build_row_file` / the field serializer in `write_gtms.rs` (omit when
  `None`).
- New command `import_srt_to_gtms` in `src-tauri/src/project_import.rs`
  (copy the `import_txt_to_gtms` wrapper shape), registered in `lib.rs`.
- Batch dispatch: add `"srt"` arm to `parse_project_import_file`
  (`chapter_import/mod.rs:591-628`).
- Tests in `srt.rs`: happy path, CRLF, BOM, `.` separator, missing index,
  multi-line cue, malformed timing error, out-of-order input preserved as-is.

### Phase 2 — Rust: SRT export

In `src-tauri/src/project_import/chapter_export.rs`:

- Add `"srt"` to the accepted-format match, behind the provenance check
  described above.
- `render_srt_document(rows, language_code)`:
  - Walk active rows in `order_key` order (same iteration as
    `build_export_document`).
  - Per row, timing = the selected language's `StoredFieldValue.timing`,
    falling back to `format_metadata.srt`. Every row in an SRT chapter should
    have base timing (import writes it; manual insertion computes it), so a
    row with no timing in either place should not occur — as a safety net,
    such rows are skipped and the export result message reports the count
    rather than failing or silently dropping lines.
  - Emit renumbered sequential indices (1..n), `HH:MM:SS,mmm --> HH:MM:SS,mmm`
    formatting (zero-padded, hours can exceed 2 digits), the language's
    `plain_text` (rows whose text is empty are still emitted, with empty
    text, so timing structure is preserved), blank line between cues, `\n`
    newlines, UTF-8 without BOM.
- `StoredFieldValue` timing (Phase 1 struct) must be readable here; also add
  a `StoredRowFormatMetadata`-style accessor for `format_metadata.srt` since
  the current editor read-model does not deserialize `format_metadata`.
- Tests: import→export round trip preserves timings and text; per-language
  override wins over imported timing; skipped-row accounting.

### Phase 3 — Frontend: import wiring

`src-ui/app/project-import-flow.js`:

- Add `.srt` (+ `application/x-subrip`) to `PROJECT_IMPORT_ACCEPT` (line 43)
  and `PROJECT_IMPORT_DIALOG_FILTERS` (line 48).
- `detectImportFileType` (line 55): `srt → "srt"`.
- `importFileTypeNeedsSourceLanguage` (line 72): srt requires a source
  language, like txt.
- `importProjectFileResult` (line 870): dispatch to `import_srt_to_gtms`.
- Drag-drop and link import inherit this automatically via
  `detectImportFileType`.

### Phase 4 — Frontend: export option

- Expose the chapter's source formats to JS (Phase 2 backend field) and thread
  it into the export modal state in `editor-export-flow.js` /
  `editor-export-modal.js`.
- Add an SRT entry to the `file` category in `BASE_EDITOR_EXPORT_CATEGORIES`
  (`editor-export-flow.js:47-79`); filter it out in `editorExportCategories()`
  when the chapter has no SRT source file.
- Submit path reuses `submitEditorFileExport` (native save dialog with `.srt`
  extension → `export_gtms_chapter_file`). Language selection works exactly as
  for txt (single-language export).

### Phase 5 — Frontend: editor timestamp display + editing

**Row model** (`src-ui/app/editor-state-flow.js`, `normalizeEditorRow`
lines 474–538):

- Add `timings` (map langCode → `{startMs, endMs}` or `null`) with the usual
  `baseTimings` / `persistedTimings` copies for dirty tracking and 3-way
  merge; add row-level `importedTiming` from `format_metadata.srt`.
- Dirty compare in `editor-row-persistence-model.js` (`rowHasFieldChanges`),
  same pattern as footnotes.

**View model** (`src-ui/app/editor-screen-model.js`, sections builder
lines 179–270): per-language `timing` = override ?? `importedTiming`, plus
`showTiming` (chapter has SRT source) and `timingInherited` flags; respect
`row.canEdit` for editability. Timing errors (`startError` / `endError` per
language) are computed here from the ordered active-row sequence via the
shared `timing-validation.js` helper, so render and filter agree.

**Render** (`src-ui/app/editor-row-render.js`): new
`renderEditorTimingFields(row, language)` rendered inside each
`translation-language-panel`, **above** the text field (between the panel
header and `renderEditorLanguageField` output). Structure:

```
.translation-language-panel__timing
  input[type=text].translation-timing__input  data-editor-timing-field
      data-row-id data-language-code data-timing-kind="start"
  span.translation-timing__separator  "→"
  input[type=text]  … data-timing-kind="end"
  (optional) .translation-timing__error  — inline message on format failure
```

Inputs whose timing is in error (per the validation model above) carry
`.translation-timing__input--error` — a red outline on exactly the input(s)
at fault: start and/or end for overlaps, both for a too-short duration.

Values render as `HH:MM:SS,mmm`. Plain inputs, not textareas, so the
`editor-row-patch.js` focused-row morph path is unaffected (it only guards
the focused `[data-editor-row-field]` textarea); verify blur → patch does not
steal focus from a timing input mid-edit — extend
`captureFocusedEditorField`/`restoreFocusedEditorField` to also snapshot
`[data-editor-timing-field]` if needed.

**Blur handling + persistence** (new module `editor-timing-flow.js` + hooks
in `translate-editor-dom-events.js`, following the existing
requestAnimationFrame-deferred blur pipeline at lines ~540–580):

- Parse the input: accept `H{1,3}:MM:SS[,.]mmm` (and bare `MM:SS,mmm`),
  normalize to canonical display form.
- **Format invalid** → keep the user's text in the input, show the inline
  format error, do not persist. This is the only blocking check.
- On a valid, changed value: write the override into `row.timings`, mark row
  dirty, persist via the existing blur persistence path, and re-render the
  edited row **plus its previous and next rows** (scoped patch with three row
  ids) so overlap marks on neighbors update immediately.
- All consistency errors (too short, overlaps) come from the render-time
  computation in the view model — the blur handler does not duplicate them.

**Persistence plumbing**:

- `persistEditorRow` (`editor-persistence-flow.js` lines 1946–1975): include
  `timings` + `baseTimings` in the payload.
- Backend `UpdateEditorRowFieldsInput` / batch variant
  (`chapter_editor/mod.rs:273-327`): add optional
  `timings: BTreeMap<String, Option<StoredFieldTiming>>`; `row_fields.rs`
  merges it into each field object like footnotes/captions (3-way merge with
  base for concurrent-save safety).
- Conflict resolution UI: timing participates like other field content —
  simplest correct behavior is last-writer via the existing merge; no special
  conflict card UI for timing in this iteration.

**"Has timing error" filter**: add the option to the editor's row-filter UI
and predicate set, rendered only when the chapter is SRT-sourced. The
predicate reuses the per-row error map computed by `timing-validation.js`
over the full active-row sequence (any language, any error kind → match).

**Manual row insertion** (auto-timing rules in the design section): the
frontend insert-row flow computes `{startMs, endMs}` from the in-memory
neighbors' effective timings and passes it to the insert-row Tauri command as
an optional input field; the backend writes it as `format_metadata.srt` on
the new row file. Omitted (and not computed) for non-SRT chapters.

### Phase 6 — Tests & docs

- Rust: parser + exporter unit tests (Phase 1/2), command-level import test
  fixture `.srt`.
- `npm test`: timing parse/format helpers, and `timing-validation.js` —
  too-short marks both inputs, overlap marks both rows (end of the earlier,
  start of the later), adjacency is clean, per-language independence,
  auto-timing computation for inserted rows (top, middle, tight gap, no gap,
  append with 10 s duration).
- `npm run test:browser`: one integration test — import fixture (including a
  pre-existing overlap so the imported-error case is covered), open editor,
  see timing fields with red outlines on the overlapping pair, "Has timing
  error" filter shows only those rows, edit start with invalid format →
  format error shown, valid edit → persisted and neighbor marks update,
  insert a row → auto timing, export SRT → content matches.
- Update `src-ui/AGENTS.md` / `src-tauri` module docs where import formats are
  enumerated.

## Out of scope

- VTT or other subtitle formats (the parser/renderer split makes VTT a small
  follow-up).
- SRT position/styling hints (`X1:…`, `<i>` tags pass through as literal text
  like other inline markup).
- Timeline/waveform UI, duration warnings (reading-speed checks).
- Re-timing tools (shift all, ripple edit).

## Resolved decisions (2026-07-24 review)

1. Timing-consistency errors are non-blocking and computed at render time (so
   errors present in the imported file are shown too); only format errors
   block persisting.
2. Minimum duration between start and end: 250 ms; violations mark both the
   start and end inputs.
3. Overlap errors mark both rows of the pair — the earlier row's end input
   and the later row's start input — via red outlines on the inputs at fault.
4. SRT chapters get a "Has timing error" row filter.
5. Manually created rows get automatic base timing fitted to the neighbor
   gap (first row starts at 0; appended last row lasts 10 s); creation is
   never blocked — impossible fits just show the error outlines.
6. Export emits empty-translation rows (with empty text) rather than
   dropping them.
