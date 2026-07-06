# Release 0.8.56

Patch release after `v0.8.55`. Ships the chapter-settings data migration and
cross-team copy glossary parity (#156) — see
`plans/projects-chapter-mutation-flow-plan.md` (audit background) and
`plans/repo-migration-hardening-plan.md` (review follow-ups, none blocking).

## Included since 0.8.55

- Data migration `0.8.56`: chapters with legacy `chapter.json` shapes
  (non-object `settings`/`linked_glossaries` — e.g. `null` written by the
  cross-team copy — and pre-0.8 `glossary_1`/`glossary_2` keys) are
  normalized once per project repo, inline during sync. Fixes "The chapter
  linked glossaries are not a JSON object" when setting a glossary or status
  on affected chapters. Repo sync snapshots force `outOfSync` while the
  migration pends so head-equal repos migrate too. (#156)
- Chapter settings serializers omit absent fields instead of writing `null`,
  so the cross-team copy no longer creates the malformed shape. (#156)
- Copying a chapter to another team now assigns the target team's default
  glossary, exactly like a fresh import, instead of arriving with no
  glossary. (#156)

## Pre-tag verification

- `npm test` (1580 pass) and `npm run audit:unused` clean.
- `cargo test` (366 pass), clippy clean, `cargo fmt --check` clean.
- Playwright suite green on ubuntu/windows CI for the merged PR.

## Steps

1. Bump version in `package.json`, `package-lock.json`,
   `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
   `src-tauri/tauri.conf.json`.
2. Commit "Release 0.8.56", tag `v0.8.56`, push main + tag.
3. Watch `.github/workflows/release-tauri.yml` — every platform job
   (Windows + macOS arm64/x64) must succeed before announcing.
