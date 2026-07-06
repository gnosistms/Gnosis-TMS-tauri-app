# Release 0.8.57

Patch release after `v0.8.56`. Ships the repo migration system hardening
(#157) — the full follow-up plan from the migration code review, see
`plans/repo-migration-hardening-plan.md`. No new data migration is
introduced: this release does not stamp new commits into team repos and does
not version-gate older clients beyond what 0.8.56 already did.

## Included since 0.8.56

- Chapter settings/glossary/status updaters repair legacy `null`
  `settings`/`linked_glossaries` shapes on read instead of erroring, so
  chapters that reacquire the malformed shape (local commits from pre-0.8.56
  clients pushed after updating) self-heal on the next edit. (#157)
- Corrupt or future-schema `.gtms/repo.json` files surface as a per-repo
  sync error instead of scheduling the 0.8.10 layout rewrite over data the
  app cannot read. User-confirmed discard flows still heal unreadable local
  metadata by adopting a verified-migrated remote. (#157)
- Migration dispatch is driven by a single registry; snapshots, sync, clone,
  and the modal scan all derive from one pending-migrations query. (#157)
- One corrupt `chapter.json` no longer fails every future sync of its repo
  (skip + non-fatal telemetry); a 0.8.10 migration failing mid-rename
  restores the pre-migration worktree instead of wedging the repo; the
  editor-driven and reconcile-driven syncs serialize on a per-repo lock,
  closing an `index.lock` race. (#157)
- The migration clean-verdict cache keys on the backend-served target
  version (`team_repo_migration_target_version`) instead of a hardcoded JS
  constant; "Syncronizing" modal typos fixed. (#157)

## Pre-tag verification

- `npm test` (1580 pass) and `npm run audit:unused` clean.
- `cargo test` (372 pass), clippy `-D warnings` clean, `cargo fmt --check`
  clean.
- Playwright suite green locally (111 pass) and on ubuntu/windows CI for
  the merged PR.

## Steps

1. Bump version in `package.json`, `package-lock.json`,
   `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
   `src-tauri/tauri.conf.json`.
2. Commit "Release 0.8.57", tag `v0.8.57`, push main + tag.
3. Watch `.github/workflows/release-tauri.yml` — every platform job
   (Windows + macOS arm64/x64) must succeed before announcing.
