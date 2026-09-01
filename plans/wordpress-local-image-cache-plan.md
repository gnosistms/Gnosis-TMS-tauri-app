# WordPress Local Image Metadata Cache

## Goal

Make repeat WordPress exports reuse the attachment metadata already resolved for
unchanged local project images, without caching image bytes or changing remote-image
behavior.

## Scope

1. Add a versioned, bounded app-data cache keyed by WordPress `siteId` and the local
   image's SHA-256 content hash. Store only attachment ID, public URL, and natural
   dimensions.
2. Read the local file and compute its hash on every export. Use a cache hit before
   the existing WordPress media lookup; seed the cache after either a successful
   lookup or upload. Cache failures remain non-fatal and fall back to the existing
   path.
3. Remove cached entries for a site when its WordPress connection is forgotten.
4. Add focused tests for site/hash scoping, replacement, corrupt data, and site
   removal, then run the WordPress Rust tests.

## Out of scope

- Caching image bytes, arbitrary third-party remote image dimensions, or complete
  prepared post HTML.
- Parallel image preparation.
- Changing WordPress upload, Gutenberg serialization, or display-sizing behavior.

## Follow-up

The shared metadata cache now also supports verified WordPress-hosted remote images.
That extension, including its explicit refresh path and URL-identity rules, is defined
in `plans/wordpress-remote-image-cache-plan.md`.
