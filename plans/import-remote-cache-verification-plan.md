# Import Remote Cache Verification Plan

## Problem

TMX import creates a remote glossary or QA-list repo, then immediately verifies the
remote repo by calling the cached installation resource listing. That listing has a
short stale window, so verification can read the pre-create remote list and falsely
report that the newly created repo is missing. The import then rolls back a valid
create/import sequence.

The import flow also prepares the local repo twice: first before writing TMX data,
then again after metadata exists to attach the GitHub origin remote. For long names
that are shortened on disk, the second prepare can allocate a new sibling folder
instead of reusing the imported checkout, leaving the real imported repo without an
origin remote.

## Scope

- Glossary TMX import verification.
- QA-list TMX import verification, for parity.
- Shared prepared-repo path selection.
- Focused unit tests for stale remote-list handling.

## Plan

1. Keep the safety checks for mismatched remote metadata.
2. Invalidate the installation resource cache before verification lists remote repos,
   so the verifier does not reuse a pre-create snapshot.
3. Also invalidate after successful remote repo creation so later list calls prefer
   fresh data.
4. Add regression tests for glossary and QA-list verification invalidating before
   remote listing.
5. Reuse an existing matching prepared repo before allocating a new shortened folder
   during local repo preparation.
6. Run the focused JS import-flow tests and existing targeted Rust resolver tests.
