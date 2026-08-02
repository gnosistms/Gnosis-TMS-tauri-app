# Release 0.8.81

Date: 2026-08-02

## Contents

- Guard editor window closing so pending saves can finish without leaving the app
  running invisibly (#225).
- Harden Sentry issue handling, including runtime-session recovery, migration error
  classification, telemetry context, and sensitive-data scrubbing (#226).
- Keep the Review tab's Last update focused on text and style changes instead of
  review markers or comment-only commits (#227).
- Let translators reopen referenced empty footnotes by clicking their visible marker,
  while preserving the click across other editor-control dismissals (#228).

## Steps

- [x] Content PRs #225–#228 merged into `main`.
- [x] Confirm Quality Check and Browser Tests are green for all content PRs.
- [x] Bump version to 0.8.81 in package.json, package-lock.json, Cargo.toml,
      Cargo.lock, and tauri.conf.json.
- [x] Run pre-tag verification: JavaScript and workflow tests, JavaScript lint,
      frontend build, Cargo formatting, Rust tests, version consistency, and
      `git diff --check`.
- [x] Merge the release PR.
- [x] Tag `v0.8.81` and push the tag.
- [x] Confirm the release workflow succeeds on macOS arm64, macOS x64, and Windows
      x64, and verify the published GitHub Release assets and updater metadata.

## Verification

- Release PR #229 merged as `7cc8ad7e753b53d0191a61a135491406a57bfcf9`.
- Annotated tag `v0.8.81` points to the release commit.
- Release workflow run 30732714692 succeeded for macOS arm64, macOS x64, and
  Windows x64.
- The stable GitHub Release contains 13 non-empty uploaded assets.
- `latest.json` reports version 0.8.81 with seven signed platform entries, all
  targeting `v0.8.81` assets.
