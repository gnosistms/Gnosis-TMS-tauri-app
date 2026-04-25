# DOCX Chapter Import

## Summary
Add `.docx` chapter import using the existing TXT import UI flow wherever possible. DOCX files should import text and supported semantic structure into the GTMS editor model, not attempt full Word-format fidelity. Unsupported DOCX formatting is flattened to plain text, with enough metadata and warnings to explain what was preserved or dropped.

## Principles
- Reuse the current project import modal, file picker/drop handling, source-language selection step, import progress, and completion behavior from TXT import.
- Treat DOCX import as a one-way normalization step into GTMS rows.
- Preserve only formatting the editor can represent safely.
- Prefer predictable clean text over partial Word fidelity that the editor cannot maintain.
- Do not add editor rendering features as part of DOCX import unless they already exist in the GTMS editor model.

## Supported Import Semantics
- Paragraphs become editor rows.
- Blank paragraphs are skipped unless later product decisions require explicit empty rows.
- Supported paragraph styles map to existing editor text styles:
  - Normal/body-like styles -> paragraph
  - Word heading styles -> closest supported heading style
- Footnotes import into the existing GTMS footnote field when available.
- DOCX endnotes are not imported in the first implementation; count them as unsupported content in the import summary.
- Multiple footnote references in a paragraph are appended to that row's footnote field in encounter order, separated by blank lines.
- A footnote reference attaches to the row created from the paragraph containing the reference. Footnotes in skipped blank paragraphs are counted as unsupported and are not imported.
- Simple line breaks inside a paragraph are preserved as text line breaks if the editor already supports them.
- Lists are flattened conservatively:
  - each list item becomes one editor row
  - preserve visible numbering/bullet text as a plain-text prefix when extractable
  - use a simple `- ` prefix when a bullet/list item is detected but the concrete marker cannot be resolved
  - do not create a separate list model
- Tables are flattened in a deterministic way:
  - each table row becomes one editor row
  - non-empty cells are joined left-to-right with ` | `
  - blank table rows are skipped
  - nested tables are flattened into the containing cell text when extractable, otherwise counted as unsupported

## Unsupported Formatting Policy
Flatten or drop unsupported DOCX styling:
- fonts, font sizes, colors, highlights
- margins, indents, tabs, page/section breaks
- columns, floating text boxes, shapes, SmartArt
- complex table layout
- tracked changes, comments, bookmarks, custom XML
- unsupported run-level styles

Unsupported styling must not create hidden editor state that later appears as editable formatting.

## Safety Limits
DOCX parsing must fail before extraction when limits are exceeded:
- Maximum uploaded DOCX byte size: 25 MB.
- Maximum total uncompressed ZIP entry bytes: 100 MB.
- Maximum individual XML part size: 20 MB.
- Maximum imported rows: 20,000.
- Maximum extracted text per row: 20,000 characters before trimming.
- Reject encrypted/password-protected DOCX files with a clear error.
- Reject files with path traversal entries, absolute ZIP paths, or unsupported ZIP encryption flags.
- Add a parser timeout or explicit operation budget if the selected parser can loop over attacker-controlled XML without natural bounds.

These numbers are initial guardrails and can be adjusted after testing real user files, but the implementation should keep the checks centralized and covered by tests.

## Import Metadata
Store lightweight source metadata where the existing chapter metadata model supports it:
- `chapter.json` `source_files[0].format`: `docx`
- `chapter.json` `source_files[0].path_hint` and `filename_template`: original DOCX file name
- `chapter.json` `source_files[0].file_metadata.source_locale`: selected source language
- `chapter.json` `source_files[0].file_metadata.serialization_hints.docx`: importer version plus import counters
- row `format_metadata.docx`: source paragraph/table/list position, original style name when present, and warning counters for that row

Do not store bulky DOCX XML or full formatting snapshots in row files for the first implementation.

## User-Facing Import Summary
Add an optional `importSummary` object to the import response returned to `project-import-flow.js`. The frontend owns displaying this through the existing import completion notice path and, if necessary, a warning message in the project import modal result state.

The summary should include:
- number of rows imported
- skipped blank paragraph count
- heading count
- imported footnote count
- flattened list item count
- flattened table row count
- unsupported content counts, including endnotes, comments, tracked changes, embedded images, text boxes, and unknown formatting

The copy should avoid promising round-trip DOCX fidelity.

## Backend Design
- Add a Tauri DOCX import command parallel to the TXT import command.
- Use a structured DOCX parser rather than regexing XML strings directly.
- Run safety checks before and during ZIP/XML extraction.
- Convert DOCX into an intermediate normalized document model:
  - blocks
  - text runs collapsed to editor-supported text
  - footnotes
  - detected semantic style
  - warning counters
- Convert the normalized model into GTMS chapter rows using the same chapter creation path as TXT where practical.
- Keep source word count generation consistent with TXT imports.

## Frontend Design
- Accept `.docx` and the DOCX MIME type in the existing project import picker/drop target.
- Route DOCX files through the same source-language selection modal as TXT.
- Keep batch file upload behavior consistent with TXT multi-file import.
- Use DOCX-specific validation copy only when the selected file cannot be parsed as DOCX.

## Tests
- Frontend:
  - DOCX appears in accepted file types.
  - DOCX selection/drop opens the same source-language step as TXT.
  - batch TXT/DOCX import uses the existing batch source-language flow.
  - invalid DOCX errors render above the drop target.
  - import summary warnings are surfaced after successful DOCX import with flattened/unsupported content.
- Backend:
  - DOCX safety limits reject oversized, encrypted, path-traversal, and malformed ZIP/XML inputs.
  - normal paragraphs import as rows.
  - blank paragraphs are skipped.
  - headings map to supported editor text styles.
  - unsupported styles flatten without failing.
  - footnotes attach to the paragraph row in encounter order.
  - endnotes are counted as unsupported and omitted.
  - lists import one row per list item with deterministic marker prefixes.
  - tables import one row per table row with cells joined by ` | `.
  - malformed or password-protected DOCX files fail with clear errors.
  - source word counts are generated.
  - import counters are written to `serialization_hints.docx` and response `importSummary`.
- Regression:
  - existing TXT import behavior is unchanged.
  - existing XLSX import behavior is unchanged.

## Milestones

### M1: discovery and parser choice
Inspect current TXT import boundaries and choose the smallest viable DOCX parser approach. Confirm whether an existing Rust crate can parse paragraphs, styles, footnotes, lists, and tables without adding a heavy dependency.

M1 must also lock:
- exact safety constants
- parser rejection behavior for encrypted/password-protected DOCX
- table flattening behavior
- list marker behavior
- footnote/endnote behavior
- import summary payload shape

### M2: normalized DOCX model
Implement DOCX-to-normalized-document conversion behind backend tests, including safety checks and import counters. Do not wire UI yet.

### M3: GTMS chapter creation
Convert the normalized model into GTMS chapter rows and metadata. Reuse TXT chapter creation helpers where possible.

### M4: frontend routing
Add DOCX to picker/drop acceptance and route it through the existing source-language modal and import progress flow.

### M5: summaries and hardening
Add import summary/warning counts, malformed DOCX handling, and regression coverage for TXT/XLSX.

## Non-Goals
- DOCX export.
- Round-trip formatting fidelity.
- New editor formatting capabilities.
- Full Word layout support.
- Preserving tracked changes or comments.
- Importing embedded images in the first pass.

## Open Decisions
- Whether inline bold/italic should be preserved if the editor already supports inline markup, or flattened for the first version.
- Whether the initial safety constants should be stricter than the proposed defaults after testing real files.
