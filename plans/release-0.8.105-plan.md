# Release 0.8.105

Ship the approved Add translation alignment changes after v0.8.104.

1. Include only the alignment implementation, its tests/plans, version metadata
   and release notes. Leave the unrelated AI Translate All audit uncommitted.
2. Bump npm, Cargo, Tauri, lockfile and bundled-notice versions to 0.8.105.
3. Commit the feature and version bump on a release branch; open a pull request
   and wait for Rust, JavaScript, license and secret-scan checks.
4. Merge the tested pull request, push annotated tag v0.8.105 at its merge commit,
   and monitor all platform builds and release-note publication.
5. Verify published macOS/Windows assets, updater metadata and release version.

Validation already completed for the feature: 674 Rust library tests, 2,124
frontend tests, 23 workflow tests, strict Clippy and scoped ESLint. Two synthetic
live evaluations passed; 20 Spanish targets split in one provider request.

Status: preparing release.
