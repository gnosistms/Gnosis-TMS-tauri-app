# Subtitle overlap matching and meaning checks

1. Replace the 30% gate with a strictly-more-than-5% exact-start mismatch gate.
   Preserve the requested wording and pause before any chapter writes.
2. After explicit consent, retain exact matches and assign each remaining cue
   to the greatest positive overlap among still-unassigned original rows. Keep
   one-to-one assignment, deterministic ties, and existing source timing.
3. Warn again if more than 5% remain unmatched after overlap. Those remaining
   cues keep the existing behavior of insertion in time order if approved.
4. Sample up to 20 overlap-only matches spread across the file. Send numbered
   original/new text lines without timing data to the configured AI provider.
   Validate complete answers; cache validated classifications so confirmation
   never repeats the same paid check. More than 3 negative pairs requires the
   final warning with every rejected example and Save (not recommended).
5. Bind each consent and cached check to the exact file/source/matching plan.
   Never hold the repo lock across AI work. Revalidate the source under the lock
   before the shared rollback-capable save; preserve cancellation and progress.
6. Test exact/overlap thresholds, reservations, conflicts/ties, sampling, prompt
   privacy, response completeness, all warning transitions and source changes.
   Run read-only real-file replay, a small synthetic live AI check with the
   authorized existing test key, and relevant frontend/backend checks.

## Result and validation

Implemented the staged 5%/5%/more-than-3 workflow, all three requested warning
messages, a bounded list containing every rejected example, explicit Cancel and
Continue/Save actions, cancellation, and source revalidation before save.
Exact matches are reserved before overlap; overlap picks the largest positive
available intersection, with source-order ties and no row reuse.

The native command now returns `started` after access preflight. A scoped result
event delivers completion; AI work runs without the repository lock. Validated
numbered meaning decisions are cached by text, prompt version, model and provider.
Neither timestamps nor persistent row IDs are sent to the AI.

- 416 Rust project-import tests passed, 6 opt-in tests ignored by default.
- All 2,933 frontend app/screen tests passed. Strict Clippy, scoped ESLint, and
  whitespace checks passed. The unused-code audit has only its existing unrelated
  findings.
- Authorized live synthetic test (`gpt-5.4`): 20 pairs, all 16 translations and 4
  unrelated pairs classified correctly; 4.723 s, 530 input + 215 output tokens.
- Authorized read-only real-file test: 57 exact + 202 overlap matches, 20 of 279
  still unmatched (7.168%). The 20 overlap-only sample pairs produced 16 negative
  AI decisions, so all three warnings would appear. The meaning request took
  3.589 s, 1,022 input + 215 output tokens. These are sampled model judgments,
  not an independently annotated accuracy score.
- No user subtitle files or chapter data were saved during evaluation. Existing
  application credentials/model settings and the reused test-key file were not
  changed.
