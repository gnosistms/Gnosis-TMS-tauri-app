# Parallelize step 2a without reducing research

## Contract
Keep the existing discovery/identity prompts, original-spelling search query,
corpus requests, sample sizes, validation and human selection rules. Change only
the schedule. Keep deterministic proposal/evidence/candidate order so concurrent
completion does not change model inputs or cache keys. Timings remain logged,
with no timing UI.

## Implementation
1. Run original-spelling research alongside corpus checks after discovery.
2. Check at most two forms concurrently, and use the same bound for accepted
   alternatives. Each form retains its recall and exact-attestation operations.
   Publish completed results immediately while other branches run.
3. Join all prerequisites before lexical identity review. On failure/pause, stop
   queued work, drain active branches before returning, preserve completed cached
   results and identify the failed tool correctly for retry.
4. Verify overlap and prerequisite barriers with held jobs, deterministic complete
   evidence, both completion orders, failures, pause/resume and cache reuse. Use
   browser mocks; no paid AI calls or provider settings changes.

## Initial checks
Native research jobs already run independently, with per-job cancellation.
Studio storage queues/coalesces snapshots; tool results and activity/timing
records already support concurrent operations. No backend changes are needed.

## Implemented
- Original-spelling web research overlaps a two-worker corpus pool. Accepted
  alternatives also use two workers, reusing previously attested forms.
- Selected-project forms share a single in-flight project-text snapshot. This
  preserves the original single retrieval and avoids consuming one coalesced
  native job twice.
- Identity analysis waits for both branches and receives all evidence in proposal
  order. Prompts, search query, exact-count checks, witness sizes and inclusion
  decisions are unchanged.
- Failures stop queued work and wait for active operations to settle. Scoped
  request identities ensure both tool failures and invalid successful responses
  retry the correct receipt. Pause still cancels all native jobs.
- The browser footer check measures buttons in one DOM snapshot, avoiding a
  progress-render race between separate measurements.

## Validation — complete
120 focused unit tests passed across stages, tools, activities, storage/query,
timing and rendering. Five browser flows passed, covering incremental findings,
both branches active together, cancellation/resume, saved discovery reuse and
final Spanish form review. Held-job tests establish two-worker overlap, unchanged
query/witness limits, complete ordered evidence, early origin and late origin,
single project-snapshot retrieval, failure draining and the correct retry target.
ESLint and whitespace checks passed. No paid provider calls were made; actual
elapsed-time improvement depends on the corpus/provider response times.
