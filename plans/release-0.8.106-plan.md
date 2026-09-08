# Release 0.8.106

Ship the secondary-action UI cleanup merged in PR #309.

1. Bump npm, Cargo, Tauri, both lockfiles, and bundled-notice versions to 0.8.106.
2. Add release notes describing the simpler WordPress export and search controls.
3. Validate version consistency, open and merge a focused release PR after checks.
4. Push annotated tag v0.8.106 at the merge commit and monitor platform builds.
5. Verify published macOS/Windows packages, signatures, updater metadata, and notes.

Feature validation: 2,124 frontend tests, 23 workflow tests, visual checks, and
all PR #309 CI checks including Linux/Windows browser tests passed. Preserve the
unrelated untracked AI alignment audit plan.
