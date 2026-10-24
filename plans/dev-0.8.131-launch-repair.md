# Repair development launch compatibility with v0.8.131

## Changes
1. Back up the affected working files and six version metadata files. Audit the
   v0.8.129 → v0.8.131 release delta without changing Git history or unrelated work.
2. Reconcile the missing deferred blur-save correction in the persistence flow,
   translate wrapper/events, and its browser regression. Verify the complete
   release delta with the launcher's existing reverse-patch compatibility check,
   then run its normal metadata synchronization to v0.8.131.
3. Run version/launcher and editor regressions, build frontend/native code, and
   leave the development server port free for Hans to restart the launcher.

## Diagnosis
Reverse-patch verification succeeds for all release source paths except the
four files containing the v0.8.131 deferred blur-save correction. The current
checkout still performs both an immediate blur save and a scheduled scan. The
released correction defers the explicit language-aware save through the scan.
The compatibility guard remains enabled.

## Validation
- Backup: `/tmp/gnosis-dev-0.8.131-v_ly481l/` (four affected source/test files,
  six metadata files, and the exact released correction patch).
- Applied only the released four-file correction. The full v0.8.129 → v0.8.131
  source delta passes the launcher's reverse-patch verification.
- The normal metadata synchronization completed successfully. All six metadata
  files differ from their backups only by 0.8.129 → 0.8.131. The ordinary guard
  passes on a subsequent run without any repair or override.
- Full frontend suite: 2,994 passed; workflow/launcher suite: 25 passed.
- Six Chrome browser regressions pass, including one durable save on blur,
  unchanged sibling languages, quote attribution, SRT controls, and style filters.
- Frontend production build passes. Scoped whitespace checks pass; scoped ESLint
  has no errors and retains six pre-existing warnings.
- Ports 1431 and 49381 are free; no native app was launched.
- Native development build passes at 0.8.131 (52 seconds). The bundled Typst
  sidecar preparation also passes. Ready for the normal launcher to restart.

