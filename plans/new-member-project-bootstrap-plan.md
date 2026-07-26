# New Member Project Bootstrap Plan

Status: Implemented.

## Goal

Make the first Projects-page load for a newly invited team member converge to
one authoritative, complete snapshot:

- permanently deleted/tombstoned projects do not appear;
- active projects appear with their chapters after their local repos are cloned;
- intermediate metadata and repo-clone work is visibly presented as loading,
  not as a completed project with no files;
- the existing local-first fast path remains available for returning users.

## Reported Symptom

On the first team entry, a newly invited member saw one deleted project and one
real project. Both project cards had no chapters. The page looked finished even
though its initial metadata and project-repo bootstrap had not fully converged.

## Current Load Sequence

`loadProjectSnapshotForTeam()` currently performs these broad phases:

1. Read local project metadata and local project file listings.
2. Start remote installation discovery and team-metadata synchronization.
3. Merge metadata and remote project summaries, defaulting missing chapter
   arrays to `[]`.
4. Publish that merged snapshot with project discovery status `"ready"`.
5. Run resource migration checks.
6. Reconcile/clone active project repos.
7. List project files from disk and publish the final chapter-bearing snapshot.

This creates two correctness/presentation gaps.

### Gap 1: metadata can be read before its sync finishes

`listProjectMetadataRecords()` starts `syncTeamMetadataRepoShared(team)`, but
immediately attempts `list_local_gnosis_project_metadata_records`. If that local
read succeeds, the function returns those records and lets the sync finish in
the background. It does not reread after the sync.

That is useful for a local-first preview, but it is not an authoritative remote
refresh. A readable but stale checkout can therefore supply an obsolete
lifecycle record. During a brand-new clone there is also a narrow window where
the metadata repo path and manifest can be readable while the concurrent clone
or checkout is still completing.

### Gap 2: an incomplete snapshot is marked ready

The metadata/remote merge creates projects with `chapters: []`, publishes them
with discovery status `"ready"`, and only afterward clones/syncs project repos.
The final `refreshProjectFilesFromDisk()` call can correct the chapter arrays,
but until then an expanded project card is indistinguishable from a genuinely
empty project.

If repo reconciliation fails, stalls, is interrupted by navigation, or the app
closes, the incomplete snapshot may also be persisted and become the next
launch's cache seed.

## Design

Keep local-first rendering and authoritative convergence as two explicitly
different stages.

### 1. Separate preview metadata reads from authoritative metadata refresh

In `src-ui/app/team-metadata-flow.js`:

- Keep `listLocalProjectMetadataRecords(team)` as the no-sync local preview.
- Add `refreshProjectMetadataRecords(team)`:
  1. await `syncTeamMetadataRepoShared(team)`;
  2. invoke `list_local_gnosis_project_metadata_records`;
  3. normalize and return the post-sync records.
- Do not duplicate the git pull. The new helper must continue using the shared
  TanStack metadata-sync query so project, glossary, and QA readers can join the
  same in-flight operation.
- Keep `listProjectMetadataRecords()` only for callers that intentionally accept
  local-first freshness, or simplify it after auditing its call sites. Do not
  silently change every metadata caller to block on a pull.

In `src-ui/app/project-discovery-flow.js`:

- Continue using `loadLocalProjectSnapshotForTeam()` for the early preview.
- Use `refreshProjectMetadataRecords(selectedTeam)` in the remote/authoritative
  phase.
- Set `metadataLoaded` only when the post-sync read succeeds.
- If the authoritative metadata refresh fails but local metadata exists, keep
  the local preview visible and surface the existing recoverable refresh state;
  do not call the stale local read authoritative.

This preserves quick first paint while ensuring the snapshot used to reconcile
remote lifecycle state was read after the metadata repo finished syncing.

### 2. Make project file readiness explicit

Add a transient project-summary field such as:

```js
fileLoadState: "loading" | "ready" | "error"
```

Rules:

- A project populated only from metadata/remote identity, with no authoritative
  local project-file listing yet, is `"loading"`.
- A project successfully listed after repo reconciliation is `"ready"`, even
  when its chapter array is genuinely empty.
- A project whose repo sync or file listing ends in an actionable failure is
  `"error"`.
- Deleted/tombstoned projects do not require content-repo cloning. Existing
  soft-deleted project presentation remains unchanged; tombstones remain
  omitted.
- Treat the field as transient unless retaining it in the cache is necessary.
  Never persist `"loading"` as if it were a durable final state. If project
  snapshots continue to be persisted before repo sync completes, strip or
  normalize transient load state during persistence/cache hydration.

Prefer a per-project field over using the page-wide discovery status alone:
project repos are reconciled independently and one repo may finish or fail while
another is still cloning.

### 3. Render loading and failure states honestly

Update the Projects flat-list model/render path:

- In `src-ui/app/projects-list-model.js`, emit a distinct body item for an
  expanded project whose `fileLoadState === "loading"` and which does not yet
  have authoritative chapters.
- In `src-ui/screens/project-list-flat-render.js`, render concise copy such as
  `Loading files…` for that item rather than a blank empty body.
- For `"error"`, reuse the existing repo-sync snapshot/status presentation where
  possible and show that files could not be loaded. Do not claim the project is
  empty.
- Only emit the normal empty body after `fileLoadState === "ready"` with zero
  active and deleted chapters.
- Preserve virtualization item-key stability and height estimates by giving the
  loading/error rows stable project-scoped keys.

The page may show project identities before all repos finish cloning, but it
must not communicate that their file collections are complete.

### 4. Publish and persist snapshots at the right boundaries

In `src-ui/app/project-discovery-flow.js` and `src-ui/app/project-query.js`:

- The post-metadata snapshot may be published for progressive rendering, but
  mark eligible active projects' file state as loading.
- Keep `state.projectsPage.isRefreshing` / page-sync status active through repo
  reconciliation and the final disk listing.
- When repo-sync progress arrives, merge sync status without replacing known
  chapter arrays with `[]`.
- After `refreshProjectFilesFromDisk()`, mark successfully listed projects ready
  and publish/persist the converged snapshot.
- If a listing response is absent for a targeted project, distinguish “repo is
  genuinely empty” from “listing failed or repo is unavailable.” The backend
  currently returns an entry with no chapters for a missing repo, so use the
  repo-sync result/status to make that distinction rather than chapter length.
- Avoid persisting the pre-clone `remoteSnapshot` as the durable project cache
  for first-time users. Persist the local preview only when it contains
  authoritative local listings, and persist the remote result after repo sync
  and final disk refresh.

### 5. Preserve lifecycle and query-cache invariants

- All visible project collection updates must continue through the project query
  publisher/query snapshot path.
- Continue applying project write intents, pending chapter mutations, and local
  hard-delete overlays to every published snapshot.
- Do not let the new authoritative refresh clear an optimistic local rename,
  delete, restore, or chapter operation.
- Keep selected-team/cache-key guards on every async publication.
- Continue excluding deleted/tombstoned resources from project repo sync
  descriptors.

## Expected Files

Primary implementation:

- `src-ui/app/team-metadata-flow.js`
- `src-ui/app/project-discovery-flow.js`
- `src-ui/app/project-query.js`
- `src-ui/app/projects-list-model.js`
- `src-ui/screens/project-list-flat-render.js`

Focused tests:

- `src-ui/app/team-metadata-flow.test.js`
- `src-ui/app/project-query.test.js`
- `src-ui/app/projects-list-model.test.js`
- `src-ui/screens/projects.test.js` or a focused flat-list render test
- project discovery tests should be added in the closest existing test module;
  create `src-ui/app/project-discovery-flow.test.js` only if the orchestration
  cannot be covered cleanly through `project-query.test.js`.

No Rust change should be necessary unless testing proves
`list_local_gtms_project_files` cannot distinguish a successful empty listing
from an unavailable repo using the accompanying repo-sync snapshot.

## Test Plan

### Authoritative metadata sequencing

1. Start a shared metadata sync whose promise remains pending.
2. Make the first local metadata read return a stale deleted/live record set.
3. Resolve the sync and make the second read return the current tombstone and
   active project records.
4. Assert `refreshProjectMetadataRecords()` returns only the post-sync data and
   that concurrent resource readers still share one sync invocation.

### New-member bootstrap

1. Begin with no project cache and no local project repo.
2. Return current metadata plus an active remote project containing chapters in
   its repo.
3. Assert the progressive snapshot renders the project as loading, not as a
   completed empty project.
4. Complete repo reconciliation/clone and return the local chapter listing.
5. Assert the final query/state snapshot contains the chapters, is ready, and is
   the snapshot persisted to cache.

### Deleted project regression

- A post-sync tombstone must not appear even if the pre-sync local metadata read
  contained the project.
- A legitimately soft-deleted record may remain in `deletedProjects` according
  to existing product behavior.
- A permanently deleted/local-hard-deleted project must remain filtered.

### Partial repo-sync outcomes

- One project can become ready while another remains loading.
- A sync error produces a file-load error state, not an empty-file state.
- A genuinely empty cloned repo becomes ready with zero chapters.
- Navigation/team changes discard late metadata, repo-sync, and file-listing
  results.

### Existing invariants

- Cached chapters are not replaced with `[]` by an intermediate remote
  snapshot.
- Pending chapter mutations and project lifecycle write intents survive all
  progressive snapshots.
- Deleted/tombstoned projects are not submitted for content-repo sync.
- Project list virtualization retains stable keys and sensible height
  estimates for loading/error rows.

## Verification

Run focused tests first:

```bash
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/team-metadata-flow.test.js
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/project-query.test.js
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/projects-list-model.test.js
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/screens/projects.test.js
```

Then run:

```bash
npm test
npm run audit:unused
```

Manual verification with a clean installation data directory:

1. Invite a user who has never opened the installation locally.
2. Enter the team and open Projects.
3. Confirm project cards may appear progressively but show `Loading files…`
   while repos clone.
4. Confirm active projects populate chapters without requiring a manual
   refresh.
5. Confirm permanently deleted projects never appear.
6. Confirm a genuinely empty project settles to an empty ready state.
7. Restart the app during initial cloning and confirm the next launch resumes
   without treating cached loading projects as complete empty projects.

## Instrumentation

Add lightweight debug/progress context only through the existing project load
progress channel:

- metadata preview read completed;
- authoritative metadata sync/read completed;
- repo reconciliation started/completed per project;
- final file listing completed per project;
- whether a final snapshot was persisted.

Do not add duplicate Sentry reporting around `invoke()` calls. Existing runtime
telemetry already captures command failures.

## Implementation Verification

- Focused project discovery, query, cache, list-model, and screen tests: passed
  (110 tests).
- Full `npm test`: passed (1,844 tests).
- `npm run audit:unused`: unchanged known baseline failure for
  `scripts/bench-ai-translate.mjs`; no new unused files or exports were reported.

## Non-Goals

- Do not remove legitimately soft-deleted projects from the existing deleted
  projects UI.
- Do not make all metadata reads globally blocking.
- Do not disable project actions merely because background refresh is running.
- Do not add a second visible-state channel outside TanStack Query.
- Do not change glossary or QA list behavior unless extracting a shared
  post-sync metadata-read helper requires a parity-safe mechanical update.
- Do not redesign project repo synchronization or move long-running git work
  onto the IPC call path.
