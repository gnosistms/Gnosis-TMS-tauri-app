# Release 0.8.54

Patch release after `v0.8.53`. Ships the editor scroll ownership redesign
(#153) — see `plans/editor-scroll-ownership-redesign-plan.md`.

## Included since 0.8.53

- Chapter editor: fix scroll jumping when deleting an image (user-reported),
  and remove the structural cause of the recurring scroll-jump bug class.
  Scroll arbitration now has a single owner (`editor-scroll-session.js`):
  programmatic restores from before the user's latest scroll are refused,
  row-scoped edits render as in-place row patches instead of body remounts,
  and the per-call-site viewport snapshot machinery is deleted. (#153)
- Chapter editor: async completions (queued saves, AI translate) can no
  longer snap the viewport back while the user is scrolling. (#153)
- Chapter editor: fix the bottom pin being undone when opening the image
  upload editor at the end of a chapter, and fix a slow row load
  re-opening editing controls after the user clicked elsewhere. (#153)
- Dev/testing: the Playwright editor suite (97 tests, previously not in CI
  and silently broken) is repaired and now runs on Linux and Windows CI;
  fixed a browser-mode persistent-store key prefix mismatch. (#153)

## Pre-tag verification

- `npm test` (1552 pass)
- Browser suite green locally and on ubuntu/windows CI for the merged PR.
- Rust untouched by this release; Rust Quality CI passed on the merge.

## Steps

1. Bump version to 0.8.54 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json).
2. Commit "Release 0.8.54", tag v0.8.54, push main + tag.
3. Let GitHub run release-tauri.yml and publish the release assets.

## Post-release

- Ask the Windows teammate to exercise editor scrolling briefly (OS
  scrollbar drags / wheel input are not covered by CI); the scroll debug
  log at `%AppData%\com.gnosis.tms\logs\editor-scroll-debug.jsonl` has
  diagnostics if anything feels off.
