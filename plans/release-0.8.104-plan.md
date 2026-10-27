# Release 0.8.104

## Goal

Ship deterministic validation and short numeric labels for AI translation
batches. Publish useful, versioned GitHub release notes after all platform
installers are built.

## Included changes

- AI translation batches identify rows with simple labels from `1` to `n`.
- Reject incomplete, duplicate, blank, or unexpected batch labels before any
  translation is written; failed batches use the existing individual retry
  path.
- Add a release-notes publication job that requires a Markdown file for each
  release tag and applies it to the GitHub release after all installers upload.

## Release steps

1. Bump package, Cargo, Tauri, lockfile, and bundled-notice version metadata
   from `0.8.103` to `0.8.104`.
2. Add `docs/releases/v0.8.104.md` with user-facing notes.
3. Validate workflow syntax and version metadata; run relevant project tests.
4. Merge the release pull request, create and push annotated `v0.8.104`, and
   monitor all release jobs for signed macOS and Windows installers.

## Validation

- Release workflow YAML parses successfully.
- Version metadata is synchronized at `0.8.104`; the development version guard
  accepts it.
- The frontend unit suite and 19 workflow tests passed. Four dev-launcher
  lifecycle tests could not start a child server inside the sandbox; rerunning
  those four tests with local process access passed.

Status: ready for release pull request.
