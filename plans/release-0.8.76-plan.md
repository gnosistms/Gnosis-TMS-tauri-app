# Release 0.8.76

Date: 2026-07-25

## Contents

- Retry temporarily-unavailable provider errors on the batch path (#201):
  provider 5xx errors ("<name> is temporarily unavailable…") now retry with
  backoff like rate limits, so a brief outage no longer collapses a whole
  AI Translate/Review run into instantly-failing per-row calls. Field case:
  an OpenAI outage window ended Review All runs in seconds with nothing
  applied.
- Surface run failures and reviewed counts in the AI Review closing dialog
  (#201): a failed run now shows a distinct "AI Review stopped" state with
  the provider error, and both stopped and finished states report how many
  of the run's unreviewed translations were actually reviewed — previously
  the dialog showed unconditional success copy even when nothing ran.
- Consolidate the batched row-write commands onto shared helpers (#200):
  behavior-preserving Rust refactor extracting the duplicated
  chapter-context / per-row-edit / commit-epilogue skeleton shared by the
  fields and review batch commands.

## Steps

- [x] Content PRs #200, #201 merged (main at af8e4117), all CI checks green.
- [x] Bump version to 0.8.76 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json).
- [x] Pre-tag verification: npm test (1762 pass), npm run audit:unused
      (clean), cargo fmt check (pre-commit hook), npm run test:rust
      (471 pass).
- [x] Commit "Release 0.8.76" (a29de1f1), tag `v0.8.76`, push main + tag.
- [x] Confirm the release build and updater artifacts publish successfully on
      every platform, and the GitHub Release is published with installers,
      updater bundles + signatures, and latest.json referencing 0.8.76.
      Verified 2026-07-25: run succeeded, release published (not draft) with
      all 13 assets and latest.json at 0.8.76 covering all 7 platform keys.
- [ ] Post-release: happy-path field check of AI Review All once the
      provider outage clears (stacked "Batch review call started." lines,
      reviewed rows applied, honest closing dialog).
