# Release 0.8.29 Plan

## Goal

Publish the next patch release after `v0.8.28`.

## Steps

1. Bump release metadata from `0.8.28` to `0.8.29` in the npm, Tauri, and Cargo manifests.
2. Run the local verification commands that are practical before a tag release.
3. Commit the version bump, create tag `v0.8.29`, and push `main` plus the tag so the release workflow publishes the Tauri builds.

## Verification

- `npm test`
- `npm run audit:unused`
- `cargo test`
