# Editor Deleted Row Boundaries

## Goal

Make expanded runs of deleted editor rows visually bounded and distinct from
active rows.

## Changes

- Add an `End deleted rows` display item after every expanded deleted-row run.
  It uses the same separator treatment as the opening marker, shows an upward
  chevron, and dispatches the existing group-toggle action.
- Keep the end marker inside the expanded content so collapsed groups render
  only their opening marker.
- Indent the entire shell of every deleted row by one `--page-gutter`, reducing
  its available width rather than padding its text.
- Treat both deleted-group boundary items as compact fixed-height virtual rows.
- Add model, renderer, virtualization, and CSS-source regression coverage.

## Verification

- Focused editor model/renderer/virtualization tests.
- Full `npm test` and unused-export audit.
