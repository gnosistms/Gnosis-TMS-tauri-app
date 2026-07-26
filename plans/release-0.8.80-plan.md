# Release 0.8.80

Date: 2026-07-26

## Contents

- Preserve AI-review state when restoring editor history and keep the editor active
  during restore operations (#215, #217).
- Make Full review judge translation accuracy by meaning rather than source structure,
  while retaining spelling and grammar correction (#216).
- Apply target-language punctuation conventions during AI review (#218).
- Add consistent keyboard interaction, focus trapping, and roving-choice behavior
  across application modals (#219).
- Harden telemetry scrubbing for Sentry breadcrumb wrappers and fine-grained GitHub
  personal access tokens (#43).
- Guard stale development versions and shared Rust build caches, and surface an
  actionable error for disabled development updates (#220).
- Preserve unrelated target fields during caption-only duplicated-image translation
  (#221).
- Publish pending engineering plans and export-modal design concepts (#222).

## Steps

- [x] Content PRs #43 and #215–#222 merged into `main`.
- [x] Confirm Quality Check and Browser Tests are green for all content PRs.
- [x] Bump version to 0.8.80 in package.json, package-lock.json, Cargo.toml,
      Cargo.lock, and tauri.conf.json.
- [x] Run pre-tag verification: JavaScript and workflow tests, JavaScript lint,
      frontend build, Cargo formatting, Rust tests, version consistency, and
      `git diff --check`.
- [ ] Merge the release PR.
- [ ] Tag `v0.8.80` and push the tag.
- [ ] Confirm the release workflow succeeds on macOS arm64, macOS x64, and Windows
      x64, and verify the published GitHub Release assets and updater metadata.
