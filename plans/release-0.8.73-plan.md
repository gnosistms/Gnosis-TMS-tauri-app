# Release 0.8.73

Date: 2026-07-24

## Contents

- SRT subtitle support (#193): import `.srt` files (tolerant of YouTube's
  auto-caption format; rolling-caption files collapse to one row per spoken
  line with a merge notice), provenance-gated SRT export with per-language
  timing fallback, editable start/end timing inputs above each language in
  the editor, render-time timing validation (under-250 ms cues — empty rows
  exempt — and overlap pairs marked on the inputs at fault), a "Has timing
  error" row filter, and neighbor-fitted auto-timing for manually inserted
  rows.
- Chapter hard-delete tombstones match by id only (#194): re-importing a
  same-titled file no longer resurrects a locally deleted chapter on every
  refresh, and the import flow no longer flickers the file list.
- Kindred-style PDF typography and image size optimization (#195): Alegreya
  all-caps chapter titles and body headings, Great Vibes drop caps via the
  vendored droplet Typst package (offline), Latin-script exports only; WebP
  images re-encode to JPEG q95 and oversized rasters downscale to print
  resolution (real chapter: 24.3 MB → 4.7 MB).
- AI Translate All batches row saves into one git commit per batch response
  (#196): up to 15 rows per commit instead of one commit per row, so bulk
  runs no longer starve interactive saves or trip the false "Local save
  stalled" banner; the batch commit records the AI model and clears
  imported-conflict markers like the per-row save.

## Steps

- [x] Content PRs #193, #194, #195, #196 merged (main at 811f668f).
- [x] Confirm main CI (Quality Check + Browser Tests) green on the merge
      commit before tagging.
- [x] Bump version to 0.8.73 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json).
- [x] Pre-tag verification: npm test (1744 pass), npm run audit:unused
      (clean), cargo fmt check, npm run test:rust (469 pass).
- [ ] Commit "Release 0.8.73", tag `v0.8.73`, push main + tag.
- [ ] Confirm the release build and updater artifacts publish successfully on
      every platform (macOS x86_64, macOS aarch64, Windows x86_64), and the
      GitHub Release is published with installers, updater bundles +
      signatures, and latest.json referencing 0.8.73.
