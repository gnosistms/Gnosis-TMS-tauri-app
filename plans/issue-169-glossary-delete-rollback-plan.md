# Issue 169 finding 3 — glossary delete rollback parity

## Goal

Give glossary term deletion the same pre-commit rollback point and failed-sync
recovery behavior as QA term deletion.

## Plan

1. Capture and return the glossary repository head before committing a term deletion.
2. Reuse the glossary term rollback helper when post-delete sync fails or reports an issue.
3. Add focused backend/frontend regression coverage and run the relevant suites.
4. Check off finding 3 in GitHub issue #169 after verification succeeds.
