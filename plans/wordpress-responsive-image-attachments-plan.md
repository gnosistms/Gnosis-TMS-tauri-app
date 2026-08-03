# WordPress Responsive Image Attachments Plan

## Goal

Ensure every WordPress Media Library image exported by Gnosis TMS is serialized
as an attachment-aware Gutenberg image block so WordPress can generate responsive
`srcset` candidates, including Retina-resolution variants.

## Work

1. Preserve attachment IDs returned by new uploads and reuse lookups.
2. Resolve same-site, Jetpack CDN, and WordPress.com files CDN URLs to their
   attachment records using exact-slug lookup plus bounded filename-search
   fallbacks verified against the returned media URLs.
3. Add the attachment ID and canonical `wp-image-{id}` class to exported blocks
   while preserving display sizing, captions, and legacy fallbacks.
4. Add regression tests for uploaded, reused, same-site remote, and unrelated
   external images, then run the focused Rust test suite.

## Verification

- Focused `wordpress::export` Rust unit tests pass.
- Exported attachment blocks contain both the Gutenberg `id` attribute and the
  matching `wp-image-{id}` class.
- Unrelated remote images remain remote and are not mislabeled as attachments.
- Media lookup failures stop the export instead of silently publishing a block
  without responsive metadata.
