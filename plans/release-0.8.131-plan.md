# Release 0.8.131

The full PR #368 Linux browser suite caught duplicate body saves: adding a direct
blur save alongside the existing deferred dirty-row scan queued the same text
twice. The unpublished v0.8.130 build was cancelled before creating a release.
Keep its existing tag and use a new patch version for the corrected release.

1. Route quote normalization through the existing deferred blur scan. Keep its
   focus checks and use one save path for body, footnote, and caption blur.
2. Verify the earlier-save/newer-focused-draft regression alongside quote blur
   and footnote focus/scroll checks, then run the full frontend/workflow suite.
3. Bump all synchronized release versions to 0.8.131, regenerate notices and
   add release notes. Validate Cargo metadata and the production frontend build.
4. Merge the corrective release PR after required checks, tag the merge commit,
   and verify all signed release jobs, assets, notes, and updater platforms.

Preserve the user's running dev app and unrelated local changes. Publish on
GitHub without installing the application locally.

## Validation

- 2,980 frontend tests and 25 workflow tests pass after the save-path correction.
- Nine focused browser cases pass across two runs, including the exact failing
  earlier-save/newer-focused-draft case, explicit single-save assertions for
  unchanged and edited quote blur, footnotes, captions, and scroll/focus guards.
- Full ESLint reports zero errors and the existing 70 warnings. The unused-code
  audit retains the same three files, five browser imports, and seven exports.
- All release metadata agrees on 0.8.131; regenerated notices change only the
  app version. Locked offline Cargo metadata, the dev version guard, and the
  production frontend build pass.
