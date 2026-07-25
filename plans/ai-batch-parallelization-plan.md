# Parallel AI batches for Translate All and Review All

## Problem

AI Translate All and AI Review All process their row batches strictly one at a
time (`for (const batch of batches)` in `editor-ai-translate-all-flow.js` and
`editor-ai-review-all-flow.js`). Each cycle is dominated by the AI call (tens
of seconds per batch of up to 15 rows); the local work — validation, state
application, and the since-#196/#197 single batch commit — is sub-second. A
300-row run pays ~20 AI round-trips end to end while the pipeline sits idle
between them. Running a small number of batches concurrently should cut wall
time roughly by the pool size.

## Goal

Both flows run with a pool of `AI_BATCH_CONCURRENCY = 6` batches in flight,
built on one shared orchestrator so the two flows cannot drift, with:

- git writes exactly as serialized as they are today,
- derived-glossary terminology as consistent as the sequential flow,
- no request amplification when the provider rate-limits or fails
  (rate-limited batch calls retry with backoff on the batch path),
- unchanged cancel, progress, and fallback semantics per batch.

**Measured (end-to-end benchmark, job completion = all rows applied + run
finished; simulated AI latency 1000ms, commit 150ms):** sequential n=6 →
6046ms; concurrency 6 → 1035ms (**5.8×**); n=10 at concurrency 10 → 1059ms
(**~9.5×**) — job time is ~constant in n, orchestration overhead 35–60ms.
Durable completion (background commit queue drained) trails by
n × commit-time, as expected for serialized local commits. With a simulated
provider allowing only 3 concurrent calls, 429 retries kept every batch on
the batch path (zero per-row collapses) and the run still finished 2× faster
than sequential. The constant is provider-limit policy, not a mechanism
limit; changing it is one line in `editor-ai-batch-request.js`.

## Design

### Shared orchestrator: `editor-ai-batch-pool.js`

Both flows have the same run shape: chunk work into batches → per batch, an
**AI request stage** (slow, independent, parallelizable) → a **validate +
apply + save stage** (fast, must be serialized) → per-row **fallback** for
rows the batch response could not cover. That shape becomes one shared module
consumed by both flows instead of two hand-rolled loops:

```js
const pool = createAiBatchPool({
  concurrency: AI_BATCH_CONCURRENCY,
  isRunActive,          // flow's own cancel/liveness predicate
});
const outcome = await pool.run(batches, {
  request: async (batch) => {...},        // pooled: build request, call AI
  apply: async (batch, result) => {...},  // serialized lane: validate + apply + save
});
// pool.acquireSlot() — shared semaphore, used by per-row fallback AI calls
```

Semantics the module owns (and both flows inherit identically):

- **Pool.** `run` drives `mapWithConcurrency(batches, concurrency, task)`
  (helper already exists in `editor-ai-batch-request.js`). Workers never
  throw — `mapWithConcurrency` rejects everything on a thrown task — so each
  task resolves to an outcome (`"ok" | "abort" | "run-error" |
  "chapter-changed"`); the first non-ok outcome sets a stop flag and remaining
  workers return before picking up new batches. In-flight AI calls cannot be
  cancelled (same as today); their results are discarded by apply-stage
  validation.
- **Apply lane.** All `apply` callbacks funnel through one promise chain, so
  exactly one validate/apply/save runs at a time, in completion order.
  Batches touch disjoint rows, so completion order is safe; the lane
  serializes the *writes*, not submission order. Workers await their own
  lane position so outcome propagation stays simple; other workers keep
  running request stages meanwhile.
- **Fallback slots.** Per-row fallback AI calls (batch call failed, row
  missing from the response, row edited mid-flight) acquire slots from the
  *same* semaphore budget as batch requests — never `pool × batch-size`
  independent requests when the provider is already failing. Only the AI call
  holds a slot; the row's apply goes through the apply lane like everything
  else. This means splitting the existing single-item helpers at their
  natural seam — both flows already separate the AI invoke
  (`run_ai_review` / single-row translate) from the apply
  (`applyReviewOutcome` / `applyBatchRowResult`), so the split is wiring, not
  a rewrite.

Why the apply lane is mandatory and not just tidy:

- **Review flow:** `applyReviewOutcomesBatch` and the per-row apply invoke
  `apply_gtms_editor_ai_review_result[s_batch]` directly via
  `invokeEditorWriteCommand` — there is no write queue underneath. Two
  concurrent invokes would race two `git commit`s on the same repo
  (index.lock contention). The lane keeps today's implicit serialization once
  the AI calls overlap.
- **Translate flow:** saves already serialize through the write-intent queue,
  so commits are safe regardless — but state application
  (`applyBatchRowResult` loops, `flushBatchSave`) still goes through the lane
  so abort checks, progress updates, and `pendingBatchSaveItems` flushes keep
  their one-batch-at-a-time semantics.

### Translate flow specifics (`editor-ai-translate-all-flow.js`)

- **Resolve the provider before fan-out.** Today it resolves lazily inside the
  loop on the first multi-row batch. Hoist the
  `ensureEditorAiTranslateProviderReady` call (and its missing-key modal
  handling) ahead of the pool; a run with only single-item batches keeps the
  current behavior.
- **Language pairs run sequentially; batches within a pair fan out.** The
  work order is a real dependency chain: the glossary-source (pivot) pair
  translates first and derived pairs read the pivot column it writes, so
  cross-pair batches must never overlap. Batches are grouped into
  pair-contiguous groups (the chunker already emits them contiguously) and
  each group runs through the pool with a barrier between groups. Derivation
  itself stays per batch, wrapped in a dedicated serial lane — same-pair
  batches derive row-disjoint sets, and the lane prevents interleaved
  chapter-state writes. (An earlier draft warmed the derivation cache in a
  run-level pre-pass; that was wrong — it derived before the pivot pair had
  translated, reading empty pivot columns. The pair barrier is the correct
  ordering guarantee.)
- **Single-item batches** keep the proven `translateSingleItem` path, run as
  pool tasks (AI call holds a slot, apply/save in the lane).
- **`glossarySourceLanguageChangedRowIds`** stays a run-level accumulator
  (single-threaded set adds); the end-of-run combined re-derivation in the
  `finally` block runs after the pool settles, unchanged.

### Review flow specifics (`editor-ai-review-all-flow.js`)

- Batch AI calls (`run_ai_review_batch`) run in the pool; the partition into
  batch-applied vs fallback rows and `applyReviewOutcomesBatch` run in the
  apply lane; fallback rows take pool slots for their `run_ai_review` calls.
- **Meaning-mode history loads** currently run at concurrency 3 *within* a
  batch. With 3 batches in flight that becomes up to 9 concurrent local
  `git log` invocations. Bound per-batch history concurrency to 2 when the
  pool is active (worst case 6); Windows process spawning is the platform to
  watch.

### Progress, cancel, UX

- `completedCount` / `languageProgress` updates now interleave across
  batches; counters are monotonic so the modals need no changes.
- Cancel: the pool checks the flow's `isRunActive` before each stage; apply
  validation re-checks rows. Semantics match today with at most pool× more
  discarded in-flight AI work.
- Telemetry: keep existing per-batch nonfatal reports; add the pool size to
  batch-failure payloads so fallback storms are visible.

## Code reuse decisions

**JS orchestration — share it (this change).** The pool, apply lane, stop
flag, and fallback semaphore are genuinely identical requirements in both
flows; hand-rolling them twice is how the two flows drift. That is the
`editor-ai-batch-pool.js` module above, unit-tested once on its own plus once
per flow integration.

**Rust batched-commit commands — extract narrow helpers, in a separate
refactor, not here.** `update_gtms_editor_row_fields_batch_sync` and
`apply_gtms_editor_ai_review_results_batch_sync` share a mechanical skeleton
(resolve repo → find chapter → languages + word counts → per row:
read/parse/apply/serialize/diff → word-count delta → prepared write → one
commit → clear imported-conflict entries → word counts + base sha). Two
reuse shapes were considered:

- *A closure-parameterized mega-helper* (per-row mutator + response builder
  injected): rejected. The commands differ in removals handling
  (`remove_images` / `write_row_files_and_commit_with_removals` vs plain
  commit), per-row response needs (review returns applied values +
  `last_update`; fields batch returns ids), and flag-change tracking. A
  helper generic over all of that has a wider signature than the duplication
  it removes — messier, and it couples two independently-evolving commands.
- *Two narrow helpers* — accepted, as a separate behavior-preserving refactor
  PR: (1) a per-row edit step (read row file → parse `Value` +
  `StoredRowFile` → apply mutation closure → serialize → changed? →
  word-count delta → `PreparedRowFileWrite`), and (2) a commit epilogue
  (commit with metadata → clear imported-conflict entries for changed rows).
  Each command keeps its own readable top-level flow. This also serves the
  already-deferred "unify Rust commit helpers" follow-up from the
  batch-derive work.

Kept out of the parallelization PR deliberately: that change is pure frontend
orchestration, and mixing a Rust refactor into it widens the blast radius of
both. Sequence: helpers refactor can land before or after, independently.

**JS save paths — follow-up, not now.** Translate saves go through the
write-intent queue; review applies through a direct command that both writes
and returns the applied row payloads. Migrating review onto the queue would
let the apply lane shrink to state-application only, but it reshapes the
review response-application path for no user-visible gain; the apply lane
already provides the needed serialization. Revisit if the queue migration
happens for other reasons.

## Files

- `src-ui/app/editor-ai-batch-pool.js` (new) — `createAiBatchPool`
  (pool + apply lane + stop flag + fallback slots), unit-tested directly.
- `src-ui/app/editor-ai-batch-request.js` — `AI_BATCH_CONCURRENCY = 3`
  constant with rationale comment.
- `src-ui/app/editor-ai-translate-all-flow.js` — provider hoist,
  derived-glossary pre-pass, adopt the pool.
- `src-ui/app/editor-ai-review-all-flow.js` — adopt the pool, history-load
  concurrency bound.
- `src-ui/app/editor-derived-glossary-batch-flow.js` — accept a whole-pair
  item list for the pre-pass (if its current entry point is per-batch
  shaped).
- Tests: `editor-ai-batch-pool.test.js`,
  `editor-ai-translate-all-flow.test.js`,
  `editor-ai-review-all-flow.test.js`.

No Rust changes in this PR (see reuse decisions above).

## Testing

`editor-ai-batch-pool.test.js` (deferred-promise tasks resolving out of
submission order):

- max concurrent `request` calls never exceeds the limit, including when
  fallback slots are being acquired;
- `apply` calls never overlap (enter/exit recording; assert no nesting) and
  run once per successful batch;
- first non-ok outcome stops new batches; in-flight ones finish and their
  applies still run;
- slot accounting: a failed batch's fallback calls cannot push total
  in-flight AI calls past the limit.

Flow tests (extend the existing batch tests, AI mocks resolving out of
order):

- translate: derivation runs once per language pair before any of that pair's
  translate calls; every batch's rows save exactly once through the grouped
  save; per-row fallback unchanged.
- review: batched applies never overlap; rows missing from a response fall
  back through the single-row command while other batches are in flight;
  cancel mid-pool starts no new batch calls and already-applied rows keep
  their saves.

Manual verification in `npm run tauri:dev`: a large chapter (100+ rows) for
each flow — wall-clock improvement, grouped commits in history (one per batch
response), live progress, mid-run cancel; on Windows additionally watch the
meaning-mode history loads.

## Rollout

- Land after v0.8.74's review batching has a few days of field use — this
  builds directly on the apply/save paths #196/#197 introduced.
- Ship with `AI_BATCH_CONCURRENCY = 3`. Revisit 5 only with evidence that
  typical team keys tolerate it.

## Non-goals

- No Rust changes in this PR; the narrow commit-helper extraction is its own
  behavior-preserving refactor (see reuse decisions).
- No cross-run global limiter (two simultaneous runs in different chapters
  remain independent, as today).
- 429 handling is retry-with-backoff on the batch path only
  (`runWithRateLimitRetry`, slot released during the wait); no adaptive
  concurrency reduction yet.
- No migration of review applies onto the write-intent queue (follow-up).
