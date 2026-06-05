# Issue 2 Node 22 Test Fix Plan

## Context

Issue #2 tracks pre-existing test failures on Node 22 caused by test files assigning
directly to `globalThis.navigator`. Node 22 exposes `navigator` as a getter-only
property, so those assignments throw during module load.

Joshicola also reported one Rust test failure, but the named test and full Rust suite
currently pass in this checkout. Treat the Rust item as non-reproduced unless it fails
during verification.

## Plan

1. Add a shared test helper that installs `globalThis.navigator` with
   `Object.defineProperty`, preserving configurability for tests that change online
   state.
2. Replace the 9 direct `globalThis.navigator = ...` assignments with the helper.
3. Verify with the focused affected JS tests, full `npm test`, the named Rust test,
   and full `cargo test --manifest-path src-tauri/Cargo.toml`.

