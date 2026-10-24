# Conflict resolution image payload fix

The conflict resolution save sends normalized UI image metadata directly as
`baseImages`. URL images have a null `path`; uploads have a null `url`. The Rust
`EditorFieldImageInput` requires strings for both, so deserialization fails before
the row save can run. Other image saves already convert unused fields to empty strings.

1. Reproduce the reported error against the Rust command input type and verify the
   accepted wire format, including image removal.
2. Serialize conflict image bases using the same string-only shape as other image
   saves; retain null for a missing image. Cover real normalized UI images in tests.
3. Run focused Rust and frontend tests, lint, and the frontend build. Preserve all
   unrelated working changes.

Implemented: conflict image bases now serialize only `kind`, `url`, and `path`,
using empty strings for unused properties. Missing images remain null. Tests
cover actual normalized UI metadata for URL/upload images and image removal;
the native input test reproduces the exact reported error before serialization
and accepts the corrected payload.

Verification: 62 focused frontend tests, the Rust input contract test, all 3,007
frontend unit tests, scoped ESLint, scoped rustfmt, and the production build pass.
The full Rust formatting check reports unrelated changes in AI and command
registration files; the unused-code audit reports unrelated files/exports. No
exports or files counted by that audit were added by this fix. All 25 workflow
tests pass when rerun with local socket access after the sandbox failures.
