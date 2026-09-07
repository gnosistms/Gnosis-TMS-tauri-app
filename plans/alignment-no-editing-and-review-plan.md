# Alignment: verbatim splits and merges

The user's final instruction is to let the LLM decide where to split. The app
must not correct capitalization/punctuation, enforce sentence completeness, or
mark rows for review. Users handle any cleanup.

## Current implementation

- The LLM sees the original target text and its matched source rows, then returns
  source IDs and exact target-text fragments. There is no candidate-boundary list.
- Code validates fragment coverage and order and calculates ranges into the
  original input. Applied row text always comes from original slices. Missing
  inter-fragment whitespace in the response is retained locally from the input;
  edited text or skipped non-whitespace content is rejected.
- Final checks reject cached text or ranges that differ from the original slices.
  The v8 signature invalidates earlier jobs and candidate-boundary caches.
- No replacement-text fields, sentence classifiers, capitalization repairs,
  review flags, filters or review modal. The Edit text recovery action is removed.
  Existing notes and flags are preserved. Nonblank input lines keep outer
  whitespace; paragraph parsing and newline merge separators remain unchanged.
- Batching (up to 50 targets subject to byte budgets), four concurrent provider
  calls, individual checkpoints and isolated retries remain. Malformed JSON
  triggers smaller-batch recovery; provider/request errors stop immediately.

## Current validation

See [review fixes](alignment-review-fixes-plan.md) for regression coverage.

- Focused alignment: 34 passed; full Rust library: 674 passed, five ignored.
- Strict Clippy, Rust formatting and diff checks passed.
- Earlier UI verification remains applicable: 2,124 application/screen tests and
  23 workflow tests passed. Review fixes changed no frontend code.
- Two approved synthetic live tests passed using gpt-5.4. All 20 Spanish targets
  split in one call without fallback: 1,762 input / 1,095 output tokens, about
  6.3 seconds. Three Vietnamese paragraph splits and two subtitle continuations
  preserved the expected text and boundaries with no capitalization changes.
- The separate row-alignment fixture still used 1,847 input tokens versus 5,677
  with full metadata (67.5% reduction). These synthetic measurements do not
  guarantee timing or semantic accuracy for every language and document.

The earlier v6 numbered-parts experiment used 3,158 input / 615 output tokens and
about 3.7 seconds for the Spanish split fixture. That representation was removed
following the user's clarification; those figures do not describe current code.

No installed-app rebuild, release, commit or user chapter writes were performed.
