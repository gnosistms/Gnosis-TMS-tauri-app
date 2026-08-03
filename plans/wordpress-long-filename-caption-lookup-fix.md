# WordPress long-filename caption lookup fix

## Goal

Make Gnosis TMS detect the WordPress media-library caption for image URLs whose
filename-derived attachment slug is truncated or otherwise differs from the
stored WordPress slug.

## Root cause

The reported filename contains 30 search tokens and WordPress stores a shortened
attachment slug. The exact slug request therefore misses, while the previous
fallbacks still sent 27–30 terms. WordPress does not find the attachment with
those long searches, although a compact `Jesus of Nazareth` query does.

## Implementation

- Keep the exact filename-derived slug request first.
- Follow it with at most three distinct filename-prefix searches.
- Use 9, 6, and 3 tokens for long names so no fallback exceeds nine tokens.
- For names of 4–6 tokens, retain a near-full fallback that can discard one
  trailing optimizer token.
- Preserve dimension, `scaled`, and `rotated` suffix normalization.
- Continue accepting a caption only after exact URL identity matching.
- Preserve best-effort behavior and the empty-caption stop condition.

## Verification

- Focused WordPress caption tests, including the reported URL
- Recognized derivative suffix regression tests
- Exact URL matching and empty-caption tests
- Clean WordPress `More` suffix parsing for the reported caption
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- Complete Rust test suite
- Live public WordPress API checks for the reported image and a broader sample
