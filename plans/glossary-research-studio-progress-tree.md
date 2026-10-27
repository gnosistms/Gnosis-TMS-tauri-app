# Research Studio progress tree

Replace the single changing activity line with a persistent nested checklist of
work and concise results. Keep the live acceptance run paused; validate with
fixtures without paid AI calls.

1. Add a small structured activity model shared by the existing tool runner.
   Declare known work before requests start; append discovered authors, components,
   forms, batches and repair rounds when they become known. Track waiting, running,
   complete, paused and failed states. Cache hits are completed work, not new calls.
2. Instrument bibliography research with metadata, source matching, original-term
   lookup, per-author mention verification, comparison batches and consolidation.
   Apply the same model to form discovery, dictionary/component research, occurrence
   assignment/recovery, preliminary translations, spelling and meaning/entry tests.
   Store bounded, source-derived result summaries with normal study checkpoints;
   do not add AI requests, persist calls, or change research/cache signatures.
3. Render a nested list with completion checks, current-operation spinners and
   visible results under their steps. Preserve detailed-result disclosures across
   renders. Keep accessibility announcements short instead of announcing the whole
   tree. Show completed/paused work after the operation stops and on reopening.
4. Test advance declarations, dynamic additions, concurrent sibling statuses,
   cache/pause/error behavior, result escaping and disclosure persistence. Run the
   relevant frontend suites/build/lint and inspect the design in browser fixtures.
   Keep existing studies/code/notes intact; do not resume paid acceptance tests.

## Implemented and verified

Added structured, normally persisted activity receipts and scoped plans without
changing prompts, cache signatures, request counts or save frequency. Bibliography
plans all six phases before lookup, then reveals authors, mention batches and
comparison batches as they become known. Form, dictionary, component, spelling,
assignment/recovery, preliminary-translation and focused/complete-entry test loops
use the same nested list. Individual repairs and concurrent batches retain their
own results. Completion checks describe completed work; summaries explicitly retain
uncertainty and test failures. Long result summaries are expandable and their open
state survives progress renders. Saved legacy bibliography evidence is projected
into the list without new requests; old tests distinguish current from stale results.

Validation: 2,432 app unit tests, 25 workflow tests, 36 Studio browser regressions,
production frontend build, targeted lint and diff checks passed. Unused audit remains
at the existing 341 files / 26 exports / 5 dependencies baseline. Browser tests use
an isolated localhost fixture server; the first full run exposed obsolete assertions
for the removed status-line UI, which were updated to check the new checklist and
short accessibility announcement. Full rerun passed. Preview inspected visually at
/tmp/gnosis-studio-progress.png. Native app reopened the actual fatal study at step8
and displayed saved passes/rechecks without starting AI. Acceptance testing stays
paused; no paid AI calls were made for this UI change.
