# Returning project recovery

- Reproduce the upgrade from a clean, older project to an already-migrated server revision with a local Git remote. Exercise a row with an interrupted Git merge and confirm the original index, local commits and untracked edits survive recovery.
- After fetching and checking the remote app version, fast-forward eligible clean project checkouts before running pending content migrations. Preserve the existing migration path when the remote still needs the migration.
- Recover an already-conflicted project inside the app. Prepare and verify the server checkout before switching. Retain the entire original checkout outside the active projects directory, including the Git index and unpublished files. Keep recovery evidence discoverable on later launches. Surface ambiguous edits in the editor where supported.
- Allow the rest of the search index to refresh when a local row cannot be indexed. Retry repaired data and keep database errors visible.
- Exercise the normal background and editor paths, repeat refresh, failure during recovery and the Windows installer delivery. Update the release metadata and notes, run the release checks and verify the published download.
