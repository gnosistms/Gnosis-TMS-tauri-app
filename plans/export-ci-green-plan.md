# Restore green browser CI after export fixes

## Current evidence

Main `18e59de9` already includes the scoped book-render and image-import fixes
from release PR 389. All project-export browser cases pass on Linux and Windows;
Linux browser CI and all quality jobs pass. The remaining Windows failure is
`editor-glossary-refresh.spec.js` during-preflight: a stationary hover retains
old translator notes because the mocked local save never completes.

## Plan

1. Inspect the native save contract and frontend test/refresh ordering.
   Reproduce the preflight race deterministically before changing its owner.
2. Fix the demonstrated race, preserving immediate local refresh, account/chapter
   guards, editor drafts, tooltip behavior and glossary/QA shared-read parity.
   Preserve the existing export fixes and their assertions.
3. Run relevant browser regressions, the full frontend suite, lint/build and the
   unused-code audit. Publish a focused PR and require green Linux/Windows and
   quality CI before merging it; verify main's resulting CI as well.

## Reproduction and fix

The native upsert writes and commits the term before returning. The trace's marks
still contain the old data, and all eight ordinary local stress runs pass. A new
case starts the background sync after the save preflight is held; it deterministically
reproduces the exact Windows stale-tooltip failure without changing app code.

The fixture replaced `releasePreflight` for each concurrent sync, losing the first
resolver. All preflight callers now await one shared gate. Releasing it also ends
the held phase, so a later sync does not become blocked again. The new regression
retains the stationary-pointer, translated-note, footnote and derived-English
assertions. No production refresh or export assertions are changed.

## Local validation

- The new overlapping-preflight case failed before the gate repair with the
  exact Windows stale-note assertion, then passed after it.
- All 49 glossary-refresh and project-export browser tests passed in Chrome.
- All 3,206 application tests and 25 workflow tests passed.
- ESLint, production build and whitespace checks passed; unused-code audit
  output is identical to the current-main baseline (41 unused files, 16 exports).
