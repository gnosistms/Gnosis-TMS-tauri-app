# Launch working code with automatic version metadata repair

The Applications shortcut runs the primary working checkout, including unfinished
edits. It never fetches, switches revisions, or maintains a separate source copy.

## Implementation

1. Run npm run tauri:dev in the primary checkout through the existing process-group
   supervisor, with GNOSIS_SYNC_DEV_VERSION=1.
2. When the app label is older than a locally known release, verify release ancestry
   and use a reverse Git patch check to confirm the released source changes are
   already present. Verify release dependency/configuration changes as well.
3. Validate all six metadata files before updating their app version fields. Keep
   local code and unrelated metadata edits. Repeated startup is a no-op.
4. Stop with a specific explanation if release changes cannot be verified, a tag
   is missing, or metadata is inconsistent. Retain the backend compatibility check.
   Explicit GNOSIS_ALLOW_STALE_DEV_VERSION remains available for intentional old-code
   testing; the shortcut no longer enables that override.
5. Keep the original source, dependencies, Typst helper, and Rust build cache.
   The temporary managed checkout and its 264 MB of duplicate files were removed.

## Verification

- All 23 source/test files changed from v0.8.101 to v0.8.102 exactly matched this
  working tree, so the six metadata files were corrected to 0.8.102.
- Eleven guard/automatic-repair tests pass, covering extra unfinished edits,
  idempotency, missing source changes, missing dependency changes, invalid lockfile
  metadata without partial writes, missing baseline tags, and explicit overrides.
- All four existing Rust repo_app_version tests pass against 0.8.102.
- The installed shortcut points at the primary working checkout. A current dev
  session is running from that folder; the compiled library dependency metadata
  records CARGO_PKG_VERSION=0.8.102. Duplicate launch detection works.
- The automatic guard passes on the current checkout. Whitespace checks pass.
