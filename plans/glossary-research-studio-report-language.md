# Report-language change (reverted)

## Rollback requested
The user confirmed Vietnamese had been selected intentionally and requested removal
of the reporting corrections. The implementation below is superseded.

1. Remove only the report-language feature, report-conversion helpers and their
   tests; restore the pre-existing research modal's language picker.
2. Preserve the separate studio design, primary action, labels, tooltip, scroll
   preservation and export-availability changes.
3. Verify no feature imports remain and run studio regression tests, lint and build.

## Rollback completed and verified
- Restored the eight feature-only tracked files to their pre-change contents;
  removed the three new language helpers/tests and only the language-specific
  hunks from the renderer, styling and browser fixtures.
- Preserved the separate UI changes, including Begin research, Select projects,
  recommended Run emphasis, hidden unavailable continuation, tooltip containment,
  scroll preservation and export starting at step 4.2.
- 3,058 frontend unit tests, 25 workflow tests and 199 focused studio tests passed.
- Browser suite: 58 passed initially; one assertion still expected the disabled
  continuation button from before the user requested hiding it. Updated that
  expectation and reran the affected test successfully (all 59 checks verified).
- Build, targeted ESLint and whitespace checks passed. Saved user studies were
  not rewritten or deleted as part of the rollback.

## Superseded implementation scope and language contract
- Save report language separately from research scope and translation inputs.
- Report language: recommendations, summaries, explanations, research definitions.
- Glossary target language: candidate translations, translator notes, reader footnotes.
- Original language: source quotations, source forms, original terms and references.

## Superseded implementation plan
1. Reuse the report-language selection UI and shared language picker in Scope;
   persist the setting, show it in the step header and inherit it in child studies.
2. Centralize the language policy for model requests, remove conflicting stage
   instructions, and include report language in recommendation/narrative caches.
3. Add Translate existing reports using a separate presentation translation map:
   preserve original reports, evidence, IDs, approvals, candidate notes, trials and
   completed research. Translate only recognized narrative fields, atomically,
   with cancellation and persistence through the existing study lifecycle.
4. Verify mixed source/target/report languages, saved-study reopening, recommendation
   refresh, split inheritance, cache behavior, and existing-report translation.
5. Run relevant unit/browser tests, lint, build and unused-code audit; inspect UI.

## Superseded implementation validation
- Completed: saved study-level report language, shared Scope selector and language
  picker, header language control, split/comparison inheritance, centralized prompt
  roles, language-aware model/recommendation caches and preserved raw retrievals.
- Existing report conversion stores a separate language-specific text map. Source
  artifacts, original definitions, IDs, approvals, glossary notes, footnotes, trials
  and research signatures are preserved; incomplete/cancelled responses do not
  partially update displayed reports. Repeated conversion reuses saved translations.
- 3,065 frontend unit tests and 25 workflow tests passed (`npm test`).
- All 61 studio browser tests passed in installed Chrome, including separate
  Spanish/Vietnamese/English languages, switching to French, reopening, conversion
  persistence without research calls, unchanged completed findings and split inheritance.
- Targeted ESLint, frontend build and whitespace checks passed.
- Inspected desktop (1440×900) and narrow (640×700, 390×700) layouts.
- Unused-code audit retains the existing 345 unused-file, 11 unresolved-import and
  32 unused-export findings; none names a newly added language module.
