# WordPress Image Cache Validation and Persistence Remediation

## Context

The current WordPress image metadata cache removes repeated Media Library searches,
but the first implementation has three weaknesses:

1. Every image lookup rereads, deserializes, and linearly searches the complete JSON
   cache. Cache writes likewise reread and rewrite the complete file per resolved
   image.
2. The in-process mutex and fixed temporary filename do not coordinate two running
   app processes, so concurrent exports can lose cache updates or race during atomic
   replacement.
3. A cached WordPress attachment is trusted indefinitely even though the Media
   Library is editable. Deleting, replacing, cropping, rotating, or regenerating an
   attachment can change its URL, dimensions, or validity while its source-derived
   cache key remains unchanged.

The existing **Refresh images and export** action is a useful explicit repair path,
but ordinary export should not silently reuse metadata known only from an earlier
export when WordPress can validate many attachments in one request.

## Goal

Keep repeat export substantially faster than per-image Media Library search while
making cached metadata reflect the current Media Library and making cache persistence
efficient and safe across app processes.

For a chapter with 27 warm cached images, ordinary image preparation should normally
perform:

- one initial cache snapshot read and, when metadata changes, one merge read during
  the single commit;
- one batched WordPress Media Library validation request;
- zero filename/slug searches when every cached attachment is still present;
- at most one cache commit;
- the final post create/update request.

## Non-goals

- Caching image bytes or arbitrary third-party remote images.
- Parallel image preparation.
- Watching WordPress for changes in the background.
- Treating a TTL as proof that media is unchanged.
- Removing the explicit refresh action.
- Changing Gutenberg serialization, captions, post selection, or overwrite behavior.

## Review follow-up

The implementation must keep local-image preparation memory-bounded: stream the
SHA-256 hash and retain only the path, small header-derived MIME type, file metadata,
and cache key. Read the complete image only when a verified lookup shows an upload is
required, and reject the upload if the file changed after hashing.

Cache-session deltas must be coalesced by typed key with last-write-wins semantics.
Commit removes all affected entries in one pass and appends only the final upserts in
last-touch order; validated remote images must not be recorded again during HTML
rewriting.

## Design

### 1. Use one cache session per export

Replace the per-image `load_cached_image` / `save_cached_image` API with an export-
scoped cache session.

At export start:

1. Open the cache once and deserialize it once.
2. Filter the selected site's entries into an in-memory map keyed by
   `WordPressImageCacheKey`.
3. Serve every local and WordPress-remote lookup from that map.
4. Record upserts and removals as a cache delta rather than writing immediately.
5. Commit the delta once after image preparation. Cache commit failures remain
   non-fatal and are written to the opt-in WordPress debug log.

Derive `Hash` for `WordPressImageCacheKey` and use a `HashMap` so an image lookup is
constant-time rather than a linear scan of the full cache.

The session should expose only the operations the export needs:

```text
get(key) -> cached metadata or miss
upsert(key, metadata)
remove(key)
commit()
```

The cache remains bounded to 10,000 entries. Applying an upsert moves that entry to
the newest end before oldest-entry eviction, preserving the current replacement and
eviction policy.

### 2. Make persistence cross-process safe

Use a separate cache lock file and an OS-level advisory file lock in addition to the
existing process mutex. Add a small cross-platform locking dependency such as `fs2`
unless an existing project utility can provide equivalent Windows/macOS behavior.

Do not hold the OS lock during network requests or image processing:

1. Acquire the lock briefly to read the initial snapshot, then release it.
2. At commit, reacquire the exclusive lock.
3. Reread the latest on-disk cache while holding the lock.
4. Apply only this export's recorded delta to that latest snapshot. This prevents an
   export from overwriting entries committed by another process after its initial
   read.
5. Serialize once to a uniquely named temporary file in the same directory (for
   example, including a UUID), then atomically replace the destination.
6. Release the file lock.

Forgetting a WordPress connection must use the same locked delta/commit path to remove
all entries for that site without deleting concurrent updates for other sites.

Malformed or unsupported cache data is treated as an empty snapshot and replaced on
the next successful commit, as today. File-lock, read, decode, or write failures must
never prevent WordPress export; they must fall back to an uncached export path.

### 3. Batch-validate cached Media Library attachments

Treat the cache as a durable mapping from image identity to a candidate attachment
ID, not as an immutable copy of WordPress metadata.

After collecting sources and loading the cache:

1. Identify every local or WordPress-remote image with a cache candidate.
2. Deduplicate its attachment IDs.
3. Fetch current media records in chunks of at most 100 using the WordPress REST API:

   ```text
   GET media?include=ID1,ID2,...&per_page=100&media_type=image
       &_fields=id,source_url,media_details
   ```

4. Map returned records by attachment ID and rebuild `CachedWordPressImage` from the
   current `source_url`, width, and height.
5. Upsert changed metadata into the cache session.

The current API response, rather than the stored snapshot, supplies the attachment
URL and dimensions used to generate Gutenberg markup. This handles edits that retain
the attachment ID, including crops, rotations, regenerated media details, and media-
replacement plugins that update the existing attachment.

No `modified` timestamp needs to be stored: the batched response already contains the
current metadata and is cheap enough to request on every export. A timestamp alone
would still require a request and would not be more authoritative than the returned
media record.

### 4. Repair missing or replaced attachments

If a cached attachment ID is absent from the batch response:

1. Mark its cache entry stale and remove it from the session.
2. Run the existing verified resolution for that image:
   - local images: deterministic slug lookup, then upload if missing;
   - WordPress-hosted remote images: exact source-aware slug/text lookup;
   - unrelated remote images: retain the existing dimension-fetch behavior.
3. If resolution finds a current attachment, use and cache its current ID, URL, and
   dimensions.
4. If a WordPress-hosted source no longer resolves to Media Library media, leave the
   original URL behavior intact and do not restore the stale entry.

This also handles delete-and-recreate workflows where the URL is retained but the
attachment ID changes: the old ID disappears from validation, then source lookup can
bind the cache to the replacement attachment.

If the batch request itself fails, do not trust the unvalidated cache. Fall back to
the existing per-image verified lookup path. If that path also fails, return the
existing actionable WordPress error. This prioritizes correct post markup over using
potentially stale metadata while preserving the current recovery behavior.

### 5. Preserve explicit refresh semantics

`refreshWordPressImages: true` continues to bypass cached identity-to-attachment
bindings and run the existing source/slug verification for every image. Successful
results replace cache entries in the export session and are committed once.

The **Refresh images and export** button remains available as a deliberate full
re-resolution tool for cases where the WordPress API or a plugin exposes inconsistent
metadata. Ordinary export uses batched validation and should be sufficient for normal
Media Library edits.

### 6. Separate resolution decisions from I/O

Refactor image preparation so the central decisions can be tested without a live
WordPress site. Keep HTTP in a small production adapter and make the orchestration
operate on injectable operations or closures for:

- batch lookup by attachment IDs;
- verified remote lookup by source;
- local deterministic-slug lookup/upload.

At minimum, extract pure helpers for:

- building bounded `media?include=...` paths;
- converting a batch response to current attachment metadata;
- reconciling cache candidates with returned/missing attachment IDs;
- selecting validated hit versus verified fallback versus refresh behavior.

Use call counters in tests to prove when the per-image lookup closure is or is not
invoked.

## Implementation steps

1. Add the remediation plan and keep changes limited to WordPress export/cache files,
   focused frontend wording or progress state if needed, and their tests.
2. Refactor `src-tauri/src/wordpress/image_cache.rs` into a snapshot-plus-delta cache
   session with `HashMap` lookup and one commit.
3. Add cross-process locking and unique same-directory temporary files using the
   standard-library file locking supported by the repository's Rust toolchain.
4. Add batch Media Library path construction and response parsing in
   `src-tauri/src/wordpress/export.rs` (or a focused WordPress media helper if the
   export module would otherwise grow further).
5. Split image collection/classification from deterministic HTML application so all
   cached attachment IDs can be validated before the sequential rewrite loop.
6. Reconcile validated, changed, and missing attachments; route only stale/missing
   entries through existing per-image lookup/upload logic.
7. Commit cache deltas once after image preparation. Preserve non-fatal cache errors
   and existing WordPress debug logging.
8. Keep the refresh payload and button behavior unchanged; optionally update export
   progress to distinguish `Checking cached images...` from per-image repair work.
9. Add the tests below, then perform a measured manual export comparison.

## Tests

### Cache persistence tests

- one session performs many gets/upserts with one disk read and one commit;
- local and WordPress-remote typed keys remain isolated by site;
- committing a delta merges with entries written after the session snapshot;
- two simulated writers updating different keys preserve both updates;
- updating a key moves it to the newest end;
- the 10,000-entry cap evicts the oldest entries;
- corrupt and unsupported cache files repair on commit;
- unique temporary files do not collide;
- forgetting one site preserves concurrent and unrelated-site entries;
- a lock or write failure is reported to the caller but remains non-fatal to export.

### Batch validation tests

- IDs are deduplicated and split into chunks of at most 100;
- request paths URL-encode the include list and request only required fields;
- a complete warm batch invokes no slug/text lookup closures;
- returned URL or dimension changes replace stale cached metadata and drive the new
  Gutenberg markup;
- a deleted ID is evicted and invokes verified source lookup;
- a delete-and-recreate result replaces the old attachment ID;
- a partial batch response repairs only missing IDs;
- batch request failure falls back to per-image verified lookup and never silently
  uses unvalidated metadata;
- refresh mode skips cached bindings and invokes verified lookup for every image;
- local cache hits are also validated and missing local attachments follow deterministic
  slug lookup/upload;
- cached and freshly resolved equivalent metadata produce identical post HTML.

### Frontend tests

- normal export continues to send `refreshWordPressImages: false`;
- explicit refresh continues to send `true`;
- refresh remains unavailable during export and invalid form states;
- batch-validation progress, if added, is rendered and does not change success/error
  handling.

## Verification

Run:

```bash
cargo fmt --all -- --check
cargo clippy --lib -- -D warnings
cargo test wordpress --lib
cargo test --lib
node --test --import ./src-ui/test/register-raw-loader.mjs \
  src-ui/app/editor-export-wordpress-flow.test.js \
  src-ui/screens/editor-export-modal.test.js
```

Then manually test with a chapter containing approximately 27 WordPress-hosted
images:

1. Export once to seed mappings and record preparation duration and WordPress GET
   count from the debug log.
2. Export again unchanged. Confirm one batch validation request, no slug/text media
   searches, current attachment-aware markup, and one cache commit.
3. Crop or rotate one attachment in WordPress, then export normally. Confirm the
   current URL/dimensions and aspect ratio are used without a full per-image refresh.
4. Delete and recreate one attachment, then export normally. Confirm the missing old
   ID triggers verified lookup and the cache binds to the replacement when resolvable.
5. Run **Refresh images and export** and confirm every cache binding is bypassed and
   reseeded.
6. Run two app instances exporting different image sets to the same site and confirm
   both sets remain present in the cache afterward.

Record first-export, unchanged-repeat, one-edited-image, and explicit-refresh timings
in the implementation handoff or release verification notes.

## Acceptance criteria

- A 27-image warm export uses one Media Library validation request rather than one or
  more searches per image.
- Current WordPress URL and dimensions are used after ordinary Media Library edits.
- Deleted cached attachments are never silently trusted.
- A complete warm validation performs zero slug/text searches.
- Cache JSON is loaded once for image lookup and committed at most once; the commit
  may reread the latest snapshot while locked so concurrent changes can be merged.
- Concurrent app processes do not lose each other's cache updates or collide on a
  temporary file.
- Cache I/O failures remain non-fatal and do not cause unvalidated metadata to be
  trusted.
- Explicit refresh retains its current full-bypass behavior.
- No image bytes, credentials, post content, or local filesystem paths are cached.
- Focused and full test suites pass, and measured before/after request counts and
  timings are recorded.
