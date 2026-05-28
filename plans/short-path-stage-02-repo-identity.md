# Short Path Stage 2: Repo Identity And Local Path Resolution

## Summary

Separate remote repo identity from local checkout folder naming. This stage prepares the app to tolerate short local folder names that do not match GitHub repo names, without changing the in-repo file layout yet.

## Scope

- Update project, glossary, and QA local repo resolution to prefer stable identity over folder names.
- Update repair/rebuild logic so folder-name mismatch is not treated as repo corruption.
- Update local hard-delete and tombstone matching to stay stable across local folder renames.
- Keep legacy folder-name matching only as a fallback.

## Implementation Details

Existing code touchpoints:

- `src-tauri/src/project_repo_paths.rs` currently resolves project repos and tries `repo_root.join(repo_name)` before a full scan in `resolve_project_git_repo_path`; this needs to prefer stable identity before folder name.
- `src-tauri/src/glossary_repo_sync.rs` and `src-tauri/src/glossary_storage/mod.rs` each have private glossary path matching helpers; these should be consolidated or kept behaviorally identical.
- `src-tauri/src/qa_list_repo_sync.rs` and `src-tauri/src/qa_list_storage/mod.rs` duplicate the same QA list path matching pattern; avoid fixing one without the other.
- `src-tauri/src/team_metadata_local/repair.rs` currently emits `repoNameMismatch` when folder name differs from metadata. That issue type should be removed or changed to informational-only after stable identity is confirmed.
- `src-ui/app/local-hard-delete-store.js` already matches by resource id, full name, then repo name; keep that priority and make tests explicit.

Repo identity resolution:

- Resolve local repos in this order:
  - resource id from team metadata,
  - GitHub repo id when available,
  - GitHub full name,
  - committed `.gtms/repo.json`,
  - `.git/gnosis-sync-state.json`,
  - legacy folder-name match.
- Treat `repoName` and `fullName` as GitHub identity fields.
- Treat `localFolderName` and resolved `repoPath` as local filesystem details.
- Make path helpers return both:
  - resolved local path,
  - identity evidence used for the match.
- Add a shared Rust resolver type that can represent:
  - exact resource-id match,
  - GitHub repo-id match,
  - GitHub full-name match,
  - `.gtms/repo.json` match,
  - local sync-state match,
  - legacy folder-name match.
- Treat multiple matches as a blocking repair issue, not as "pick the first folder from `read_dir`".
- Keep descriptor inputs unchanged for the frontend at this stage: project/glossary/QA descriptors should still include `repoName`, `fullName`, and stable ids, but Rust should stop treating `repoName` as the desired local folder.

Repair and rebuild:

- Repair scans should not show missing/broken repo warnings when stable identity matches but the folder name differs from `repoName`.
- Repair messages should name:
  - GitHub repo identity,
  - local checkout path,
  - reason repair is needed.
- Rebuild local repo actions should allocate short local checkout folders, but still associate them with the existing GitHub repo identity.

Local hard-delete:

- Tombstones should match by stable resource id and GitHub full name first.
- `repoName` matching remains a legacy fallback only.
- Local purge should not depend on the old folder name to keep a deleted item hidden.

Frontend assumptions to remove:

- Project, glossary, and QA UI flows should not infer repo identity from local folder display names.
- Status and error copy should avoid implying the local folder name must equal the GitHub repo name.

## Existing-Code Risks

- The project resolver currently checks the `repoName` folder first. If a stale folder with the old repo name exists beside a newer short folder, the app could open the wrong repo unless stable-id matching happens before direct folder matching.
- Glossary and QA list code have duplicated path helpers in both sync modules and storage modules. A partial update would let list/sync find one folder while editor/import/delete commands operate on another.
- `team_metadata_local/repair.rs` currently uses folder name and previous repo names as match candidates. After short local names, these must be fallback-only, otherwise repair may bind a short folder to the wrong metadata record.
- `maybe_repair_sync_state` currently compares `current_repo_name` to `expected_repo_name`; that should remain a GitHub repo identity update, not a reason to rename the local folder.
- Local hard-delete tombstones include `repoName`; if repoName fallback is evaluated before resource id/fullName in new code, folder renames or GitHub renames can unhide deleted resources.
- Status snapshots expose `repoPath` to the frontend. Do not let frontend UI tests start asserting that `repoPath` basename equals `repoName`.

## Tests

- Existing repo with old `repoName` folder is still found.
- Repo in short local folder is found by stable identity.
- Two local folders with similar names do not collide when GitHub identity differs.
- Repair UI does not warn for a valid repo whose local folder name differs from `repoName`.
- Local hard-delete tombstones continue hiding the intended repo after local folder rename.
- Project, glossary, and QA storage commands all resolve the same short local folder as their matching sync commands.
- Duplicate local matches return a blocking ambiguity error.
- A stale `repoName` folder is ignored when another repo matches the requested stable resource id.

## Acceptance Criteria

- Stable repo identity is the normal path for local repo lookup.
- Folder-name matching remains available only for legacy recovery.
- No in-repo storage layout migration is performed in this stage.
