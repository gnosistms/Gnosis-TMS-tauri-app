# Loading Spinner Continuity

Status: implemented; automated verification complete, manual verification pending.

## Problem

Full and scoped UI renders replace modal button DOM. A loading button's CSS spinner
therefore restarts at zero on every progress update, which looks like a recurring
half-second stutter during long operations such as project transfer.

## Approach

- Give loading buttons produced by the shared UI helper a stable key derived from
  their action.
- Register one observer at app startup that incrementally tracks keyed spinners in
  added and removed DOM subtrees.
- Leave unkeyed, hand-authored spinners unchanged rather than deriving identities
  from mutable labels, classes, or DOM positions.
- When a render creates a replacement spinner with the same key, apply a negative
  animation delay matching the elapsed phase of the original spinner and its
  computed CSS animation duration.
- Remove timing state once a loading key is no longer mounted, so a later operation
  starts a fresh animation.
- Cover replacement continuity, existing-node stability, cleanup, incremental
  observer behavior, unkeyed-spinner behavior, and immediate loading-button markup
  with unit tests.

This keeps spinner behavior centralized and avoids modal-specific render workarounds.
