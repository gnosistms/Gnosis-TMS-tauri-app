# Release 0.8.55

Patch release after `v0.8.54`. Ships projects-page virtualization with
per-team scroll restore (#154) and the optimistic chapter metadata write
pipeline (#155) — see `plans/projects-page-virtualization-plan.md` and
`plans/projects-chapter-mutation-flow-plan.md`.

## Included since 0.8.54

- Projects page: the file list is virtualized (TanStack Virtual, minimal
  just-in-time window), so teams with very large numbers of files scroll
  smoothly; scrolling was also tuned for macOS WKWebView (edge-only card
  shadows, incremental row patching). Lists under 60 rows keep the plain
  render. (#154)
- Projects page: scroll position is saved locally per team and restored on
  return, anchored to list items so expand/collapse and re-renders don't
  shift the viewport. The saved position is discarded (page opens at the
  top) when a new project appeared since it was saved — created locally or
  arrived from the remote. Expand/collapse toggles keep the clicked header
  stationary. (#154)
- Projects page: setting statuses and glossaries in rapid succession now
  works as fast as the user can click. Both selects share one optimistic
  write pipeline; the optimistic update lands in the same task as the click
  (no transient revert), background renders no longer close an engaged
  dropdown, and the deferred repo sync waits for a team-wide quiet period
  instead of firing mid-burst. (#155)

## Pre-tag verification

- `npm test` (1579 pass) and `npm run audit:unused` clean.
- Playwright suite green locally (111 pass) and on ubuntu/windows CI for
  both merged PRs — includes the new projects-page virtualization, scroll
  restore, and rapid-selection specs.
- Rust untouched by this release; Rust Quality CI passed on both merges.

## Steps

1. Bump version in `package.json`, `package-lock.json`,
   `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
   `src-tauri/tauri.conf.json`.
2. Commit "Release 0.8.55", tag `v0.8.55`, push main + tag.
3. Watch `.github/workflows/release-tauri.yml` — every platform job
   (Windows + macOS arm64/x64) must succeed before announcing.
