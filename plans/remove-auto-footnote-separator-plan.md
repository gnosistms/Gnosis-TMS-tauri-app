# Remove Automatic Footnote Separator

## Summary

Stop automatically inserting a separator before collected footnotes in preview
serialization and export payloads. Users can now insert their own `<hr>`
separator manually, so footnote rendering should not add an implicit one.

## Changes

- Keep manual `<hr>` handling unchanged:
  - preview renders user-inserted separators as horizontal rules
  - WordPress serialization emits user-inserted separators as core separator
    blocks
  - text/file fallback behavior for explicit separators stays unchanged
- Remove the automatic WordPress separator block that is inserted only because
  footnotes exist.
- Update tests to assert the footnotes block remains present without an
  implicit separator before it.

## Verification

- Run the focused editor preview unit tests.
- Run standard release verification before tagging.
