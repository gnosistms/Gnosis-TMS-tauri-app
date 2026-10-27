# Alignment reliability and sentence splits

## Scope

Fix the five findings in alignment-feature-review-plan.md and support language-
appropriate punctuation/capitalization at paragraph splits. Preserve the existing
working-tree corridor changes and unrelated edits. Do not modify saved user data.

## Implementation

1. Reject unresolved or invalid splits before application; never duplicate a whole
   paragraph across multiple source rows. Enforce final validation before writes.
2. Preserve exact fragments and original ranges separately from optional adjusted
   text. Allow only punctuation, whitespace, and capitalization edits; preserve
   words and meaning. Use source context and actual target base language to decide
   sentence boundaries. Keep subtitle continuations intact. Mark adjusted fragments
   for review; report splits requiring lexical rewriting as recoverable errors.
3. Hold the repository lock across apply reload, validation, preparation, and commit
   using a non-relocking write helper. Validate relevant chapter/source inputs, not
   unrelated repository HEAD changes; preserve new target/other-language edits.
4. Cache each validated AI response by complete prompt/schema/model signature with
   atomic replacement, reuse completed work on retry, and remove caches after apply
   or TTL expiration. Invalid responses must remain retryable.
5. Add actionable apply error UI: retry transient failures, restart alignment when
   chapter inputs changed, and cancel. Preserve pasted input and mismatch consent.
6. Add backend and frontend regressions for each failure and sentence behavior; run
   focused tests, full frontend tests, unused-export audit, and Rust checks.

## Validation

Completed all six implementation steps.

- Focused alignment regressions: 22 Rust tests and 26 frontend flow/renderer tests
  passed, including safe splits, preserved originals, retry recovery, cached calls,
  relevant-source change detection, and a concurrent repository-lock regression.
- Full Rust library suite: 657 passed, 3 ignored. Full frontend/workflow suites:
  2,076 application/screen tests and 17 workflow tests passed. Local-server tests
  required rerunning with localhost access outside the default sandbox.
- Production Rust Clippy (`--lib -- -D warnings`), scoped frontend ESLint, and
  `git diff --check` passed. State-file lint still reports its unrelated existing
  unused `normalizeEditorMode` import.
- Clippy including all tests remains blocked by the unrelated XLSX test's
  `err().expect()` at chapter_import/xlsx.rs:400. The unused-code audit reports
  existing scripts, browser-test imports, and an editor-footnotes export; no new
  alignment findings. Those unrelated files were left untouched by this task.
- No live AI rerun, installed-app rebuild, or edits to saved translation data.
  Sentence-boundary decisions remain model-assisted; word preservation and exact
  original coverage are validated, and adjusted rows retain originals in notes
  with the existing Please check flag.

## PR validation against current main

The isolated PR branch was rebased onto main at 1256edd6 before publication.
Its full Rust library suite passed (657 tests, 3 ignored), frontend/workflow
suites passed (2,076 + 13 tests), and the Vite production build passed. Strict
Clippy across all targets and Rust formatting passed; the upstream XLSX lint
issue described above is already resolved in this base. Scoped ESLint had no
errors and retains the existing state-file warning. Unrelated uncommitted
launcher work is excluded, accounting for the four fewer workflow tests.
