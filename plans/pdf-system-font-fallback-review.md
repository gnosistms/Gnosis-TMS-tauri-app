# PDF system font fallback review

## Goal

Recover from PDF font coverage gaps using locally installed fonts, without bundling
additional font files. Require approval of highlighted excerpts before publishing
the complete, unhighlighted document.

## Design

- Keep curated fonts as the default. Inspect actual rendered text (including title,
  headings, captions and footnotes), resolve missing glyphs against installed fonts,
  and reuse the resolved font choices for both review and final export. Use installed
  files directly; do not copy fonts into the export workspace.
- Generate review excerpts using Typst and the document's existing typography and
  text width. Include only affected paragraphs/blocks, preserve source numbering and
  style, and highlight fallback grapheme clusters with a pale background.
- Keep review and final rendering in one cancellable background export job. Approval
  continues that prepared snapshot; cancellation removes temporary files. Never
  publish an incomplete document or silently omit unsupported characters.
- Report deduplicated coverage gaps through consent-gated telemetry using diagnostic
  metadata only (no document text, paths, images, previews or identifying details).

## Implementation

1. Add installed-font resolution, coverage validation, excerpt preparation and tests
   at the Rust PDF boundary; support font collections and cancellable review jobs.
2. Add review progress payloads, approval command and frontend modal review state.
3. Render excerpt previews and explicit publish/cancel controls; connect telemetry.
4. Verify backend resolution/rendering, frontend approval/cancel/stale-job behavior,
   browser review layout, and existing export regression checks.

## Status

Complete.

## App-wide approval persistence follow-up

Requested: remember approved fallback fonts locally for every document exported
from this app installation, including after restarting the app.

1. Persist approved font faces in an app-level `tauri-plugin-store` preference;
   store font choices only, without document text, glyphs, paths or font bytes.
2. Prefer installed, approved fonts during resolution. Skip review when all chosen
   fallback faces are approved; review only new choices when they are mixed.
   Continue checking character coverage and embedding suitability on each export.
3. Save choices after explicit approval, and explain the remembered choice in the
   review UI. Verify persistence, cross-document reuse, mixed approvals, unavailable
   approved fonts, and cancellation without saving.

Follow-up status: complete.

Verification: 43 Rust PDF tests pass, including preference serialization and disk
round-trip, reuse of an approved face for new characters in another document,
preference over unapproved alternatives, replacement/missing fonts, mixed approval
excerpt selection, and save failure without resuming publication. Real Typst
excerpt/PDF compilation passes. The 69 affected frontend tests and focused ESLint
checks pass; browser checks confirm the additional persistence message fits at the
minimum window size and approval/cancellation still work.

## Verification

- 39 Rust PDF tests pass, including installed Egyptian font coverage, font
  collections, embedding restrictions, stale approvals and cleanup, excerpt
  selection/numbering, and real Typst compilation of highlighted excerpts and the
  complete unhighlighted PDF.
- 2,524 frontend tests and 25 workflow tests pass. Workflow tests were rerun with
  local process/port access after the sandbox blocked their launcher fixtures.
- Production frontend build and focused ESLint checks pass. The unused-code audit
  remains at its pre-existing 345 unused files and 26 unused exports.
- Browser verification with real Typst SVG excerpts covers image loading,
  paragraph/title/heading/caption/footnote samples, minimum-window layout,
  approval of the existing job, and cancellation. Review and final PDF were
  visually inspected on macOS using the four reported Egyptian characters.
- Installed fonts are read in place, with no font copies or added font downloads.
  Windows font discovery is implemented for system and per-user font directories;
  Windows runtime verification is still needed on Windows hardware.

## Contextual approval management

Requested: put saved font approval management in the PDF export dialog, and hide
it for documents whose PDF fonts already cover every character. Open the dialog
immediately and run the relevance check in the existing background font inspection.

1. Share a cached curated-font coverage check between inspection and export. The
   relevance check must not scan installed fonts, resolve fallbacks, render previews,
   or download fonts. Wait for the existing local write queue in the background so
   inspection sees the export text. Respect language and print-content options.
2. Return saved approval summaries only when the current export has a coverage gap
   and its curated fonts are available. Show a compact expandable list; forgetting
   a choice removes that approval at app scope and refreshes inspection.
3. Verify ordinary documents hide the control, fallback documents show it,
   forgetting a choice requires review next time, and late inspection responses
   cannot restore old state. Recheck dialog layout and the export regression tests.

Status: complete.

Verification: 45 Rust PDF tests, 2,528 frontend tests and 25 workflow tests pass.
The 78 focused frontend tests, focused ESLint checks and production build pass;
the unused-code audit is unchanged. Browser checks confirm conditional visibility,
app-wide forgetting and refresh, and layout at the minimum window size. Inspection
race coverage confirms late responses cannot restore outdated saved approvals.

Performance reference on this Mac, synthetic Latin/Vietnamese text: checking
100,000 characters took about 1 ms, and 1,000,000 characters about 6 ms, using
loaded font data. Reading the 5 MB font stack took about 13 ms. These measurements
exclude project loading, IPC and rendering; dialog opening does not await inspection.

## Review fixes: family names and formatting boundaries

1. Align installed-family naming with the bundled Typst renderer, including
   abbreviated face suffixes and English/localized name selection. Add fixtures
   and exercise the installed Armenian/Myanmar collection faces with Typst.
2. Collect fallback graphemes from the same styled text runs emitted to Typst,
   including footnote URL suffixes. Use those runs for excerpt selection too,
   preserving surrounding markup and footnote behavior.
3. Add regression tests for combining marks split by bold/italic/link boundaries;
   verify highlighted review SVGs and the full unhighlighted PDF with Typst, then
   run the existing PDF export tests.

Status: complete.

Verification: all 51 PDF export tests pass with the bundled Typst runtime enabled.
New tests cover abbreviated family suffixes, separated modifiers, Macintosh Roman
and Unicode name records, and actual installed Armenian/Myanmar/Gurmukhi faces.
Combining-mark tests cover bold, italic and link boundaries plus separate footnote
URL runs. Renderer checks compare the selected glyph outlines against direct face
renders in body text, headings, captions and footnotes, verify visible-width review
highlights with automatic fallback disabled, and compile the full unhighlighted PDF.
Focused Rust formatting and whitespace checks pass.
