# Projects Page Background Word Count Plan

## Goal

Make the Projects page load quickly while still keeping displayed source word counts mostly up to date.

The Projects page is the only visible consumer of source word counts. It should not block first paint by reading every row file in every chapter. It should render cheap project/chapter metadata first, reuse cached counts when available, then refresh counts from rows in the background.

## Current Problem

- `src-ui/app/project-flow.js` calls `primeProjectsLoadingState()`, which clears `state.projects` before replacement local data is ready.
- `src-ui/app/project-discovery-flow.js` then loads local project file listings through `list_local_gtms_project_files`.
- The Tauri command reaches `load_project_chapter_summaries()` in `src-tauri/src/project_import/chapter_editor/shared.rs`.
- `load_project_chapter_summaries()` currently reads each `chapter.json`, then calls `load_editor_rows()` for each chapter and recomputes `sourceWordCounts`.
- That means a Projects page local load performs many small row JSON reads before the local disk version can render.
- `refreshProjectSearchIndex()` is also started early from `project-flow.js`, so search indexing can compete with the local first render.
- The full refresh later does GitHub/team metadata work, repo repair checks, glossary loading, repo sync reconciliation, and another local project file refresh.

## Key Decision

Do not write background word counts into project repo files for the first implementation.

Writing counts into `chapter.json` from a background Projects page task would dirty the project Git repo just because the user opened Projects. Committing those summary updates would create noisy Git history; not committing them would interfere with repo sync/dirty-state logic.

Instead:

- Treat source word counts as Projects-page summary cache data.
- Store refreshed counts in the existing app-level project cache via `saveStoredProjectsForTeam()`.
- Keep project Git repos read-only during the background count refresh.
- If a durable Rust-side cache is needed later, store it outside the project repo root.

## Desired Behavior

1. Projects page first paint uses existing in-memory data or the persisted app-level project cache.
2. Local repo listing reads cheap chapter metadata only.
3. Cached `sourceWordCounts` are merged into cheap local summaries when available.
4. Missing counts do not block page load; the word-count label is simply omitted until counts exist.
5. A background task recomputes counts from row files after the Projects page has rendered.
6. When the background task finishes, Projects updates visible counts if the user is still on the same team/page.
7. Editor/import/write paths do not need fragile add/subtract word-count maintenance for the Projects page to remain correct over time.

## Data Model

Use the existing frontend/app cache as the count cache:

- `src-ui/app/project-cache.js`
- storage key: `gnosis-tms-project-cache`
- existing fields already persist project snapshots and chapter `sourceWordCounts`.

Add optional status metadata only if it is useful for debugging or tests:

- `sourceWordCountsStatus`: `"cached"`, `"refreshing"`, `"ready"`, or `"error"`
- `sourceWordCountsUpdatedAt`: ISO timestamp

These fields should live in the app cache/state, not in `chapter.json`, for the first pass.

`ProjectChapterSummary` can expose these fields to JS if the background command returns them, but repo `chapter.json` should not be modified for cache-only count refreshes.

## Backend Changes

### Cheap Chapter Summary Loading

Update `load_project_chapter_summaries()` in `src-tauri/src/project_import/chapter_editor/shared.rs`:

- Read `chapter.json`.
- Do not call `load_editor_rows()`.
- Return `source_word_counts: BTreeMap::new()` for local summaries loaded through `list_local_gtms_project_files`.
- Continue returning languages, selected source/target codes, lifecycle state, title, and linked glossary from `chapter.json`.

This makes `list_local_gtms_project_files` a cheap directory/chapter metadata scan rather than a row-content scan.

Important test detail:

- Add a Rust test where `rows/` contains invalid JSON, then assert `load_project_chapter_summaries()` still succeeds. That proves the Projects summary path does not read rows.

### Background Count Command

Add a new Tauri command, for example:

- `refresh_gtms_project_source_word_counts`

Register it in:

- `src-tauri/src/project_import.rs`
- `src-tauri/src/lib.rs`

Suggested input:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RefreshProjectSourceWordCountsInput {
    installation_id: i64,
    projects: Vec<LocalProjectFilesDescriptor>,
}
```

Suggested output:

- Reuse `Vec<LocalProjectFilesResponse>`.
- Each returned `ProjectChapterSummary` should include fresh `source_word_counts`.

Implementation outline:

- Resolve each project repo with the same `find_project_repo_path()` logic used by `list_local_gtms_project_files_sync()`.
- For each chapter:
  - read `chapter.json`
  - sanitize languages
  - call `load_editor_rows(rows_path)`
  - compute counts with `build_source_word_counts_from_stored_rows()`
  - build `ProjectChapterSummary` with fresh counts
- Do not write `chapter.json`.
- Do not stage, commit, or push anything.
- Return partial results for projects that load successfully; decide whether one bad project should fail the command or return an error entry before implementing. Prefer whole-command failure for the first pass because existing callers already handle refresh failure.

### Existing Count Helpers

Keep existing count helpers initially:

- `build_source_word_counts_from_stored_rows()`
- `load_source_word_counts()`
- `apply_source_word_count_delta()`

The editor still carries `state.editorChapter.sourceWordCounts`, and several editor persistence paths currently expect count payloads. This plan does not require untangling that behavior in the first pass.

The important boundary is: Projects page correctness should come from the background full recompute, not from trusting every editor operation to maintain counts perfectly forever.

## Frontend Changes

### Preserve Cached First Paint

Use the existing cache helper that is currently not wired into the Projects load path:

- `seedProjectsQueryFromCache()` in `src-ui/app/project-query.js`

Update `src-ui/app/project-flow.js` / `src-ui/app/project-discovery-flow.js` so the user sees cached project data before local repo scanning:

- Do not clear visible project data if it belongs to the same selected team and can be used as first paint.
- If visible state is empty, seed from `loadStoredProjectsForTeam(selectedTeam)` before rendering the loading state.
- Keep `projectsPage.isRefreshing = true` so the UI can show background activity without blanking the list.

### Cheap Local Listing Merge

After `loadLocalProjectSnapshotForTeam()` returns cheap chapter summaries with empty `sourceWordCounts`, merge cached counts into those summaries before applying them to state.

Add a helper in `src-ui/app/project-discovery-flow.js` or a small model module:

- `mergeCachedChapterWordCounts(localSnapshot, cachedSnapshot)`

Rules:

- Match projects by stable `project.id`, falling back to `project.name` only if needed.
- Match chapters by `chapter.id`.
- If the local chapter has no `sourceWordCounts`, copy cached `sourceWordCounts`.
- If the local chapter has `sourceWordCountsStatus`, preserve the more current status from the local/background result.
- Never copy cached chapters that no longer exist in the local listing.

This avoids the cheap local listing wiping counts that were already available in the app cache.

### Background Flow

Add `src-ui/app/project-word-count-flow.js`.

Responsibilities:

- Track one active refresh per team/installation.
- Accept a render function, selected team, target projects, and the same mutation/preservation helpers used by project discovery.
- Invoke `refresh_gtms_project_source_word_counts`.
- Ignore stale results if:
  - `state.selectedTeamId` changed
  - `state.screen !== "projects"`
  - `state.projectSyncVersion` changed since start
- Merge returned chapter summaries into `state.projects` and `state.deletedProjects`.
- Reapply pending chapter mutations after merging.
- Preserve project lifecycle patches/write intents.
- Persist updated Projects state with `persistProjectsForTeam(selectedTeam)`.
- Render if still current.

Suggested state in `src-ui/app/state.js`:

```js
projectsWordCounts: {
  status: "idle" | "refreshing" | "ready" | "error",
  teamId: null,
  startedAt: null,
  error: "",
}
```

Keep this state quiet in the UI. It is mainly useful for tests/debugging.

### When To Start Background Refresh

Start background count refresh after the local project list has painted:

- In `loadTeamProjects()` in `src-ui/app/project-discovery-flow.js`, after applying the local snapshot and calling `render()`, wait one paint, then start word-count refresh without awaiting it.
- Start it even in offline mode if local project repos are available, because the task is local disk work only.
- Do not start it for empty project lists.

Do not block the later remote refresh on word counts.

### Search Index Timing

Move `refreshProjectSearchIndex()` so it does not compete with first local render:

- It is currently launched near the start of `src-ui/app/project-flow.js`.
- Start it after cached/local project data has rendered, or from the same post-paint area that starts the background word-count refresh.
- It should remain fire-and-forget and should not block Projects page rendering.

### Display Behavior

In `src-ui/screens/projects.js`:

- Continue using `resolveChapterSourceWordCount(chapter)`.
- Continue hiding the label when the resolved value is `0`.
- Do not show a noisy "refreshing counts" message on every file.
- Optionally show a subtle page-level debug/status message only if `projectsWordCounts.status === "refreshing"` and the existing status surface has a suitable place.

## Cache Policy

- Cached counts may be briefly stale.
- Background refresh corrects counts when Projects is visited.
- If background refresh fails, keep cached counts and do not clear the Projects page.
- The next Projects visit retries.
- Cheap local listing should never replace cached counts with empty counts unless there truly is no matching cached chapter.

## Migration

No repo migration is required.

For existing users:

- The persisted app project cache may already contain counts from older full summary scans.
- Cheap local listing should reuse those cached counts.
- Any missing counts will appear after the first successful background refresh.

## Tests

### Rust Tests

- `load_project_chapter_summaries()` does not read row files:
  - create a temp project repo/chapter with valid `chapter.json`
  - add invalid JSON under `rows/`
  - assert summary loading succeeds and returns empty `source_word_counts`
- `refresh_gtms_project_source_word_counts` recomputes counts:
  - create temp project repo/chapter with row files
  - assert returned summaries include expected counts
  - assert `chapter.json` is unchanged after the command
- Deleted rows are excluded because `build_source_word_counts_from_stored_rows()` already skips `row.lifecycle.state == "deleted"`.

### JS Tests

- Cached project data renders before local repo listing resolves.
- Cheap local listing does not wipe cached `sourceWordCounts`.
- Background word-count refresh merges updated counts into visible project state.
- Background result is ignored when selected team changes.
- Background result is ignored after navigating away from Projects.
- Failed background refresh sets `projectsWordCounts.status = "error"` but does not clear projects.
- Persisted project cache receives updated counts after a successful refresh.
- Search index refresh is not started before the first cached/local render.

### Regression Checks

- Projects page still shows source word counts once cache/background counts exist.
- Editor still opens chapters normally when counts are missing.
- Imports and row edits do not need to synchronously update cached Projects counts for the page to remain usable.
- Remote refresh still updates project/chapter lists and does not overwrite refreshed counts with empty cheap summaries.

## Implementation Order

1. Change `load_project_chapter_summaries()` to stop loading rows and return empty counts.
2. Add focused Rust coverage proving summary loading ignores row files.
3. Add backend `refresh_gtms_project_source_word_counts` that computes counts from rows and returns listings without writing repo files.
4. Add focused Rust coverage for the refresh command and "does not modify chapter.json."
5. Wire cached first paint using `seedProjectsQueryFromCache()` or equivalent cache seeding.
6. Add cached-count merge logic so cheap local listings preserve existing counts.
7. Add `project-word-count-flow.js` and `state.projectsWordCounts`.
8. Start background count refresh after local Projects render; keep it fire-and-forget.
9. Move/defer `refreshProjectSearchIndex()` until after first cached/local render.
10. Add focused JS tests.
11. Run focused Rust tests, focused Node tests, and `npm run build`.

## Acceptance Criteria

- Projects page first render no longer reads every row file for every chapter.
- Opening Projects does not dirty project Git repos.
- Cached source word counts still appear immediately when available.
- Missing counts refresh in the background.
- Background refresh failure does not block Projects page load.
- Cheap local refreshes do not wipe cached counts.
- The design avoids relying on fragile incremental add/subtract count updates for Projects page correctness.
