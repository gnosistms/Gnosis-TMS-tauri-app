# Release 0.8.110

Resume the release preparation paused after PR #317, and include the Sentry and
PDF fixes from PR #318. No v0.8.110 tag or release existed when work resumed.

1. Merge PR #318 after checking CI and confirm both feature merge commits are ancestors.
2. Reapply the prepared 0.8.110 metadata commit on merged main and expand release notes.
3. Verify package, Tauri, Cargo, lockfiles, and bundled notice versions agree.
4. Run focused release verification and merge the release PR after CI.
5. Tag the release merge commit `v0.8.110` and push to trigger signed macOS and Windows builds.
6. Verify all platform jobs, installers, updater metadata/signatures, and published notes.
7. Resolve Sentry search issue 1A in gnosis-tms@0.8.110 after publication succeeds.

The tracked broker fallback is a public, credential-free HTTPS endpoint, unchanged
since v0.8.109. The earlier draft v0.8.107 and unrelated AI audit plan remain outside
this release operation.
