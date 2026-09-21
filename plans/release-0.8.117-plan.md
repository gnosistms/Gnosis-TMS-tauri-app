# Release 0.8.117

## Plan

1. Release from remote main after PRs #331 and #332, preserving unrelated local work.
2. Bump package, lockfile, Cargo, Tauri, and bundled notice versions from 0.8.116
   to 0.8.117; add release notes for local project readiness and first-sync fixes.
3. Validate metadata, frontend/workflow tests, production build, and the release
   checklist. Use the recorded Rust/Playwright verification for PR #332 and the
   release workflow's fresh signed native builds.
4. Commit and push the release metadata to main; tag that exact commit v0.8.117.
5. Monitor all three platform builds and verify published release notes, assets,
   and the updater manifest.

## Broker dependency

The Admin project creation fix is already deployed as broker v0.2.2, commit
25dbb8d. Production health was rechecked before this release. No additional
broker push or desktop update is required to enable that permission fix.

## Validation

- All six metadata files agree on 0.8.117; whitespace checks passed.
- `npm test`: 2,202 frontend tests and 23 workflow tests passed.
- `npm run build`: passed (existing large-chunk warning).
- `npm run audit:unused`: reports the same documented pre-existing findings in
  three scripts, app-update browser imports, and one editor-footnotes export.
- Legacy config contains only the public broker URL; tracked-file scanning found
  no private-key or GitHub-token patterns. App authentication remains broker-based.
- Main commit f6f14d02 passed GitHub Quality Check and Browser Tests, covering
  the native/JS checks and Linux/Windows browser suites before this metadata bump.
- Native signed release builds, release notes, and updater assets are verified
  through the tag-triggered Release Tauri App workflow after publication.
