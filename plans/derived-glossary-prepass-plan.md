# Derived-glossary pre-pass: derive a language pair in parallel before its batches run

## Status (2026-09-06)

Implemented.

## Problem

`editor-ai-translate-all-flow.js` documents a derived-glossary pre-pass that
warms every row's derived entry up front, leaving the per-batch derivation
lane (`inDerivationLane`, a serial lane) to serve cache hits. The pre-pass
was never built: the only derivation call is the per-batch one inside the
lane, and it does the full work for its 15 rows — a pivot-generation AI
call, the pivot saves, then an alignment AI call — one batch at a time.
Inside `ensureBatchDerivedGlossaries` the chunks of both phases run in a
plain sequential loop, and its AI calls do not draw on the pool's slot
semaphore at all.

Field run 2026-09-06 (982-row EN→VI chapter with a pivot glossary): batch
completions arrived one at a time 10–40 s apart; only 6 of 45 gaps were
under 5 s. The 6-slot translation pool was idle behind the lane.

## Design

1. `ensureBatchDerivedGlossaries` gains `concurrency` (default 1, so every
   existing caller keeps sequential behaviour), `withSlot`, and `inApplyLane`.
   - Chunks of each phase (pivot generation, then alignment) fan out through
     `mapWithConcurrency`. Phase order is unchanged: all pivot texts exist
     before alignment chunking.
   - Every AI call runs inside `withSlot` when supplied, so derivation
     shares the run's global cap on in-flight AI calls (the pool's design
     rule: batch requests and fallbacks draw from one budget).
   - Every chapter-state mutation — pivot writes, the grouped pivot save,
     re-resolution, applying derived entries, the cache write — runs inside
     `inApplyLane` (the pool's lane when supplied, else a private serial
     lane). Slot-then-lane ordering is respected: the slot is released
     before the lane is entered.
   - Apply and cache persistence stay once per chunk (the 2026-07-06 OOM
     constraint); concurrency changes when chunks apply, not how.
   - `results` are returned in item order regardless of completion order.
2. Translate All runs the pre-pass per derived language-pair group, right
   before `pool.run` for that group, with the pool's `withSlot` /
   `inApplyLane` and its concurrency. The group's batches then find cached
   entries in the (kept) residual lane; rows the pre-pass could not resolve
   still fall back per batch as before. Pair order is unchanged, so the
   glossary-source pair still finishes before derived pairs start.
3. The Derive Glossaries modal passes `AI_BATCH_CONCURRENCY` too; with no
   pool it gets the private serial lane and `mapWithConcurrency` caps its
   in-flight AI calls.

## Tests

- `editor-derived-glossary-batch-flow.test.js`: chunks overlap up to the
  limit and never exceed it; results come back in item order; state applies
  serialize.
- `editor-ai-translate-all-flow.test.js`: a 20-row derived pair makes its
  derivation calls before any translation call, concurrently, and the
  per-batch derivation makes no further calls.
