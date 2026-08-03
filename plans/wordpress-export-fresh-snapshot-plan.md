# WordPress Export Fresh Snapshot Plan

## Goal

Prevent WordPress export from serializing stale editor rows after text, marker,
image, or text-style changes.

## Implementation

1. Flush dirty editor fields durably before export.
2. Wait for matching editor operations and repository writes to finish.
3. Reject unresolved stale, conflicted, or pending active rows while allowing
   soft-deleted rows to remain excluded from output.
4. Reload the open chapter from the backend and validate it again.
5. Build the WordPress blocks only from that refreshed snapshot.
6. Add regression tests proving serialization happens after the barriers and
   that a refreshed quote style reaches the WordPress payload.

## Verification

- [x] Focused WordPress export, export dispatcher, and preview tests: 80 passed.
- [x] Complete JavaScript suite on the clean PR branch: 1,883 app tests and 5
  workflow tests passed.
- [x] Targeted JavaScript lint, syntax, and whitespace checks passed.
