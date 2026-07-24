# Release 0.8.74

Date: 2026-07-24

## Contents

- AI Review All batches row saves into one git commit per batch response
  (#197): a new `apply_gtms_editor_ai_review_results_batch` command applies
  all valid results from one batch AI response (up to 15 rows) in a single
  commit — suggested text/footnote/caption, reviewed and please-check flags,
  AI model in commit metadata, word-count maintenance, and imported-conflict
  clearing, matching the per-row command. Rows missing from the batch
  response or edited mid-flight still fall back to the single-row path,
  which also remains for the individual Review button. Mirrors the #196 fix
  for AI Translate All, so bulk review runs no longer starve interactive
  saves or trip the false "Local save stalled" banner.

## Steps

- [x] Content PR #197 merged (main at ec373ec2).
- [x] Confirm PR CI (Quality Check + Browser Tests, all platforms) green
      before merging.
- [x] Bump version to 0.8.74 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json).
- [x] Pre-tag verification: npm test (1746 pass), npm run audit:unused
      (clean), cargo fmt check, npm run test:rust (469 pass).
- [ ] Commit "Release 0.8.74", tag `v0.8.74`, push main + tag.
- [ ] Confirm the release build and updater artifacts publish successfully on
      every platform (macOS x86_64, macOS aarch64, Windows x86_64), and the
      GitHub Release is published with installers, updater bundles +
      signatures, and latest.json referencing 0.8.74.
