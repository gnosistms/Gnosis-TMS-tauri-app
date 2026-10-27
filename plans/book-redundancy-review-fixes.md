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
