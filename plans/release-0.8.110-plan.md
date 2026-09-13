# Release 0.8.110

Release the merged project sync rendering improvement from PR #317.

1. Confirm the merged commit and its checks on `main`.
2. Bump package, Tauri, Cargo, lockfile, and notice metadata to 0.8.110.
3. Add release notes for smoother project-page updates.
4. Run version-consistency and focused verification, open and merge a release PR.
5. Tag the release merge commit `v0.8.110` and push it to trigger signed macOS and Windows builds.
6. Verify the release workflow, assets, updater metadata, and published notes.

The tracked broker fallback is an intentionally public, credential-free HTTPS
endpoint and has not changed since v0.8.109; it is safe for this release.
