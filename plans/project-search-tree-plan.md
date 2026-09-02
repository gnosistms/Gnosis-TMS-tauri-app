# Compact Nested-Card Project Search Tree

## Goal

Replace the flat Projects search results with a compact project → chapter → row
tree. Project and chapter counts represent unique matching rows. Projects and
chapters start collapsed; rows are always visible once their chapter is expanded.

## Implementation

- Aggregate global search documents into logical rows in the Rust search command,
  retaining every matching language/source excerpt and returning the complete
  capped result set without pagination.
- Add project/chapter expansion state and compact nested-card rendering using the
  app's existing typography, card primitives, language font stacks, and color
  tokens.
- Move Open to the chapter header. Opening a chapter transfers the Projects query
  to the editor, disables case sensitivity, selects Show all, and clears
  search-dependent replace selections.

## Verification

- Cover row aggregation, counts, deterministic ordering, capped results, tree
  expansion, rendering, and chapter navigation in Rust and frontend tests.
- Run targeted tests followed by the complete frontend unit suite.

## Review hardening

- Keep index rebuilding out of the search command. Search the last usable index
  immediately, report a stale or indexing lifecycle state, and let the frontend
  refresh and automatically retry only when no usable index exists. Record a
  completed refresh so an installation with no searchable documents is a valid
  ready state; a failed refresh must not discard an older usable index.
- Return an explicit success value from chapter navigation. Transfer the Projects
  query to editor search only after the requested chapter is confirmed ready.
- Keep an empty hidden panel for every rendered disclosure so `aria-controls`
  always resolves, while still omitting collapsed chapter and row descendants.
  Cover the native-button disclosure contract and collapsed-panel markup in tests.
