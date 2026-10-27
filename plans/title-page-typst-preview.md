# Title page preview from the PDF typesetter

Replace automatic title balancing with ordinary wrapping at available width.
Preserve explicit line breaks entered by the user. Keep normal title-page word
spacing, 30pt titles, 14pt subtitles, and the existing leading and logo sizing.

1. Reuse the PDF document preparation and Typst renderer to generate a title-only
   SVG preview at the selected paper size, including the logo and font fallbacks.
   Start a background job; superseded jobs cancel and temporary files are removed.
   Preview preparation must not evict the active export image cache.
2. In step 1, use a wider three-pane view: book list, all title-page editing fields,
   and the actual rendered page. No separate title-info screen. Title is
   multiline: Enter inserts an explicit break. Debounce updates and replace only
   the preview output, retaining the editor, selection, and scroll. Ignore stale
   completions across edits, selections, languages, projects, and modal sessions.
3. Cover natural wrapping, explicit breaks, preview/export parity, stale jobs,
   edit persistence, error recovery, paper changes, and existing export workflows.
   Inspect rendered examples using the PDF skill.
4. Mirror scoped changes to the original dev checkout, verify the running app is
   rebuilt, and update PR 384 without disturbing other local work.

## Implemented and verified

Natural full-column wrapping replaces automatic balancing. Enter in the Title
textarea preserves an explicit LF in saved settings and export input. A wider
three-pane editor puts title, subtitle, author, translator, and publisher logo
together beside the actual typeset page; the paper-size preference is shared
with final export. Narrow windows stack the form and preview.

The native preview compiles SVG pages from the same PDF preparation path and
fonts, with jobs/events, cancellation of superseded jobs, and temporary workspace
cleanup. Its disabled image-cache session cannot evict the active export target.
The frontend debounces requests, ignores stale results, supports retry after an
error, and patches only proof output while retaining the form and caret.

Validation: 59 native PDF tests passed with actual Typst PDF/SVG compilation;
3,076 frontend tests and 25 workflow tests passed; all 13 export browser tests
passed. Real rendered output was inspected at desktop and narrow window sizes.
The A5 proof confirms natural three-word/one-word wrapping and the explicit
two-word/two-word break. Strict Clippy, ESLint, Rust formatting, production build,
and whitespace checks passed. The unused-code audit retains its baseline of
41 files and 16 exports.

Scoped changes were applied to the original dev checkout without replacing other
local edits. Its watcher rebuilt and relaunched the native application.
