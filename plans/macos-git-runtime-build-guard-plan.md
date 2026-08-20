# macOS Git Runtime Build Guard

Date: 2026-08-20

## Goal

Prevent local or CI macOS release builds from packaging Gnosis TMS without the
bundled Git runtime required for project synchronization.

## Implementation

- Add a platform-aware build guard that validates the macOS Git archive.
- Require the archive to be readable and to contain `libexec/git-core/git`.
- Run the guard from Tauri's existing `beforeBuildCommand` path so direct Tauri
  builds and GitHub release builds receive the same protection.
- Add focused tests for missing, malformed, valid, and non-macOS cases.

## Verification

- [x] Focused guard tests pass.
- [x] The guard rejects the repository's currently missing archive on macOS.
- [x] The guard accepts a representative archive listing.
- [x] JavaScript lint and workflow tests pass.
- [x] Diff checks pass.
