# AI settings key-management review fixes

## Intent

Preserve the working local and team credential until a replacement has passed its
own provider check. Keep key state accurate across navigation and deletion errors.

## Implementation

1. Add a native candidate-key validation command that lists models using the supplied
   key without reading or writing the active credential. Keep it separate from
   background model discovery and automatic team-credential recovery.
2. Validate before saving, seed model options from that result, and finalize secret
   state across screen navigation while retaining team, session, provider, and draft
   guards. Preserve the in-progress save during local settings reloads.
3. Give removal an explicit action that retains the saved-key state until deletion
   succeeds; empty Save remains a no-op.
4. Add regression coverage for concurrent discovery, failed local/team replacements,
   navigation/re-entry, scope changes, and deletion retries. Run focused tests, the
   frontend suite, and native compilation/tests for AI code.

## Validation

Completed all four fixes and added 11 regression cases.

- Frontend suite: 2,042 passed; after the final two regression cases were added,
  the focused settings/action suite passed all 120 tests.
- Workflow tests: 17 passed.
- AI settings browser tests: 4 passed in Chrome against an isolated dev server.
- Native AI tests: 92 passed, 1 ignored. The first sandboxed run could not bind
  three mock-broker servers; all passed when rerun outside the sandbox.
- Changed JavaScript: no lint errors; one pre-existing unused-argument warning
  remains in the settings test file.
- Changed Rust files pass formatting; the repository-wide format check reports an
  unrelated existing formatting difference in project_import/chapter_import/html.rs.
- No live provider credentials were used for validation.
