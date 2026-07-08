# Release 0.8.60

Patch release after `v0.8.59`. A correctness-and-stability roll-up of the
fixes merged since 0.8.59 — editor edit-safety, sync concurrency, broker
re-auth, Windows path handling, and the #159 audit follow-ups. No new data
migration is introduced.

## Included since 0.8.59

- **Inline-markup style toggles no longer escape stored source** (#162):
  toggling a style over stored markup could HTML-escape the underlying source;
  the toggle now preserves the canonical stored form.
- **Broker re-auth and Windows chapter git paths** (#163): a swallowed broker
  re-authentication error is now surfaced instead of silently failing, and
  chapter git paths recorded on Windows are normalized before comparison.
- **Preserve edits typed during a chapter reload** (#164): text typed while a
  background chapter reload was in flight is no longer dropped when the reload
  resolves.
- **Write intent cleared before success callbacks** (#165): the pending
  write-intent is cleared before success callbacks run, so an immediate
  same-key re-request survives instead of being clobbered.
- **No double concurrent sync jobs** (#166): the sync scheduler uses an atomic
  transition into the SYNCING state, closing the time-of-check/time-of-use
  window that could start two sync jobs at once.
- **Three minor editor correctness fixes from the #159 audit** (#167):
  - comments used a deterministic fetch key, so a pre-save fetch still in
    flight could overwrite a just-saved/just-deleted comment — each fetch now
    gets a unique key and is discarded if stale;
  - history diff ran over raw UTF-16 and split surrogate pairs, rendering
    astral characters (emoji, flags, rare CJK) as U+FFFD — code points are now
    diffed atomically;
  - a style toggle over a same-style element produced redundant double nesting
    — the canonical single-wrap form is now emitted.
- **Crash-classification and stale-store recovery** (#160, JAVASCRIPT-Y):
  recover from a stale store resource id instead of crashing, stop classifying
  non-Error unhandled rejections as fatal, and surface AI batch fallbacks in
  console and telemetry.
- **Test loader migration** (#113): moved the Node test loader off the
  deprecated `--experimental-loader` flag onto `register()`. Test infrastructure
  only; no runtime change.

## Pre-tag verification

- `npm test` (1652 pass) and `npm run audit:unused` clean (only the two
  pre-existing vellum entries).
- `cargo test` clean (exit 0); clippy `-D warnings` enforced at pre-push.
- All included PRs (#160, #162–#167, #113) merged to `main` with CI green.

## Steps

1. Bump version in `package.json`, `package-lock.json`,
   `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
   `src-tauri/tauri.conf.json`.
2. Commit "Release 0.8.60", tag `v0.8.60`, push main + tag.
3. Watch `.github/workflows/release-tauri.yml` — every platform job
   (Windows + macOS arm64/x64) must succeed before announcing.
