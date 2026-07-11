# Issue 169 code-review follow-ups

## Goal

Close the three correctness gaps found in review without weakening the original
ten fixes.

## Plan

1. Make resource title/lifecycle retries commit only the intended field transition.
2. Return and propagate failures when aborting interrupted Git operations.
3. Acquire transport credentials from the locked sync decision rather than an unlocked preflight.
4. Add focused regression tests and run the complete Rust suite.
