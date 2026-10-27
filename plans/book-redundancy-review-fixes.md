# Redundancy feature review fixes

Target: PR #384, starting at e2e64b33. Review only the redundancy feature and its
export/read integration; preserve unrelated changes.

Confirmed issues and implementation sequence:

1. Include uploaded-image file revisions in reviewed chapter fingerprints, so a
   background sync replacing bytes at the same path cannot leave stale omissions.
   Refuse warm-snapshot reuse when the current inventory has image-read warnings.
   Add native regressions for same-path changes and fresh warnings.
2. Remove only canonical footnote marker tokens. Preserve literal bracketed values
   such as [01] and [+1] while omitting [1], with a text-preservation regression.
3. Bind native cache/jobs to the initiating login, not whichever account is signed
   in when a queued worker starts. Fence queued frontend saves before dispatch;
   make later successful full-state saves clear earlier failures. Choice writes
   should not deserialize and return the complete detection evidence. Test account
   changes and failure/success races with controlled asynchronous operations.
4. Keep footnote choice identity independent of unrelated images in the same row.
   Migrate existing choices using verified matching annotation identity from the
   cached result, and save migrated choices locally. Test both native identity and
   frontend migration/persistence.
5. Run focused regressions, relevant export tests, full JS/native suites where
   appropriate, build/lint/Clippy/format checks, then push focused fixes to PR #384.
   Update this document with verified results. No live paid AI call is required.

Additional confirmed race: Next awaited only the save promise existing at click
time. A later checkbox write could remain pending, and Back/Cancel during the
wait allowed the old Next continuation to advance a replacement book to page 3.
Flush until the queue is stable and return a scope-valid result; navigation must
stop when the initiating review is no longer current. Add controlled async tests
and a browser Back-during-save regression before committing this follow-up.


Completed and verified:
- Same-path uploaded-image replacements/deletions invalidate the reviewed chapter.
  New image-read warnings cannot be hidden by a previously clean cached result.
- Omitting [1] preserves literal [01], [+1], and [ 1] text, links and escaped markers.
- Cache reads, writes and jobs validate the initiating login. Queued saves stop on
  account changes; only the latest save controls the failure state. Failed saves
  have an explicit Retry action and recovered errors do not leak onto page 3.
- Choice writes return only choices instead of parsing/transferring all evidence.
- Footnote identity excludes unrelated images. Verified aliases retain and migrate
  existing unchecked/checked choices, including recovery if the app closes before
  a migration write completes. Changed note bodies do not inherit those aliases.
- Next waits for all current writes and cannot advance a cancelled/replaced review.
  Both original navigation races were reproduced by failing controlled tests.

Validation: 3,117 frontend unit/screen tests, 25 workflow tests, 957 native tests
(13 existing opt-in checks ignored), and all 33 project-export Chrome workflows
passed. The 20 focused native redundancy tests and 13 focused JS tests pass.
Build, changed-module ESLint, strict all-target Clippy, formatting and whitespace
checks pass. No paid live AI requests were made.
