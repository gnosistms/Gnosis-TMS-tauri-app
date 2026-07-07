# Release 0.8.59

Patch release after `v0.8.58`. Ships the batched derived-glossary work and
its follow-ons (#161) — see `plans/batch-derive-glossaries-plan.md` and
`plans/auto-rederive-pivot-glossary-plan.md`. No new data migration is
introduced.

## Included since 0.8.58

- **Batched Derive Glossaries** (#161): the Derive Glossaries modal and
  Translate All's inline derivation share one batched flow — pivot-text
  generation and derivation run in combined AI calls instead of
  O(2·rows·languages) serial requests. Includes the fix for the 2026-07-06
  OOM incident (per-row derived-entry writes were quadratic; state and cache
  now apply once per chunk).
- **Clear Translations clears everything for the language** (#161): footnotes,
  image captions, and images (including uploaded image files, deleted from
  disk and the git index in the same commit with snapshot rollback) are now
  wiped along with the main text.
- **Auto re-derive pivot glossaries** (#161): translating into a linked
  glossary's own source language re-derives the affected rows' derived
  glossary entries — one combined derivation call per Translate All run —
  so highlights recover without a manual Derive Glossaries re-run.
  Deliberately no eager invalidation: read paths already filter stale entries
  by pivot-text comparison (see the design decision recorded in
  `plans/auto-rederive-pivot-glossary-plan.md`).

## Pre-tag verification

- `npm test` (1635 pass) and `npm run audit:unused` clean (only the two
  pre-existing vellum entries).
- `cargo test` (383 pass, 1 ignored), `cargo fmt --check` clean; clippy
  `-D warnings` enforced at pre-push.
- PR #161 CI green on all checks (ubuntu Browser Tests flaked once on two
  scroll-sensitive specs, passed on rerun; Windows passed first try).
- Manual verification on a real pivot-glossary chapter (2026-07-07):
  modal with empty pivot columns, mid-run cancel, Translate All over derived
  rows with stable WebContent memory (OOM re-check), and the
  clear-Spanish → Translate-All-to-Spanish → highlights-recover flow.

## Steps

1. Bump version in `package.json`, `package-lock.json`,
   `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
   `src-tauri/tauri.conf.json`.
2. Commit "Release 0.8.59", tag `v0.8.59`, push main + tag.
3. Watch `.github/workflows/release-tauri.yml` — every platform job
   (Windows + macOS arm64/x64) must succeed before announcing.
