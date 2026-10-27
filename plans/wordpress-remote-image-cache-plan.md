# WordPress Remote Image Metadata Cache

> **Follow-up:** Warm attachment mappings are no longer trusted indefinitely. The
> implementation now validates cached attachment IDs in batches and merges cache
> updates through an export-scoped, cross-process-safe session. The authoritative
> remediation design is in `plans/wordpress-image-cache-validation-plan.md`.

## Problem

WordPress exports process every unique image serially. The existing local-image cache
only applies to repo-relative project images keyed by their content hash. In the normal
Gnosis TMS workflow, however, chapter images are usually WordPress-hosted URLs. Those
images still trigger Media Library API searches on every export, so repeat overwrites
show little or no speed improvement.

For a WordPress-hosted source, the current export path:

1. Recognizes same-site uploads, WordPress.com files-CDN URLs, and Jetpack image-CDN
   URLs.
2. Derives an attachment slug and several filename search terms.
3. Calls the WordPress Media Library API until it finds an exact source match.
4. Recovers the attachment ID, canonical source URL, and natural dimensions.
5. Rewrites the Gutenberg image block with attachment-aware responsive-image markup.

The Media Library work is deterministic for an unchanged source URL and connected
site, but its result is not currently persisted.

## Goal

Make repeat WordPress exports reuse previously resolved attachment metadata for
WordPress-hosted remote images, while preserving correct Gutenberg markup and falling
back safely when the cache is absent, corrupt, stale, or bypassed.

An unchanged overwrite whose images have already been resolved should perform no
per-image Media Library searches. The only required network operation after image
preparation should normally be the final post update.

## Cache identity and stored data

Extend the versioned WordPress image metadata cache with an explicit entry kind.

### Local image entry

Keep the existing identity and behavior:

```text
siteId + local + SHA-256 content hash
→ attachmentId, sourceUrl, naturalWidth, naturalHeight
```

### WordPress remote image entry

Add:

```text
siteId + wordpressRemote + normalized origin image identity
→ attachmentId, sourceUrl, naturalWidth, naturalHeight
```

The normalized origin identity must use the existing
`wordpress_origin_image_identity` behavior:

- normalize the host case and remove a leading `www.`;
- decode the URL path;
- strip query parameters such as Jetpack resize parameters;
- map `i0.wp.com`, `i1.wp.com`, and `i2.wp.com` URLs back to their encoded origin host
  and path;
- treat registered WordPress thumbnail URLs as aliases only during Media Library
  verification, not by guessing a different cache identity;
- never cache an unrelated third-party remote URL under this entry kind.

Do not key by attachment ID alone because IDs are site-local. Do not key only by the
filename because different uploads can share a filename.

## Export behavior

1. Collect unique image sources as today.
2. For a repo-relative source, retain the current content-hash cache path.
3. For a source accepted by `wordpress_media_lookup_for_site_source`:
   - derive its normalized origin identity;
   - look up `{siteId, wordpressRemote, identity}` before any Media Library request;
   - on a hit, apply the cached attachment metadata to the content immediately;
   - on a miss, run the existing exact-slug and bounded text-search flow;
   - after a verified match, persist the result under the normalized identity.
4. For unrelated remote URLs, keep the current dimension-fetch behavior. Caching
   third-party downloads is out of scope for this change.
5. Preserve deterministic sequential HTML rewriting. Parallel image preparation is
   out of scope.

Cache read, decode, lock, and write failures must remain non-fatal. Log the cache miss
reason through the existing opt-in WordPress debug log and continue through the
current Media Library lookup path.

## Stale attachment handling

The WordPress post update API can accept a cached URL even after its Media Library
attachment has been deleted, so post success alone cannot validate an entry.

Use a deliberately simple recovery policy:

- clear all cached image entries for a site when its connection is forgotten, as the
  local-image cache already does;
- add a `refreshWordPressImages` boolean to the export input, defaulting to `false`;
- when true, bypass both local and WordPress-remote cache reads for that export while
  still replacing entries with newly verified results;
- expose this as a secondary **Refresh images and export** action only when WordPress
  export is ready to submit, without changing the normal primary export action;
- keep ordinary exports cache-first and make no validation request on a warm hit.

This gives users an explicit repair path without reintroducing one network request per
image on every export. A TTL is intentionally omitted: expiring entries on time alone
would make unchanged chapters periodically slow again without proving that media had
changed.

## Persistence and bounds

- Continue storing metadata only; never cache image bytes, credentials, post content,
  or local filesystem paths.
- Keep atomic file replacement and the process-wide cache lock.
- Preserve the 10,000-entry bound. Updating an entry should move it to the newest end
  so the existing oldest-entry eviction remains useful.
- Bump the cache schema version because entries gain an explicit kind and identity.
- Treat an older or malformed cache as empty and repair it on the next successful
  resolution. No migration is required because every entry can be rediscovered from
  WordPress.

## Implementation steps

1. Refactor `src-tauri/src/wordpress/image_cache.rs` so cache keys represent local
   content hashes or WordPress remote identities explicitly.
2. Extract or expose the normalized WordPress origin identity needed by both remote
   lookup verification and cache-key construction; keep one canonical normalization
   implementation.
3. Consult and seed the remote cache inside the same-site/WordPress-CDN branch of
   `run_wordpress_export`, before `find_site_media_by_source`.
4. Add the refresh-bypass field to `WordPressExportInput` with a Serde default so old
   frontend payloads remain valid.
5. Thread the refresh choice through `editor-export-wordpress-flow.js` and the export
   modal action routing/rendering without changing normal export defaults or remembered
   post selection.
6. Update the existing cache plan/documentation to record that local and WordPress
   remote entries share one bounded metadata cache.

Because this change touches more than two files, keep implementation within this plan
and do not combine it with parallel processing or unrelated export work.

## Tests

### Rust cache tests

- local and WordPress-remote keys cannot collide;
- identical remote identity on different sites remains isolated;
- origin, WordPress.com files CDN, and Jetpack CDN representations normalize as
  intended;
- query-only URL changes reuse the same entry;
- unrelated remote URLs are not cacheable as WordPress media;
- replacement, eviction, corrupt-cache repair, and site removal still work after the
  schema change.

### Rust export tests

- a warm WordPress-remote hit supplies attachment ID, canonical URL, and dimensions
  without invoking the Media Library lookup helper;
- a miss runs the existing verified lookup and seeds the cache;
- refresh mode bypasses a warm hit and replaces it with the verified result;
- failed cache access falls back to the lookup path;
- responsive Gutenberg image markup is identical for cached and freshly resolved
  metadata;
- local-image cache behavior remains unchanged.

Structure the lookup decision behind injectable or pure helpers so these assertions do
not require live WordPress access.

### Frontend tests

- normal export sends `refreshWordPressImages: false`;
- the refresh action sends `true` while preserving site, post, title, content, and
  footnotes;
- refresh is unavailable during an active job or invalid form state;
- successful refresh follows the same success/default-memory behavior as ordinary
  export.

## Verification

Run:

```bash
cargo fmt --all -- --check
cargo clippy --lib -- -D warnings
cargo test wordpress --lib
cargo test --lib
node --test src-ui/app/editor-export-wordpress-flow.test.js
```

Then manually verify with a chapter containing approximately 27 WordPress-hosted
images:

1. Enable the opt-in WordPress debug log.
2. Export once and confirm Media Library lookups populate remote cache entries.
3. Overwrite the same post again and confirm every unchanged image reports a remote
   cache hit with no per-image WordPress GET.
4. Confirm the published post retains attachment IDs, responsive `wp-image-*` classes,
   dimensions, captions, and image order.
5. Use **Refresh images and export** and confirm Media Library lookups occur again and
   replace the cached metadata.

## Acceptance criteria

- The second export of an unchanged WordPress-hosted-image chapter performs zero
  Media Library searches for warm entries.
- Cache hits produce the same post HTML as verified lookup results.
- Changing the connected site cannot reuse another site's attachment metadata.
- Cache failure never blocks export.
- Users can explicitly bypass and refresh stale entries.
- No image bytes are added to the cache.
- The measured preparation time for the 27-image repeat overwrite is recorded before
  and after implementation in the plan or release verification notes.

## Out of scope

- Parallel image preparation.
- Caching arbitrary third-party remote-image dimensions or bytes.
- Periodic background validation or TTL-based expiration.
- Detecting Media Library deletion without an explicit refresh.
- Changing upload filenames, attachment slugs, captions, WordPress authentication, or
  post overwrite semantics.
