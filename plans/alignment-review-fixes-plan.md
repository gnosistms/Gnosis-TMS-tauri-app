# Alignment review fixes

1. Per the user's clarification, remove candidate-boundary generation entirely.
   The LLM chooses original-text fragments; code verifies coverage and computes
   slices without evaluating grammar, punctuation, capitalization or word cuts.
   Preserve all original whitespace locally and invalidate old boundary caches.
2. Separate malformed model JSON from provider/request errors with a typed error.
   Route malformed JSON through bounded smaller-batch recovery; preserve valid
   cached siblings. Transport/authentication/rate errors still stop immediately.
3. Add regressions for the reviewed examples, exact applied text, bounded retry,
   cached recovery and non-retriable provider failures. Run focused Rust tests,
   full Rust library tests and strict Clippy. No UI or provider-setting changes.

Validation completed:

- 34 focused alignment tests passed; 674 full Rust library tests passed (five
  ignored). Strict Clippy across all targets, formatting and diff checks passed.
- New coverage includes unrestricted model-selected cuts after dashes, semicolons,
  quotes/brackets and within words; Unicode, exact whitespace retention, rejected
  edits/omissions/reordered content, and stale cached range rejection.
- Malformed/truncated JSON retries smaller groups, retains cached siblings, and
  stops at one target. Network, authentication, timeout and rate-limit failures
  propagate unchanged after one request.
- Two approved synthetic live tests passed with gpt-5.4. Twenty Spanish targets
  split in one request without fallback (1,762 input / 1,095 output tokens,
  approximately 6.3 seconds). Three Vietnamese paragraph targets and two subtitle
  targets preserved expected boundaries and original text.

The user clarified during the fix that the LLM must choose splits without a
predefined candidate list. The proposed expanded punctuation whitelist was removed
before completion. No grammar/capitalization/sentence-boundary checks, review flags
or review modal were introduced. No installed-app rebuild or user chapter writes.
