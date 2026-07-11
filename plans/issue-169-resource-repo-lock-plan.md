# Issue 169 finding 2 — resource repository locking

## Goal

Serialize glossary and QA-list operations that mutate the same local checkout so
background sync cannot race foreground writes into git index failures or mixed commits.

## Plan

1. Acquire the existing per-repo sync lock around each shared sync-engine mutation.
2. Acquire the same lock around glossary and QA-list foreground mutation entry points.
3. Add structural regression coverage for the lock boundaries and run the Rust suite.
4. Check off finding 2 in GitHub issue #169 after verification succeeds.
