# Build-cache cleanup — 2026-10-17

## Request
Free disk space by checking build folders across Gnosis TMS branches and deleting
rebuildable output. Preserve all source, uncommitted work, research data and notes.

## Plan
1. Inventory existing registered and orphaned worktree locations, generated Rust
   target directories, frontend dist directories and Vite caches. Verify no tracked
   source files are included and inspect running executable paths.
2. Remove the verified generated directories. Preserve the running app bundle and
   its ancestor directories; remove other objects, dependencies, incremental data,
   unused bundles, and the separate target-spoken cache. Do not stop the app or
   delete installed dependencies needed by its running frontend server.
3. Compare disk space before/after, check that source/worktree state is preserved,
   and rerun the build-cache guard in dry-run mode.

## Initial findings
- 30 existing checkout locations inspected, including leftover directories whose
  worktree registrations no longer resolve.
- Approximately 19.4 GiB allocated to generated output, mostly the main Rust target
  (16.5 GiB) and target-spoken (2.7 GiB).
- The running app is target/debug/bundle/macos/Gnosis TMS.app (about 202 MiB).
  Preserve that bundle while cleaning its surrounding target directory.
- Machine free space was approximately 13 GiB; the build guard requires 30 GiB.
- Detailed pre-cleanup inventory and status snapshots are in /tmp/gnosis-build-*.

## Cleanup completed
- Removed all inventoried inactive build directories, including target-spoken,
  four frontend dist directories and an orphan Vite cache.
- Cleaned the main Rust target around the running app bundle. Only approximately
  202 MiB of active bundle contents remain; no source files were removed.
- Git verification: all tracked files remain present; worktree status is unchanged
  except for this cleanup note and deletion of the untracked target-spoken cache.

## Free-space limitation
The directory cleanup removed approximately 19.2 GiB of allocated file content,
but immediately available disk space increased only from 13.42 to 13.48 GiB.
No deleted build files are held open by a process. APFS reports 11 purgeable local
Time Machine snapshots, which appear to retain the deleted build blocks. The build
guard still refuses a rebuild because free space remains below 30 GiB.

Requested explicit permission before thinning local snapshots: unlike generated
build output, those restore points also contain historical versions of other files.
No Time Machine snapshots or backup policies have been changed.

## Approved snapshot thinning
User approved thinning local snapshots. tmutil removed the four oldest local
snapshots (2026-10-16 14:51–17:51); seven newer snapshots remain. Available space
increased to 39.2 GiB and the normal build guard now passes. No backup exclusions
or external backup contents were changed.
