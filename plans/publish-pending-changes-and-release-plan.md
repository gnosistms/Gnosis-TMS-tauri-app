# Publish Pending Changes and Release

## Goal

Publish every local change that is not already represented on `main`, resolve all
open pull requests, and release the next patch version from a clean `main`.

## Inventory

1. Development workflow guards:
   - prevent stale development versions from starting unnoticed;
   - guard shared Rust build caches;
   - make disabled development updates fail with an actionable message;
   - include focused workflow and Rust tests.
2. Duplicated-image caption translation:
   - ensure caption-only AI translation does not overwrite unrelated target fields.
3. Planning and design artifacts:
   - import remote-cache verification plan;
   - Sentry investigation/cleanup plans;
   - export-modal redesign concepts.
4. Existing open pull requests:
   - inspect, validate, and resolve PR #43 rather than leaving an old draft open.

## Steps

1. Create focused clean branches from `origin/main` and copy only the unpublished
   files or hunks into them.
2. Run checks proportional to each branch, commit, push, and open ready PRs.
3. Wait for required GitHub checks and address failures before merging.
4. Resolve every open PR, including the pre-existing draft, with its final state
   documented.
5. From updated `main`, bump all synchronized version files to the next patch,
   add the release plan, run pre-tag verification, and publish the release PR.
6. Merge the release PR, create and push the matching version tag, monitor the
   release workflow, and verify the published GitHub release and updater metadata.
