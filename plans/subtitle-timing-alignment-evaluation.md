# Subtitle timing alignment evaluation

## Scope

Test the proposed timing-first approach with an isolated, offline prototype. Do
not change the application's alignment path, user chapters, credentials, or call
an AI provider. This evaluates timing correspondence and request input reduction,
not semantic translation accuracy or live model latency.

## Plan

1. Build a pure timing matcher with conservative direct matches, bounded offset
   inference, local ambiguity groups, and explicit fallback.
2. Exercise known-answer fixtures: matching/near timing, omissions, duplicate and
   overlapping cues, splits/merges, rolling-caption structure, offsets, drift,
   edited timelines, partial files, invalid timing, and unrelated same-timing text.
3. Inspect available recent-run metadata and original subtitle files if available;
   replay read-only and report evidence separately from synthetic results.
4. Measure local runtime, exact mapping/ambiguity outcomes, baseline section call
   counts, and text bytes needing semantic checks or fallback. Record limits and
   recommend what should ship first.

## Results

The final specification below is implemented as a dedicated local SRT command.
No live AI requests or credential changes were made.

- Read-only replay of `original.es.srt` (599 cues) and `edited.vi.srt` (279 cues):
  **57 exact start matches, 222 inserted rows, 821 resulting rows**. Planning and
  order-key allocation took 6.388 ms in a debug test, excluding disk writes/commit.
- Every incoming cue is accounted for and resulting rows are chronological. The
  actual existing chapter's 599 start times also match the original SRT exactly.
- 406 Rust project-import tests passed (4 opt-in tests ignored); the actual-file
  replay above passed separately. Full app/screen JS suite: 2,923 passed before
  the final two subtitle-routing/cancellation regressions; those passed in the
  focused rerun. Strict Clippy, scoped ESLint and whitespace checks passed.
- Unused-code audit reports the pre-existing unrelated findings; no findings
  involve the subtitle or cancellation changes.

### Why the actual files differ (read-only text/timing sample)

- Target 3 starts 00:00:23,551 and combines the end of source 2 (speaker's name)
  with the beginning of source 3 (headquarters in Mexico). A translated cue
  crosses the original cue boundary.
- Target 10 combines source 13 ("then I was called") and 14 ("Chou Li"). Its
  start 00:02:27,057 is later than the source phrase's start 00:02:23,980.
- Target 22 condenses source 53–58 into one sentence, timed 00:05:30,563–38,225
  versus the source span 00:05:32,920–51,940. This is also the target which the
  failed AI run attempted to split across six source rows. The rejected model
  response was not cached, so the exact invalid fragment is not known.
- Target 76 translates source 215 but starts 596 ms earlier and ends 776 ms
  earlier: individual retiming rather than a uniform file-wide offset.
- Target 141 translates source 367 but starts 9,183 ms earlier. Its interval
  overlaps a different source passage; nearest-time/overlap would be misleading.
- Target 210 translates source 482 and target 270 translates source 585; both
  begin exactly 272 ms later. Across the file 55 target starts are exactly 272 ms
  after their nearest source start (not all 55 pairs were semantically reviewed).
- Of the 222 non-exact starts, 5 are within 100 ms of a source start, 14 within
  250 ms, and 84 within 500 ms. Median nearest-start difference: 835 ms.

The files are structurally valid, but the translated track is resegmented and
retimed. No audio was inspected, so which timings follow the recording correctly
and which external editing step changed them are not established.

## Final user specification (supersedes timing/AI experiments above)

Implement a separate, entirely local subtitle path:

1. Strictly validate SRT syntax before language selection and again before apply.
2. Match incoming cues solely by identical start time. Keep matched existing rows
   and their timing unchanged; add translation text to the new target language.
3. Insert every unmatched cue as a new row at its chronological position, keeping
   its original text and timing. Do not attempt semantic matching or AI splitting.
4. Preserve cue boundaries, including internal line breaks; skip rolling-caption
   normalization in this path. Reuse guarded, rollback-capable bulk chapter writes.
5. Cover this path with known-answer parser/planner/apply tests and replay both
   actual files read-only. Retain the cancellation work in the separate plan.

No AI provider calls, key access, or model configuration are needed.
