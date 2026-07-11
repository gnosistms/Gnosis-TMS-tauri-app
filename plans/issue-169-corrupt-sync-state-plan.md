# Issue 169 finding 5 — corrupt sync-state propagation

## Goal

Keep missing sync-state as a valid `None` result while ensuring unreadable or
invalid sync-state files stop repository discovery instead of triggering fallback
matching, repair, or re-cloning behavior.

## Plan

1. Remove every `.ok().flatten()` collapse around `read_local_repo_sync_state`.
2. Make repository match predicates fallible and propagate errors through callers.
3. Add regression coverage proving corrupt state blocks project path discovery.
4. Run backend tests and check off finding 5 after verification.
