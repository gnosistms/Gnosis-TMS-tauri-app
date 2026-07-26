# Project Transfer Review Fixes

Status: implemented and verified.

## Scope

Address the three findings from review of draft PR #204 without changing unrelated
spinner adoption or other working-tree changes.

## Implementation

1. Make durable project-transfer status replacement cross-platform by using the
   existing Rust atomic replacement helper. Add a focused test that replaces an
   existing journal destination.
2. Strengthen uploaded-image validation so the canonical chapter `images` directory
   must remain inside both the canonical source chapter and source repository. Add a
   Unix regression test for an `images` directory symlink that escapes the repo.
3. Stop unchanged transfer-status polls from rendering the modal again, so the loading
   button is not recreated every polling interval. Rely on the shared keyed-spinner
   continuity implementation for the remaining renders where the transfer stage really
   changes. Add a frontend regression test that verifies repeated identical progress
   statuses render only once.

## Verification

- Focused project-transfer frontend tests pass.
- Focused Rust project-transfer and team-copy tests pass.
- Full JavaScript and Rust suites, focused ESLint, Rust formatting, and strict Clippy
  pass. The unused-file audit still reports the pre-existing unrelated
  `scripts/bench-ai-translate.mjs`.
