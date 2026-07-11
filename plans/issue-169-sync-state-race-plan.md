# Issue 169 finding 1 — sync-state write race

## Goal

Prevent concurrent updates to a repository's `gnosis-sync-state.json` from
sharing a temp file or losing one another's read-modify-write changes.

## Plan

1. Add per-sync-state serialization around the complete read/merge/write cycle.
2. Give every write a unique sibling temp file before the atomic replacement.
3. Add a concurrent regression test and run the focused Rust test suite.
4. Check off finding 1 in GitHub issue #169 only after verification passes.
