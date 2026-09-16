# Release 0.8.112

Release the editor connected-row indicator and AI Assistant composer scroll fixes
from PR #324, after its Linux and Windows browser suites and quality checks pass.

1. Merge PR #324 and prepare the release from updated `origin/main` in a clean worktree.
2. Bump npm, Tauri, Cargo, lockfile, and bundled notice metadata to 0.8.112; add release notes.
3. Verify version consistency and focused release checks; open and merge the release PR after CI.
4. Tag the merged release commit `v0.8.112` and push it to trigger the signed Apple Silicon,
   Intel Mac, and Windows builds.
5. Verify all release jobs, platform assets, updater metadata/signatures, and published notes.

Keep the unrelated AI batch-alignment audit plan in the primary checkout untouched.

## CI follow-up

The first release Windows run exposed a browser-test race: the test read the last
mounted row before virtualization updated, then clicked a different row after the
update. The trace showed row 200 correctly revealed while the assertion expected
row 3. Bind the test to the known final fixture row and wait for it to become
visible; application behavior is unchanged. Recheck repeated local runs and
Linux/Windows CI before tagging.
