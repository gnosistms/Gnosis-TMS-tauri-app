# Release 0.8.75

Date: 2026-07-25

## Contents

- Parallel AI batches for Translate All and Review All (#198): a shared
  orchestrator runs up to 6 batch AI calls concurrently with a serialized
  apply lane (git writes stay one at a time), language-pair barriers so
  derived-glossary pairs still read the pivot text translated before them,
  and rate-limit-aware batch retries. Benchmarked at ~n× job completion
  (scripts/bench-ai-translate.mjs; n=6: 5.8×) and field-verified on a real
  227-row chapter: 95.9s vs ~7–8 min sequential (~5×). Console logs carry
  per-batch timing (batchIndex/tMs/elapsedMs) for field diagnostics.
- Repair stale uploaded-image paths (#199): a 0.8.75 content migration
  rewrites row image references left pointing at chapter folders the 0.8.10
  layout migration renamed (rows in already-short-named dirs were never
  rewritten). Repos self-heal on next sync; ambiguous references are never
  guessed, only reported.

## Steps

- [x] Content PRs #198, #199 merged (main at d02792f2), all CI checks green.
- [x] Bump version to 0.8.75 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json).
- [x] Pre-tag verification: npm test (1758 pass), npm run audit:unused
      (clean), cargo fmt check, npm run test:rust (471 pass).
- [x] Commit "Release 0.8.75" (9cd95ead), tag `v0.8.75`, push main + tag.
- [x] Confirm the release build and updater artifacts publish successfully on
      every platform (macOS x86_64, macOS aarch64, Windows x86_64), and the
      GitHub Release is published with installers, updater bundles +
      signatures, and latest.json referencing 0.8.75. Verified 2026-07-25:
      run 30145577412 succeeded, release published (not draft) with DMG/zip
      for both macOS targets, exe + msi + sigs for Windows, .sig for every
      updater bundle, and latest.json at 0.8.75 covering all 7 platform keys.
- [ ] Post-release: confirm the image-path migration heals the affected p1
      chapter ("5-práctica-de-interiorización…") on next sync.
