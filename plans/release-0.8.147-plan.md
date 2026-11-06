# Release 0.8.147

Requested by Hans on 2026-11-06: review the recent History and conflict-resolution
features, fix findings, open and merge a release PR including recent implemented
updates, bump the app version, and publish an update.

## Scope and review

- Include the pending focused conflict dialog, first-click save and scroll fixes,
  shared-base diffs and conservative combinations, independent footnote choices,
  markup inspection, and conflict navigation with draft preservation.
- Include complete History revision grouping, per-entry authors when expanded,
  expanded group indentation and vertical line, and status-only "Text unchanged."
  content using the sans-serif UI font.
- Include the committed Unreview all responsiveness update since 0.8.146.
- Preserve unfinished research/export planning files in the working directory;
  they do not represent implemented release features.

## Steps

1. Review the complete delta against the latest remote main and fix verified
   defects with regressions. Record the review outcome below.
2. Make focused, signed-off commits for the pending app changes. Cut
   `codex/release-0.8.147`, synchronize npm/Tauri/Cargo versions, lockfiles and
   bundled notices, and write `docs/releases/v0.8.147.md`.
3. Run local quality checks and relevant browser tests. Open a release PR against
   main and wait for the complete quality and Linux/Windows browser CI results.
   Fix failures before merging.
4. Merge the PR and push an annotated `v0.8.147` tag at its main merge commit.
   Monitor the signed Apple Silicon, Intel and Windows release builds and notes.
5. Verify published assets, updater signatures and manifest version/platform URLs.
   Merge main back into dev without disturbing unfinished local plans.

## Review findings

- The History current-version comparator omits attribution. An attribution-only
  edit can therefore label an older revision "Current" and disable restoring it.
  Include attribution in the content identity check.
- Migration-aware combining currently rewrites every newline in the other side.
  A newly authored line break could be converted to a paragraph break. Restrict
  that shortcut to edits that leave the original newline structure intact; use
  the ordinary conservative three-way merge otherwise.
- Full browser CI caught a collapsed History group hiding its latest style-change
  note. Keep text comparisons against the previous visible revision, but compare
  revision notes against the actual previous commit, including hidden revisions.
  Add a rendering regression and rerun the existing style-change browser checks.

## Validation and release outcome

- Both review findings fixed, with regressions for attribution identity and
  preserving new verse line breaks during migration-aware combination.
- History updates committed as `6d271810`; conflict review as `cd9ef025`.
- Frontend/workflow tests pass; all nine targeted History/conflict/Unreview all
  and modal keyboard browser checks pass. JavaScript lint has no errors (existing
  repository warnings remain).
- npm, both lockfiles, Tauri, Cargo, and notice metadata synchronized to 0.8.147;
  versioned release notes added. Remaining local/CI validation and publication
  are in progress.
