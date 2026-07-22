# Release 0.8.67

Date: 2026-07-22

## Contents

Redesigns the chapter export modal with a fixed-width two-pane layout, accessible
app-styled dropdowns, cleaner WordPress.com choices, shared modal/control styling,
and clearer export descriptions. Existing export behavior remains intact, including
remembering the previously exported WordPress post as the overwrite default.

PDF export now defaults to A4 and remembers each signed-in user's latest valid paper
size selection across chapters and app restarts. The PDF font message is shown only
when a font download is required.

## Steps

- [x] Implement and test the export modal redesign and PDF paper-size preference.
- [x] Bump version to 0.8.67 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json).
- [ ] Merge the export modal PR.
- [ ] Tag `v0.8.67` and push to trigger `release-tauri.yml`.
- [ ] Confirm the release build and updater artifacts publish successfully on
      every platform (Windows + macOS arm64/x64) before considering the
      release complete.
