# Stable step9 validation passes

## Confirmed problem

Step9 repairs each failed batch immediately by editing entry-wide notes/order.
Later batches then run against a different draft, invalidating earlier passes.
The final sweep can fail elsewhere, edit the same shared entry again, and repeat
work across the sample. The stale-result warning protects correctness, but this
repair scheduling creates unnecessary intermediate versions and AI calls.

## Change

1. Retain a first-batch smoke test for new studies so an obvious/systemic failure
   can be resolved before spending calls on the whole sample. Once it passes,
   test every batch against one unchanged entry before proposing repairs. Reuse
   already completed trials for those exact inputs, including failures when
   resuming before repair. Collect all failed batches for one coordinated repair.
2. Apply the combined note/order repair once, then validate that entry. Preserve
   all confirmed candidates, independent judging, production translation hints,
   full final coverage and the three unsuccessful repair rounds per failed batch.
   Keep per-batch counters and pause together for batches at their limit; Continue
   extends only those explicitly presented batches. Save all prior trials.
3. Bound combined repair evidence by grouping whole failed-paragraph evidence into
   requests under the existing prompt limit when necessary. Declare these repair
   groups before requests and apply them all before the next validation pass.
   Never truncate source paragraphs or skip findings to fit a request.
4. Remove the redundant global assignment-revision invalidation: each batch already
   fingerprints its actual assignments and evidence. A correction in one batch
   must not invalidate another unchanged batch solely because the study counter rose.
   Keep the revision for provenance; no blanket acceptance of stale results.
5. Clarify the UI's genuine recheck reason and stable-pass progress. Verify multiple
   failing batches, resume-before-repair, current-result reuse, real shared-note
   invalidation, local assignment changes, bounded repair groups and pause/Continue.
   Use mocked tools; keep paid acceptance research paused.

Repairs receive the same failed-paragraph source neighbors as translation and
assessment. Same-spelling candidate records share one visible saved target note;
apply repaired conditions consistently across those records, replacing obsolete
notes rather than appending a contradictory older duplicate. Preserve multiple
new conditions returned for the same spelling by merging them before applying.
Coordinated repair commits use normal subsequent checkpoints, without an extra
full-study write merely for this scheduling change.

## Verification — 2026-10-16

Implemented. All 2,449 frontend unit tests and all 39 isolated Studio browser
tests pass. Focused coverage includes multiple failed batches sharing one repair,
resume before repair, bounded whole-paragraph repair groups with atomic application,
shared spelling notes, first-batch smoke failure, grouped pause/Continue and local
assignment corrections without unrelated invalidation. Production build, targeted
ESLint and `git diff --check` pass. The unused-code audit retains the existing
341 unused files, 26 unused exports and five unresolved browser-fixture imports;
none is introduced by this change.

Verification uses mocked research tools only. The real paid acceptance study
remains paused. No real-world timing improvement has been measured yet; actual
shared-entry changes still require validation of all affected batches.
