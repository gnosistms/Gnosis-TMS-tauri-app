# Project book export

## Goal
Add Export before Add files on active project cards. Reuse the preview export
dialog and its options, exporting every active chapter in the same natural-name
order as the project list into one document.

## Implementation
1. Add project scope to the existing export modal, with common-language selection
   and a project-specific saved default. Keep chapter exports unchanged.
2. Extend the native file/PDF pipeline to load ordered chapters and combine their
   documents with chapter headings and globally numbered, correctly anchored
   footnotes. Preserve images, print settings, and PDF progress/cancellation.
3. Load project preview blocks through native chapter reads for clipboard and
   WordPress exports. Support all chapters for team copy through its existing
   background job.
4. Verify ordering, deleted-file exclusion, language validation, combined content,
   modal rendering, and existing chapter exports with focused tests and builds.

## Validation
Completed:
- Full frontend suite: 3,098 tests passed; final focused export/project suite:
  172 tests passed after completion-dialog coverage was added.
- Workflow suite: 25 passed with loopback access enabled (the sandbox prevented
  the temporary test servers from binding ports on the first run).
- Native export suites: 54 chapter/file, 34 PDF, and 10 team-copy tests passed.
- Two Playwright tests passed in installed Chrome: combined file export and
  project PDF inspection/start/cancellation. Visually inspected the PDF dialog.
- Production Vite build, changed-module ESLint checks, and diff whitespace
  checks passed.
- Unused-code audit reports unrelated existing findings; no project export
  modules or exports were flagged.

## Result
Active project cards expose Export before Add files. The shared export dialog
captures active files in their displayed natural-name order, offers common
languages, and keeps project export defaults separate from chapter defaults.
Document/clipboard/WordPress exports combine chapter content; PDF chapter titles
start new pages. Team copy creates individual chapter copies in sequence. SRT
requires SRT provenance for every chapter and offsets chapter timings into one
continuous subtitle sequence.
