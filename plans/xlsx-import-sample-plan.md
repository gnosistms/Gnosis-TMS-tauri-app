# XLSX import format recovery

1. Verify the Rust XLSX parser and the supplied workbook. Identify format failures separately from permission, disk, and sync failures.
2. Bundle an importable sample with three languages, duplicate language variants, supported inline markup, footnotes, multiline/blank cells, and a separate conversion guide. Verify the actual file with the Rust parser.
3. Replace format errors with the requested persistent warning and download action for single and batch imports. Save the bundled workbook through the native save dialog and a Rust command.
4. Test parsing, warning rendering, batch recovery, download/cancel/failure behavior, and run frontend checks and a build.

Existing unrelated working-tree changes are outside this task.

## Completed

### Follow-up: explain the examples in the workbook

Revise the sample's own text to explain the two English columns, numbered/unnumbered/footnote-only examples, and blank cells. Expand the guide with an exact cell-to-imported-footnotes walkthrough and legacy asterisk/placeholder conversion rules. Keep standard HTML explanations brief. Recheck the sample with the Rust importer and visually inspect both sheets.

Completed: the first sample row now explicitly explains English 1 / English 2 and when to remove the extra English column. Footnote examples describe their own behavior; the guide has an exact before/after walkthrough and matched-numbering rules. The eight XLSX parser tests pass against the revised file, and the frontend footnote parser confirms matching references and two notes in all four language columns. Both sheets were visually verified.

- Confirmed the supplied Lokalise workbook has `Key, es, en, vi` headers. `Key` is rejected by the language-only XLSX parser.
- Bundled `src-tauri/resources/gnosis-tms-import-sample.xlsx`, with English, Vietnamese, Simplified Chinese, an alternate English column, and an ignored second-sheet conversion guide. The native save command embeds the workbook, so downloading needs no network or repository access.
- XLSX parsing failures carry `PROJECT_IMPORT_INVALID_FORMAT:` through single and batch imports. Other errors retain their existing behavior. Batch failures retain the original filename separately from their error text.
- Added the requested warning, a keyboard-accessible sample download action, and a less-rounded warning box for the longer text.

## Verification

- Rust project-import tests: 310 passed, including parsing the bundled workbook (15 rows), skipping the guide, preserving examples, rejecting malformed files, and saving identical sample bytes.
- Frontend suite: 2,059 passed. Focused import/render/download tests: 62 passed.
- Workflow tests: 17 passed outside the sandbox, which otherwise prevents their temporary servers from binding localhost.
- Chrome browser test: passed with the installed Chrome channel; the configured Playwright Chromium binary is absent. Verified rendered warning and keyboard activation through the project action dispatcher to the native command boundary. Actual OS dialog interaction and Windows packaged behavior were not exercised.
- Production frontend build passed. Both workbook sheets were visually inspected.
- Unused-code audit has only existing findings outside this change; targeted ESLint has no errors and one pre-existing unused-variable warning in the import flow.
- The Rust cache guard was run with its configured cache ceiling raised from 20 to 22 GiB for this run, preserving the 30 GiB free-space minimum and all caches used by running binaries.
