# Stop only for useful review

## Policy
- Always review scope, completed forms, meaning inventory, occurrence assignments,
  translation candidates, usage/retention, final editor/save and queued entries.
- Existing entries: stop only when matching entries exist. Sampling: continue
  after successful completion.
- Dictionary/corpus/source findings: continue when the validated meaning list is
  empty; keep bibliographical author assessments when present. Word parts:
  continue for an explicit empty parts list. Never treat retrieval errors or
  incomplete payloads as empty findings.
- Split entries/compounds/spelling: continue when no qualifying proposals,
  compounds or spelling decisions exist.
- Successful current translation tests: continue when there is no pending input
  or repair report to review. Keep failures, stale tests and changed-note reports.
- Collision review: continue when a refreshed glossary has no collisions, while
  retaining the existing final validation of the retained entry.
- Optional Run/Skip choices remain human decisions. Unavailable bibliography
  advances automatically. The final editor never opens/saves automatically.

## Implementation
1. Centralize a conservative result-review policy with positive empty-result
   checks, full payload validation and pending/error protection.
2. Reuse the existing advance/approval path for automatic completion, including
   dependent-state invalidation, split review and final retained-entry testing.
3. Trigger only after current successful runs or forward entry/reopening. Keep
   sidebar visits available for inspection and guard navigation/generation races.
4. Update browser flows and test empty/nonempty outcomes, cached records, failures,
   pause, current/stale tests and preservation of final-save decisions.

## Completed
The central review policy covers mechanical work and explicit empty outcomes.
Automatic continuation uses the same checkpoint approval, split handling,
dependent-state invalidation and retained-entry validation as manual continuation.
Current-generation checks stop late lookups from advancing a different study or
route. Saved empty results continue on reopening without repeating research;
sidebar visits remain available for inspection. Controlled comparison studies
retain their own review controls. Passed tests with repairs/changed-note reports
still stop for review; final editor opening and saving stay manual.

Validation: all 220 focused studio unit tests passed. The broad browser run passed
67 scenarios; two existing scenarios expected the pauses intentionally removed
by this change. Their updated focused checks passed, along with the source-summary
review check (69 distinct scenarios verified overall). Coverage includes full
research, positive findings, explicit empty results, cached legacy reports, pause,
retry, exit during sampling, stale/current tests, collisions, final validation,
and editor cancellation. ESLint and whitespace checks passed. All provider calls
were mocked; no real AI requests or glossary writes were made.
