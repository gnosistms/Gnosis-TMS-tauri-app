# Release 0.8.62

Date: 2026-07-10

## Contents

Reliability fixes for the ten latent repository-resource and sync defects tracked by
issue #169 and merged in PR #172.

- Serialize repository resource mutations and make sync-state writes race-safe.
- Preserve rollback and recovery guarantees across glossary, QA, and migration flows.
- Reject corrupt state and colliding TMX term IDs instead of silently falling back.
- Align glossary and QA edge cases and improve sync error propagation.

## Steps

- [x] Merge PR #172 and close issue #169 through the PR.
- [x] Bump version to 0.8.62 (package.json, Cargo.toml, tauri.conf.json, lockfiles).
- [x] Commit "Release 0.8.62" to main.
- [ ] Tag `v0.8.62` and push to trigger `release-tauri.yml`.
- [ ] Confirm the release build and updater artifacts publish successfully.
