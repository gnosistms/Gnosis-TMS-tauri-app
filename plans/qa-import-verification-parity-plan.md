# Plan: Strengthen QA import verification parity

## Problem

PR #90 added QA-list team metadata writes, but `verifyImportedQaListState` still
checks less than `verifyImportedGlossaryState`. QA verification accepts a matching
repo name even if the GitHub repo identity or team-metadata identity is stale, and
it does not reject local repo repair issues for the imported QA list.

## Fix

- Mirror glossary's remote `fullName` and `repoId` validation in QA import verify.
- Mirror glossary's team-metadata `fullName` and `githubRepoId` validation in QA
  import verify.
- Add a QA repair-issue matcher and reject matching issues from
  `inspectAndMigrateLocalRepoBindings`.
- Add regression tests for remote repo id mismatch, metadata repo id mismatch, and
  matching local repair issues.

## Verification

- `npm test`
- `npm run audit:unused`
