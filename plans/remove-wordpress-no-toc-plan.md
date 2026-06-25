# Remove WordPress `[no_toc]` Injection

## Goal

Stop Gnosis TMS from automatically appending the `[no_toc]` shortcode to WordPress exports.

## Steps

- Remove the automatic `[no_toc]` shortcode block from the WordPress serializer.
- Update WordPress serialization/export tests that expected the shortcode.
- Run focused frontend tests for preview serialization and WordPress export flow.
