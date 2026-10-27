# Quote attribution

## Intent
Add a per-language attribution textarea to Quote rows. Persist attribution separately
from body text; changing away from Quote appends attribution to the body as a new
paragraph and clears the separate value. Preserve attribution through saves, reloads,
history, sync, conflicts, and row merges.

## Implementation — complete
1. Added optional stored field `attribution`, editor attribution maps, concurrency
   bases, dirty tracking, history, and Git conflict handling. Style conversion is
   atomic in Rust, returns authoritative text, and updates focused textareas before
   the next keystroke. Legacy fields default to an empty attribution.
2. Added an accessible textarea per Quote language column using existing input,
   blur-save, permission, and row measurement paths. Quote bodies remain indented
   and italic; attribution is separate, smaller, and right aligned.
3. Added WordPress quote citations and native Vellum attribution attachments.
   HTML/preview/PDF use 90% font size and right alignment; DOCX/RTF use the nearest
   supported half-point size. DOCX also names its paragraph style `Vellum Attribution`.
   TXT, Markdown, and XLSX preserve the attribution text.
4. Per the follow-up request, SRT editing hides all formatting controls and its
   style/inline-formatting actions are guarded. The native row-style command also
   rejects SRT chapters. Subtitle export remains unchanged.

## Validation
- Frontend and workflow suites pass; focused regressions cover attribution-only
  edits, edits during saves, remote changes, style conversion/failure, rendering,
  exports, and SRT controls.
- Rust chapter editor suite: 324 passed, six existing opt-in tests ignored.
- Bundled Typst compiler smoke test passes with a quote and attribution.
- Browser checks pass for editing/saving attribution, 90% right-aligned preview,
  conversion while the body textarea is focused, SRT control visibility, and the
  existing row-style typography flow.
- Native Vellum 4.1.5 successfully opens the generated attribution attachment and
  displays its source using Vellum's own quote styling. Temporary test books were
  saved under `/tmp` and their windows closed.
- Production build passes. The unused-code audit retains existing findings
  (345 files, 32 exports); no attribution exports are unused.
- Optional font-review integration tests require a fuller smoke-font directory than
  the bundled two-font directory; the standard suite and isolated PDF smoke pass.
- Windows editor scroll behavior was not exercised on this macOS host.

## Format references
- Vellum native attachment structure was checked against a Vellum 4.1.5 document
  created by importing its documented Word attribution style:
  https://help.vellum.pub/importing/supplemental-word-styles/
- Native attribution behavior: https://help.vellum.pub/text-features/block-quotation/
