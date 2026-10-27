# Prevent glossary duplicates that differ only by capitalization

The editor-row glossary action opens the shared New Term editor. Both its
duplicate warning and the native save validation compare source variants with
case-sensitive equality, allowing the screenshot's `Tal como es arriba es abajo`
and `tal como es arriba es abajo` to occupy separate entries.

1. Reproduce this failure in native validation and the editor-row browser flow.
2. Compare trimmed source variants without capitalization in the shared glossary
   draft validation and both normal and research native saves. Preserve entered
   spelling, punctuation, translations, and existing data; do not auto-merge.
3. Apply equivalent duplicate prevention to case-insensitive plain QA terms,
   retaining intentional case-sensitive and regular-expression distinctions.
4. Verify focused native, frontend, and browser regressions, then run the normal
   frontend suite and unused-code audit. Record results and limitations here.

Completed:
- Reproduced two failing native validation cases before the fix, including the
  screenshot's Spanish phrase. Normal and research saves now use the same
  case-insensitive source key; UI warnings use case-insensitive comparison too.
- Applied the equivalent plain QA comparison in frontend and native validation.
  Explicit case-sensitive rules and regular expressions retain exact comparison.
- Native suites: 23 glossary tests and 13 QA tests passed. Focused frontend run:
  139 passed, followed by all 40 QA tests after adding two settings-preservation
  cases. Full application/screen suite: 3,183 passed. Workflow suite: 25 passed
  when rerun with localhost access (the sandbox blocked four launcher cases).
- All six editor-entry browser tests passed using the installed WebKit runtime,
  including entry through the editor-row button, immediate warning, blocked save,
  and clearing the warning after choosing a distinct punctuated phrase. Chromium
  was unavailable locally, so browser verification used a temporary config.
- Targeted ESLint, Rust formatting, and whitespace checks passed. Unused-code
  audit completed and reports 345 unused files and 32 exports in the current
  workspace; this change adds no JavaScript exports or production modules.
- Existing glossary entries are preserved. This prevents future case-only
  duplicate saves; it does not migrate or merge already saved entries.

PR verification on the isolated branch from main (`1a3fad3f`):
- Full frontend suite: 3,212 passed; workflow suite: 25 passed.
- Native glossary/QA suites: 23 + 13 passed; strict all-target Clippy passed.
- All six editor-entry browser tests passed in WebKit on a separate local port.
- Production build, full JavaScript lint, Rust formatting, and whitespace passed.
- Unused audit reports 41 files and 16 exports, all outside the changed code.
