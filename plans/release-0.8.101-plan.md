# Release 0.8.101

Date: 2026-09-05

## Goal

Publish the changes merged since `v0.8.100` as the next stable patch release for
macOS (Apple silicon and Intel) and Windows. Use an isolated checkout and preserve
the user's mixed working tree.

## Included changes

- Keep GitHub login persistence correct across refresh, sign-out, startup, and
  account changes; report real save/delete failures without OS password prompts.
- Improve AI Settings loading, verify keys before team sharing, and lengthen the
  saved-key mask. The broker key-revision fix is already deployed as `0.2.1`.
- Add XLSX format guidance and a downloadable import sample.
- Preserve linked footnotes and images in HTML/Vellum exports.
- Show the persistent update pill and guard update installation.
- Publish Gnosis TMS under GPLv3 and replace the CLA requirement with DCO sign-offs.

## Steps

1. Confirm current main and latest release; bump package, Cargo, Tauri, lockfile,
   and bundled notice versions together to `0.8.101`.
2. Validate the metadata, frontend build, and required checks. Publish a focused
   release PR, wait for CI, and merge its tested commit.
3. Create and push annotated tag `v0.8.101` from the merged release commit to start
   the existing signed release workflow.
4. Confirm all three platform jobs succeed. Verify the published stable release,
   installers, updater archives/signatures, and `latest.json` platform coverage.
   Add concise release notes describing the shipped changes.
5. Keep the local development version metadata in sync without altering the user's
   uncommitted source changes. Report the published release and any remaining issue.

## Initial verification

- Latest stable release: `v0.8.100`.
- Release baseline: `5d04f192` (PR #294 merged).
- PR #294 passed JavaScript, Rust, license, secret, Linux browser, and Windows
  browser CI. Version-only release validation follows on the release branch.
