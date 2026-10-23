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

Status: isolated on codex/srt-sentence-groups from origin/main at 787cb8c3.

- Scoped snapshot: 83 feature files; original working files verified unchanged.
- Local checks pass: 2,978 frontend tests, 25 workflow tests, all 44 subtitle
  browser cases, production build, Rust formatting, strict all-target Clippy,
  and whitespace checks. Unused audit reports three existing scripts, five
  existing unresolved imports, and seven existing exports; no new feature finding.
- Native backend tests and GitHub CI/merge are in progress.
