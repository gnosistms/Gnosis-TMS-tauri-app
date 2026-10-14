# Preserve Project Search on Return from Editor

## Goal

Returning from a search result in the editor to Projects keeps the search query,
case setting, results, weaker-match selection, and expanded groups for that team.
Changing teams or signing out still clears the search.

## Steps

1. Extend the existing project-loading test to reproduce navigation's repeated
   loading primes with an active search.
2. Reset search only when the loading context no longer belongs to the same team,
   independently of whether the project collection is empty.
3. Run targeted and frontend tests, and check the unused-code audit.

## Verification

Final PR validation on latest `main`: all 2,322 frontend tests and all 23
workflow tests passed. The earlier launcher failures were restricted to the
sandboxed run. Focused ESLint passed with existing unused-import warnings.

- Reproduced the query/settings/results reset with the existing loading-prime
  test before changing the implementation.
- Loading now keeps the same team's search and ownership, including when the
  project collection is empty. Team changes continue to reset search.
- All 55 targeted project-query, project-search-flow, and navigation tests pass.
- `npm test`: all 2,272 frontend tests passed. The workflow suite passed 19 tests
  and hit the same four unrelated dev-launcher child-server startup failures
  previously observed in `scripts/launch-dev-session.test.mjs`.
- `npm run audit:unused`: reported findings outside the changed modules,
  including 201 unused files; this change adds no exports.
- `git diff --check`: passed.
