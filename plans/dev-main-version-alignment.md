# Align the development app with current main

The working development checkout reports 0.8.125 and cannot sync the subtitles
project last saved by 0.8.127. Preserve ongoing local work and repository sync
version protection.

1. Fetch main and audit changes since v0.8.125. Back up affected working files and
   stage three-way reconciliations with current main before modifying sources.
2. Integrate missing main changes, explicitly review overlaps, and synchronize
   all six app version metadata files to main's version after compatibility checks.
3. Run frontend/workflow and native validation, rebuild the development app, and
   verify that the executable version matches main. Preserve the normal launcher.

Status: origin/main fetched successfully; current version is 0.8.127. The personal
launcher intentionally allows stale dev versions; the repository sync guard is
correctly rejecting this older native executable.

## Integration and validation

- Fetched origin/main at a6ebbe18 (0.8.127). Preserved before copies, staged
  reconciliations, and the original working diff at
  `/var/folders/7y/s91dtjqx3xxgy9cqxwghy7ym0000gn/T/gnosis-align-main-101lwg9h/`.
- Applied 122 reviewed updates. Ten overlapping files were explicitly reconciled
  with main; four independently added files were compared before updating.
  All 203 audited release paths pass reverse-patch verification. A separate audit
  of every main application/script/manifest file found no remaining source
  differences (repository guidance excluded); extra local files remain preserved.
- All six version metadata files report 0.8.127. The normal development version
  guard passes. Existing dev watcher rebuilt and restarted target/debug/gnosis-tms;
  the running executable contains 0.8.127 and no 0.8.125 version string.
- Frontend: 2,904 tests passed; workflow: 25 passed; production build passed.
  Native: 855 passed, 8 existing ignored live evaluations. Socket fixture tests
  required execution outside the localhost-restricted sandbox.
- Browser limitation: default bundled Playwright browser is absent. The temporary
  installed-Chrome run reached the editor fixture but stopped at the first test
  (`preview paragraph double-click`): its expected row was undefined before
  accessing `footnotes`. This exact test and application code match main. No
  unrelated fixture changes were made.

Complete: development executable rebuilt and running at 0.8.127, matching main.
The sync version protection remains enabled and the personal launcher is preserved.
