# Release 0.8.120

1. Merge the reviewed Sentry remediation PR after all required quality and Linux/Windows browser checks pass.
2. Keep the version bump separate from implementation commits. Update the six package/Cargo/Tauri/notice metadata files and add release notes.
3. Verify version consistency, frontend/workflow tests, production build, and Rust pre-push checks; wait for release-PR CI before merging.
4. Tag the merged release commit `v0.8.120` and publish signed macOS Apple Silicon, macOS Intel, and Windows artifacts through the existing release workflow.
5. Verify workflow success, release notes, all expected installers/signatures, updater platform entries, and tag ancestry. Record the published version in the Sentry action plan.
6. Resolve issue 39 in the actual published Sentry release after checking for recurrence. Keep 37/38 open with precise evidence and remaining reproduction requirements.

## Prior implementation verification

See [the action plan](sentry-37-38-39-action-plan.md) for reproduction evidence and detailed verification. Local checks passed: 705 Rust tests (5 intentionally ignored), strict Clippy/formatting, 2,257 frontend tests, 23 workflow tests, and 10 targeted editor browser tests. JavaScript lint has zero errors and existing warnings only. Production frontend build passes.

Native Windows app smoke testing remains outstanding; browser simulation and platform compilation do not establish native behavior. Historical issues 37/38 lack the category needed to tie all past events to the reproduced defects.
