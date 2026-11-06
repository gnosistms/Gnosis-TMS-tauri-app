# Release 0.8.148

Requested by Hans on 2026-11-06: review the completed History grouping fix,
repair any findings, bump the next version, and publish an update to GitHub.

## Steps

1. Review grouping, actor identity, AI text-change boundaries, expansion state,
   revision rendering, and restore controls. Fix verified issues with regressions.
2. Verify the latest GitHub release and main branch. Make focused signed-off
   commits on `codex/release-0.8.148`, preserving unrelated local planning files.
   Synchronize npm, Tauri, Cargo, lockfiles, bundled notices and release notes.
3. Run frontend/workflow tests, targeted browser tests, lint, build and release
   checks. Open the release PR and fix CI failures before merging into main.
4. Push an annotated release tag at the main merge commit, follow all platform
   builds to completion, and verify published installers and updater metadata.
   Integrate main back into dev while preserving unrelated local work.

## Review findings

- Grouping still uses the displayed author label to distinguish actors. A user
  changing their Git display name splits a contiguous human run even when login
  or email proves it is the same user. Separate actor kind/model from identity.
- A new text-changing AI revision can split a previously merged expanded group
  into an AI group and a human group. Expansion reconciliation retains only the
  first resulting group, hiding older human revisions. Preserve expansion for
  every resulting group containing a previously expanded revision.

## Validation

- Both review findings fixed with regressions; no remaining findings in the
  reviewed grouping, revision rendering and restore paths.
- All 3,532 frontend tests, 26 workflow tests, 127 focused history/sidebar tests,
  and four browser grouping cases pass.
- JavaScript lint passes with existing repository warnings; production frontend
  build and `git diff --check` pass.
- Latest remote main and published release verified as 0.8.147. All six version
  metadata files and versioned release notes now target 0.8.148.
- The unused-code audit reports existing repository findings; no new exports or
  imports were introduced.

Status: reviewed and locally validated; preparing commits and release PR.
