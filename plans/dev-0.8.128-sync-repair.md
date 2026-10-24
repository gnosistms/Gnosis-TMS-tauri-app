# Repair the development app's 0.8.128 sync compatibility

The running development app reports 0.8.127, while the subtitles repository was
last saved by 0.8.128. Keep the repository compatibility guard and the personal
launcher's intentional older-version option unchanged.

1. Verify the 24 source/test paths changed by v0.8.128, preserving all local
   work. Exact matches plus the saved pre-sentence-grouping snapshot account for
   every released implementation; lib.rs differs only in import order/formatting.
   The six release metadata changes contain version updates only. A strict reverse
   patch check cannot handle the overlapping, reviewed sentence-grouping changes,
   so inspect those differences explicitly rather than bypassing compatibility.
2. Back up the six current metadata files and update only their app-version
   values from 0.8.127 to 0.8.128. Do not fetch, merge, reset, or alter source code.
3. Validate metadata consistency and the version guard, run existing version
   tests, and verify the existing dev watcher rebuilt/restarted the native app
   with version 0.8.128. Check the served frontend version as well. Do not launch
   a second native instance or initiate repository writes merely to test sync.

Status: complete.

- Audited all 24 release source/test paths and verified the six metadata changes
  are version-only. Preserved all existing source and launcher changes.
- Backed up the six metadata files to
  `/private/tmp/gnosis-version-0.8.128-famdncg8` and verified that the repair
  changes only 0.8.127 to 0.8.128 relative to those backups.
- The existing Tauri watcher rebuilt and restarted the native app. Verified the
  running executable contains 0.8.128 and no 0.8.127. Reloaded Vite configuration
  without changing its contents; the served frontend now reports 0.8.128 too.
- The development version guard passes against release v0.8.128. All 16 existing
  version-guard, metadata-sync, and launcher tests pass with local socket access.
- No compatibility guard, launcher preference, or project repository content was
  changed. No sync was triggered to test repository writes.
