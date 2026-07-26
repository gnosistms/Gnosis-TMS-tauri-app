# Release 0.8.77

Date: 2026-07-25

## Contents

- Keep loading spinners continuous across long-running and re-rendering UI
  flows (#208): centralizes button-spinner continuity and extends coverage
  across project import/transfer, repository layout recovery, row merge,
  connection recovery, and translation/review surfaces.
- Harden project transfer failure handling (#208): improves chapter-copy
  cleanup and error propagation so partial transfer state is not left behind.
- Reduce routine Git commit diagnostic noise (#207): stage events now log
  path counts while failed events retain full path details.

## Steps

- [x] Content PRs #207 and #208 merged; all required CI checks green.
- [x] Bump version to 0.8.77 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json).
- [x] Pre-tag verification: npm test (1832 pass), cargo fmt check (clean),
      npm run test:rust (501 pass, 1 ignored). `npm run audit:unused` reports
      the pre-existing tracked `scripts/bench-ai-translate.mjs`, which is
      already present in v0.8.76 and is unrelated to this release bump.
- [ ] Commit "Release 0.8.77", tag `v0.8.77`, push main + tag.
- [ ] Confirm the release build and updater artifacts publish successfully on
      every platform, and the GitHub Release is published with installers,
      updater bundles + signatures, and latest.json referencing 0.8.77.
