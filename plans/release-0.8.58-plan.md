# Release 0.8.58

Patch release after `v0.8.57`. Ships batched AI Translate All and AI Review All
(#158) — the full design is in `plans/ai-batch-translate-review-plan.md`. No new
data migration is introduced.

## Included since 0.8.57

- AI **Translate All** and **AI Review** now send rows in batches of 15 per model
  request instead of one request per row, deduplicating glossary hints and the
  surrounding-row context window once per batch. Single-row AI commands are
  unchanged. (#158)
- New shared frontend modules: `editor-ai-context-window.js` (unified
  assistant/translate/review context builders behind one token-budget pair) and
  `editor-ai-batch-request.js` (chunker, language-pair grouping, per-batch
  glossary dedupe). (#158)
- Translate All and Review All apply batch results per row with staleness
  re-checks and per-row progress, falling back to the single-row path for any
  row missing from a response or when a batch call fails. (#158)
- Pivot-glossary chapters derive one glossary per batch instead of per row. (#158)
- A high-effort multi-agent review of the PR #158 diff surfaced 10 findings, all
  fixed before merge — notably a no-op stale-source guard (mid-flight edits could
  be overwritten), multi-language selection silently disabling batching, a raw
  NUL byte causing a module to read as binary to git, and non-strict-schema
  providers omitting `reviewed` incorrectly flagging clean rows please-check.
  Each fix has a regression test.

## Not included

`feat/batch-derive-glossaries` (batched Derive Glossaries modal + a clear-language
image/footnote/caption fix) is still unmerged, pending manual pivot-glossary
verification — see the branch's own memory note. It ships in a future release
once verified and merged.

## Pre-tag verification

- `npm test` (1605 pass) and `npm run audit:unused` clean (only pre-existing
  vellum entries, matching 0.8.57).
- `cargo test --lib` (383 pass, 1 ignored), clippy `-D warnings` clean,
  `cargo fmt --check` clean.
- PR #158's own test plan notes manual `tauri:dev` smoke testing (Translate All
  with 2+ languages, pivot-glossary chapter) was not done pre-merge; watch for
  early reports on this path post-release.

## Steps

1. Bump version in `package.json`, `package-lock.json`,
   `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
   `src-tauri/tauri.conf.json`.
2. Commit "Release 0.8.58", tag `v0.8.58`, push main + tag.
3. Watch `.github/workflows/release-tauri.yml` — every platform job
   (Windows + macOS arm64/x64) must succeed before announcing.
