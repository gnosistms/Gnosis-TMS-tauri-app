# Release 0.8.95

## Goal

Publish the five verified Sentry remediation fixes as the next patch release for
macOS (Apple silicon and Intel) and Windows.

## Included changes

- Recover persistent storage safely when a stale Tauri resource handle fails.
- Keep read-only team members from loading shared AI provider caches.
- Treat signed-out installation queries as expected authentication control flow.
- Remove Windows local-repository discovery time-of-check/time-of-use races.
- Retry transient updater download and response-body failures once.

## Release steps

1. Commit each remediation workstream with its focused tests.
2. Bump all application version metadata from `0.8.94` to `0.8.95`.
3. Run frontend, workflow, Rust, formatting, and diff-integrity checks.
4. Push `main`, create and push annotated tag `v0.8.95`.
5. Monitor the release workflow through asset publication and verify the GitHub
   release contains both macOS architectures, Windows installers, and updater
   signatures/manifests.

## Verification

- `npm test`
- `npm run lint:js`
- `npm run format:rust:check`
- `npm run test:rust`
- `git diff --check`
