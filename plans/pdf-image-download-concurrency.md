# Separate PDF image downloads from processing

Allow up to 12 image downloads while retaining four image-processing workers.
Connect the stages with a bounded queue so downloads can overlap decoding,
resizing, and encoding without accumulating all downloaded originals in memory.

1. Extract the pending-image worker pipeline into independently bounded download
   and processing stages. Preserve deduplication, cache behavior, placeholders,
   completion progress, stable output order, and cancellation.
2. Add native regressions that exercise overlapping stages, independent worker
   limits, and cancellation while the queue is full.
3. Run focused pipeline tests and the existing native PDF tests, then check
   formatting and linting for the changed Rust code.

Implemented: a 12-worker download stage feeds four processing workers through a
four-item bounded channel. Cancellation disconnects the receiver when processing
workers exit, releasing downloaders waiting on a full queue. Existing image cache,
download policies/retries, output ordering, and completion progress are preserved.

Validation:
- All 64 native PDF-module tests passed, including three new pipeline regressions.
- Regressions verify independent worker limits, overlapping stages, bounded
  buffering, exactly-once processing, full-queue cancellation, and empty/cancelled work.
- Strict library/test Clippy (`-D warnings`), Rust formatting, and diff whitespace passed.

Status: complete. Actual download speed depends on the image hosts and connection;
no live-network speedup benchmark was performed.

PR preparation on current main (2026-10-27): isolated only the pipeline change,
three regressions, and this plan from the shared checkout. All 62 native PDF tests
on this base passed; the shared development checkout has additional unpublished
PDF tests covered by the earlier 64-test run.
