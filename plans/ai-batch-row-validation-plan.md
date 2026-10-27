# Batch translation row labels and validation

## Objective

Use model-facing row labels `1` through `n` and reject an inconsistent response
before any translation reaches the editor. Preserve batch sizes, concurrency,
and successful-call efficiency. Based on the P11 investigation recorded in
`ai-batch-row-alignment-investigation-plan.md`.

## Implementation

1. Render translation batch rows with request-local numeric string labels; keep
   durable row IDs in the IPC request and local request state only.
2. Validate the complete parsed response against the exact label set. Reject
   missing, blank, duplicate, and unexpected labels. Map valid labels back to
   durable IDs using the request, regardless of response ordering.
3. Return a command error for invalid batches, activating the existing full
   batch single-row fallback before any batch result is applied. Keep the
   response shape compatible and the review flow unchanged.
4. Test prompt numbering, mapping, reordered responses, independent batches,
   and the partial/shifted response failure pattern. Run Rust AI tests and
   relevant frontend batch/fallback tests, plus formatting checks.

The same backend protects pivot translation batches. Their existing error path
returns unresolved work to the existing fallback. No provider calls or edits
to the user's chapter data are needed for implementation verification.

## Limits

This is deterministic structural validation, with no additional model call on
successful batches. A complete label set with semantically swapped text can
still pass. Numbering is a prompt improvement, not semantic proof.

Status: implemented and verified.

## Result

- Translation prompts number row labels from `1` to `n` as strings, including
  an explicit instruction to copy the label rather than a chapter number in
  the text. Labels restart independently for each request.
- Rust validates the unfiltered response before exposing any result, then maps
  labels back to the request's permanent IDs. Reordered output maps correctly;
  incomplete, duplicate, blank, or unknown labels reject the entire batch.
- Rejections use the existing command-error fallback to individual requests.
  Successful batches retain their existing size, concurrency, and grouped save.
  The response shape stays compatible; `unknownRowIds` is empty on success.

## Verification

- Rust AI-related tests: 96 passed, 1 existing ignored test. Initial sandbox
  run blocked three broker tests from opening localhost mock-server ports;
  rerun with port access passed all enabled tests. No real provider calls.
- Relevant frontend translation and derived-glossary batch tests: 56 passed,
  including command-error fallback and concurrent batch application.
- Rust formatting and `git diff --check`: passed.
- New regression cases cover 15 numbered labels, identical source strings,
  batch-local mapping, all translated fields, reordered responses, and rejection
  of partial shifted results or malformed label sets.
- Live model quality after the prompt change has not been retested. The user's
  existing chapter data was not modified.
