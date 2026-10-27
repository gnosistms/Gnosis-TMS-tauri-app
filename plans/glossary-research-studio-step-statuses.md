# Visible research-step states

The ilustre study retains approved results for 4.7, 6 and 7, and an approved Skip for 5. A human correction to a step-4.6 meaning assignment marked downstream checkpoints stale. Focused and final validation subsequently completed, but did not re-approve those earlier checkpoints. The outline currently renders only complete/skipped states, leaving stale results visually indistinguishable from work never attempted.

Fix the outline to explicitly distinguish results needing review, including a previously skipped step whose inputs changed. Also label running work and results awaiting human review. Keep genuine unstarted future steps unmarked. Do not overwrite checkpoint signatures, claim stale results are current, rerun paid research, or mutate the saved ilustre study to hide the issue. Preserve the existing source-summary numbering change and other work.

Implementation and verification:
1. Add a tested workflow helper for human-readable step status, preserving prior Skip decisions when a checkpoint becomes stale.
2. Use the helper in the outline, with screen regressions reproducing ilustre's stale completed/skipped records and distinguishing pending review from future work.
3. Run relevant workflow/render tests, lint and the frontend build. Verify against the saved ilustre manifest through read-only inspection. Native packaging remains subject to the existing disk-space guard; do not delete data or bypass it.

## Verified

- Added explicit labels for stale results, a prior Skip that now needs review, running work, results ready for review and pending human input. Future unstarted work remains unmarked. The outline explains that earlier inputs changed and saved results remain available.
- 53 focused workflow/render tests and three browser regressions pass, including the reproduced ilustre outline, normal full navigation and correcting a source occurrence. Screenshot inspected; longer status text wraps within the outline. ESLint, frontend production build and diff whitespace checks pass. No paid AI calls and no changes to the saved ilustre study.
- This fixes the missing status indication. It does not automatically re-approve stale checkpoints, narrow the existing broad downstream invalidation policy, or claim that later successful translation tests also approve earlier research decisions. Native app packaging remains blocked by the previously reported disk-space guard.
