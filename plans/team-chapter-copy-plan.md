# Copy Chapter to Another Team (Export Menu Phase 4)

Implements the last export-menu phase (`plans/editor-export-menu-plan.md`):
the `link:team` option ("Other Gnosis TMS team") in the editor Export options
modal copies the open chapter into a project owned by another team the user
can write to.

## Status (2026-06-11)

- Implemented on `feature/team-chapter-copy` (Rust command + modal pane +
  flow, unit-tested on both sides). Manual verification pending: a real
  cross-team copy where the target repo has never been cloned locally, a
  copy with uploaded images, and a Windows pass.

## Design decisions

- **Faithful copy with fresh IDs.** The copy preserves everything stored in
  the chapter directory — all languages, row content, footnotes, captions,
  text styles, review states, editor comments, soft-deleted rows, uploaded
  image assets — but mints a new `chapter_id` and new `row_id`s (UUID v7) and
  a fresh chapter slug in the target repo. `order_key`s carry over verbatim
  (they are chapter-scoped and already sorted).
- **Strip team-scoped references.** `settings.linked_glossaries` is cleared:
  glossary IDs belong to the source team and would dangle in the target.
  Default source/target languages and workflow status carry over.
- **Uploaded images are copied as asset files** into the new chapter
  directory; row image `path` values are rewritten to the new chapter slug.
  URL images carry over unchanged.
- **Target repo may not exist locally.** The command syncs it first
  (clone-if-missing / pull), then writes + commits, then syncs again to push.
  If the final push fails, the copy is committed locally and the error says
  so (it will sync when the target team is next opened).

## Backend (Rust)

New module `src-tauri/src/project_import/chapter_editor/team_copy.rs`
(child of `chapter_editor` so it can use the `Stored*` chapter/row types).

New command, registered in `lib.rs`:

```rust
copy_gtms_chapter_to_team(app, input: TeamChapterCopyInput, session_token) -> Result<(), String>
```

Mirrors `export_chapter_to_wordpress`: validates input, then
`spawn_blocking` + `catch_unwind`; the IPC call returns immediately and all
progress + the terminal outcome arrive via **`team-chapter-copy-progress`**
events keyed by `jobId` (stages: `preparing` → `copying` → `pushing`;
terminal `success` with `{chapterId, chapterTitle, targetProjectTitle}` or
`error`).

Input carries `jobId`, the source (`installationId`, `projectId`,
`repoName`, `chapterId`), and the target (`installationId` plus the full
`ProjectRepoSyncDescriptor` fields from the project listing record, so the
sync helper can clone/pull/push).

Steps in the worker:

1. Resolve the source repo (`resolve_project_git_repo_path`), find the
   chapter, read `chapter.json` + row files (existing chapter_editor
   loaders).
2. Prepare the target: `load_git_transport_token(target installation)` +
   `sync_project_repo` (raise to `pub(crate)`; currently private to
   `project_repo_sync.rs`) → clone-if-missing/pull. Then the import repo
   preconditions on the target: clean tree, `ensure_local_commit_preconditions`
   (signed-in + write-access gates — same checks content writes get).
3. Write the copy: new slug via `unique_chapter_slug` (raise from
   `pub(super)` in `chapter_import::write_gtms` to `pub(crate)`), rewritten
   `chapter.json` (new id, stripped glossary links), row files with fresh
   `row_id`s, copied asset files with rewritten upload paths.
4. Commit with `git_commit_as_signed_in_user_with_metadata`
   (message `Copy <title> from <source project title>`); on failure unstage
   + remove the written chapter directory (the `write_gtms` cleanup pattern)
   so the target tree stays clean.
5. Push via `sync_project_repo` again (handles non-fast-forward by
   pull + re-push). Push failure → error event that names the
   committed-locally state.

Rust tests (in `team_copy.rs`): copied chapter gets fresh chapter/row ids
with content, languages, comments, review states, soft-deleted rows, and
text styles preserved; glossary links stripped; uploaded asset copied and
its row path rewritten; slug collision gets a unique suffix; commit-failure
cleanup leaves no chapter directory behind.

## Frontend

- `app/editor-export-team-copy-flow.js` (mirrors
  `editor-export-wordpress-flow.js`): owns
  `state.editorChapter.exportModal.teamCopy`
  (`targetTeamId`, `projects`, `projectsStatus`, `targetProjectId`,
  `status`, `stage`, `jobId`, `error`). Team options =
  `state.teams` where `canWriteChapters(team)` (derived capability — no new
  boolean flags) excluding the currently selected team. Selecting a team
  loads its projects via `list_gnosis_projects_for_installation`
  (broker session token), filtered to active records. Submit waits for the
  source repo write queue to go idle, then invokes the command; a
  `team-chapter-copy-progress` listener (registered alongside the WordPress
  listeners) drives stage/terminal state for the matching `jobId`.
- `screens/editor-export-modal.js`: a team-copy pane (team select → project
  select → Export, with stage/progress text and error display), following
  the WordPress pane's conventions; busy state disables Close like other
  exports.
- `app/actions/translate-actions.js` + select change wiring for the two
  dropdowns and submit.
- Flip `link:team` to `available: true` in `editor-export-flow.js`.
- On success, show the standard notice badge and call the projects query
  invalidation for the target team if its query cache is live (no direct
  state writes — the copy appears through the normal TanStack snapshot path
  when that team is viewed).
- JS tests: flow reducers + submit/progress with injected
  `invoke`/`listen`/queue; modal pane renderer states (pickers, busy,
  error, unavailable-when-no-eligible-teams).

## Out of scope

- Copying glossary links or remapping glossaries across teams.
- Bulk/multi-chapter copy (catalog stays additive for it later).
- `copy:docx` clipboard research (tracked in the export-menu plan).
