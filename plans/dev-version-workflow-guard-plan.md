# Development Version Workflow Guard

## Problem

The primary development worktree can remain on a feature branch while releases are
cut from separate worktrees. The feature branch then keeps its older
`CARGO_PKG_VERSION`, so repository sync correctly treats it as older than repositories
written by the new release. Debug builds disable the updater, but the install command
currently returns success and leaves the frontend stuck on a restarting modal.

## Plan

1. Add a preflight script for `npm run tauri:dev` that compares the versions declared
   by the current worktree with the newest stable release tag available in the shared
   Git repository.
2. Fail fast with an actionable merge/rebase message when the development version is
   stale. Permit an explicit environment override for intentional old-version testing.
3. Change the debug updater install path to return an actionable error instead of a
   false success.
4. Add focused tests for version parsing/comparison and run the relevant JS and Rust
   checks.

## Scope

- Development startup workflow only; release build behavior is unchanged.
- Updater behavior changes only when updates are compile-time disabled.
- No automatic branch mutation, merge, rebase, fetch, or version bump.
