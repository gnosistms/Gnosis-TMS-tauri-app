# Publish sentence grouping and editor follow-ups

1. Compare the working checkout with current main. Assemble only sentence
   grouping, marker repair, grouped Review/history, and the requested editor
   research-button changes in an isolated managed worktree. Preserve the original
   checkout and exclude unrelated subtitle-alignment fixes, experiments, release
   metadata, native runtime archives, and projects-page changes.
2. Review and validate the isolated patch: frontend tests, browser subtitle and
   Review checks, production build, Rust formatting, strict Clippy and relevant
   native tests. Commit the resulting feature on a codex branch.
3. Push, create and attach the PR, wait for required GitHub checks and address
   failures. Merge the validated head into main and verify the merge result.

Status: complete. PR #364 merged into main at
`d2edb3a6e12fdd85948b42a0b836f0eb1e2c617f`.
https://github.com/gnosistms/Gnosis-TMS-tauri-app/pull/364

The isolated branch passed 2,978 frontend tests, 25 workflow tests, 890 native
tests (11 ignored), all 44 targeted subtitle browser tests, production build,
formatting, and strict Clippy. GitHub Quality Check and Browser Tests passed on
Linux and Windows. Original source snapshots were preserved; unrelated local
changes were excluded. The temporary managed worktree was submitted for archive.
