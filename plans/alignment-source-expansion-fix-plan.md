# Give each target section its complete source corridor

## Problem and evidence

Chapter 24 of Fundamental Education reported 44/44 row conflicts. Successful
application alone does not establish correct alignment. The consumed job's
individual candidates are unavailable, so the exact historical AI responses
cannot be replayed.

`alignment-lab/MULTI_CHUNK_ALIGNMENT_PLAN.md`, step 9, and
`alignment-lab/scripts/run_row_level_from_corridor.mjs` require row passes to
include the selected source section and its immediate neighboring sections.
The original app's `align_rows` supplied only the selected source section.
This creates artificial disagreements when a correct match is outside a pass's
input, including an all-targets-conflict pattern with 82 source units and 44
target units distributed across three source windows. Restoring neighboring
sections reduces that fixture to 18 conflicts but does not solve the underlying
visibility problem: the inputs are still 1..75, 1..82, and 26..82, each paired
with the entire target section.

The revised implementation intentionally goes beyond restoring the lab design:
align each target section once against the union of its positive source corridor
sections and their neighbors. This gives the pass all source context selected
for that target, rather than treating incomplete views as competing answers.
Overlapping target sections still produce independent candidates; disagreements
between those candidates retain the existing conflict-resolution policy.

## Implementation

1. Build one row-alignment input per target section with the combined source
   corridor and neighboring sections. Preserve absolute IDs, deduplicate overlap,
   keep target windows unchanged, and do not fill gaps between distant matches.
   An unmatched target section emits empty candidates without an AI call.
2. Bump the alignment signature version so cached old results are not reused.
3. Add deterministic backend regressions for document edges, overlapping IDs,
   validator bounds, zero artificial conflicts with an exact matcher, unmatched
   target sections, and preservation of actual conflicting candidates.
4. Run the focused Rust alignment tests and formatting checks. Do not rerun paid
   AI requests or alter the user's saved translation as part of this fix.

## Verification

- The regression first failed against the previous per-pair implementation:
  expected zero conflicts, observed 18.
- All 14 `aligned_translation::tests` now pass via
  `cargo test --manifest-path src-tauri/Cargo.toml --lib aligned_translation::tests`.
- The synthetic exact-match fixture produces 44 conflicts with primary-only
  source windows, 18 with neighboring context per pair, and zero with one
  combined source corridor per target section. Both 44 content targets and 44
  content targets plus 10 unmatched lines are covered. The test checks every
  accepted source-ID set against the complete expected mapping and verifies
  one provider call per target section (one or two instead of three or six).
- Separate regressions check source-region bounds, document order, duplicate
  context, distant matches without gap filling, exclusion of negative/other-target
  matches, unmatched target sections without provider calls, and preservation of
  conflicting overlapping-target candidates (including empty versus nonempty).
- This reproduces the failure mechanism, not the unavailable historical AI
  responses. No live AI rerun of chapter 24 has been performed.
- `rustfmt --edition 2021 --check` on the changed Rust file and `git diff --check`
  pass. No frontend changes or writes to the user's project content were made.
- The installed/running app has not been rebuilt; the change is in local source.
