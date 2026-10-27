# Release 0.8.90

Date: 2026-08-20

## Contents

- Preserve referenced empty footnotes during PDF export.
- Correct Vietnamese drop-cap sizing, placement, and optical spacing, including
  dedicated handling for Ơ and Ư.

## Local update steps

- [x] Bump version to 0.8.90 in package.json, package-lock.json, Cargo.toml,
      Cargo.lock, and tauri.conf.json.
- [x] Run version consistency, frontend, JavaScript/workflow, formatting, and diff
      checks. The release pull request provides the clean full Rust CI run.

## Publishing steps

- [ ] Publish the version bump through a pull request.
- [ ] Merge the pull request into `main`.
- [ ] Tag `v0.8.90`, push the tag, and verify the release workflow and updater
      metadata before offering 0.8.90 as an automatic update.
