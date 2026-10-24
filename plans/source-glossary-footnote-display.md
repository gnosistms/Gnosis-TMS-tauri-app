# Restore glossary footnotes in source popups

## Goal

Show saved glossary footnotes in source-language information popups. Keep the
Ctrl+F insertion hint and insertion action restricted to eligible target terms.

## Plan

1. Preserve footnotes in the source popup payload without changing insertion eligibility.
2. Update existing unit and browser regression coverage for source footnote visibility
   and target-only insertion hints.
3. Run frontend tests, the focused browser regressions, and the unused-export audit.

## Scope

This changes the editor glossary popup only; QA lists have no equivalent popup or
glossary footnote insertion feature to update.

## Verification

- All 2,658 frontend tests passed.
- All three focused browser regressions passed using installed Chrome, including
  rendered source footnote visibility and absence of its insertion hint.
- The workflow suite passed 21 tests and failed four unrelated launcher lifecycle
  tests because the grandchild server did not start.
- The unused-export audit reported existing unused files/exports and unresolved
  imports outside this change; this change adds no imports or exports.
- `git diff --check` passed.
