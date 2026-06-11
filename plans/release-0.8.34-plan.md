# Release 0.8.34

Feature release: the export menu reaches feature-complete per its original
spec. Headline items are the WordPress export and the cross-team chapter
copy, plus the projects-page export button now opening the unified Export
options modal.

## Included since 0.8.33

- #130 — WordPress.com export (export-menu Phase 3): OAuth2 via the broker,
  create-draft / overwrite-with-picker against the wp/v2 proxy, media upload
  with image src rewriting and display sizing, `meta.footnotes` for core
  footnotes, success modal with post links. Includes canonical Gutenberg
  block markup for every text style and inline links carried through every
  file export format.
- #132 — Official "WordPress" spelling in the export success modal.
- #131 — Editor insert-link command.
- #134 — Copy chapter to a Gnosis TMS team (export-menu Phase 4):
  `copy_gtms_chapter_to_team` writes a faithful copy (fresh chapter/row ids,
  assets copied, glossary links stripped) into any writable project —
  including the same team or project — with a chosen file name, syncing the
  destination repo before and after. The projects-page chapter-row export
  button now opens the same Export options modal (file exports get a
  language select outside the editor; clipboard/WordPress options direct
  the user to open the file); the old project-export modal is removed.
- Add files: paste-link tab accepts local file paths; per-keystroke modal
  inputs keep focus.
- Pre-commit hook: staged deletions no longer break the lint file list.

## Release validation focus

First release with WordPress export and the team chapter copy. After the
build publishes:
- WordPress: create + overwrite a post on the live site, reconnect after
  token expiry, Windows end-to-end (open items from the Phase 3 work).
- Team copy: a copy into a team whose repo has never been cloned locally,
  a same-project duplicate, a copy with uploaded images.
- Projects-page export: each file format from a chapter row without opening
  the editor; verify the language select and the XLSX all-languages export.

## Pre-tag verification

- npm test: 1462/1462
- cargo test: 326/326 (Quality Check green on PR #134: clippy strict + fmt)
- npm run audit:unused: clean
- Broker: main committed+pushed, /health 200

## Steps

1. Bump version to 0.8.34 in package.json, src-tauri/Cargo.toml,
   src-tauri/tauri.conf.json; refresh package-lock.json + Cargo.lock.
2. Commit "Release 0.8.34" on main, tag v0.8.34, push main + tag.
3. release-tauri.yml publishes; watch all three publish-tauri matrix jobs
   (macOS aarch64, macOS x86_64, Windows) to completion.
