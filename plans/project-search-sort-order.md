# Project Search Sort Order

## Goal

Show search result projects and chapters in ascending name order, using natural
number sorting and case-insensitive comparison to match the regular project list.
Keep matching rows in their existing lexicographic chapter order.

## Steps

1. Replace score-first branch sorting in the search tree with name sorting and
   an ID tie-breaker. Preserve search scores, filtering, and result selection.
2. Adapt the existing hierarchy ordering test to cover unequal relevance scores,
   mixed-case names, and numbered chapters.
3. Run frontend tests and the unused-export audit.

## Verification

- Implemented natural, case-insensitive title sorting for projects and chapters,
  with IDs breaking name ties. Matching rows retain chapter order.
- `npm test`: all 2,272 frontend tests passed; the workflow suite passed 19 tests
  and failed four unrelated dev-launcher child-server startup assertions in
  `scripts/launch-dev-session.test.mjs`.
- `npm run audit:unused`: reported unused files/exports outside the changed
  search-state module (including 199 unused files); no exports were added.
- `git diff --check`: passed.
