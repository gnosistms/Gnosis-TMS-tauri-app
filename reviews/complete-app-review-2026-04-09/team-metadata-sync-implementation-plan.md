# Team Metadata And Local-First Sync Implementation Plan

## Goal

Make local git repos the only user-facing source of truth for Projects and Glossaries, while adding a shared `team-metadata` repo so repo identity, lifecycle, permanent deletion, and remote reconciliation become unambiguous across clients.

## Core Design

- UI state mirrors only local repos.
- Project and glossary content lives in their own local git repos.
- Remote GitHub sync only changes the UI indirectly by changing local repos through pull/push/relink flows.
- A per-team `team-metadata` repo becomes the authoritative shared registry for:
  - stable UUID identity
  - repo mapping
  - lifecycle state
  - tombstones for permanent deletion

## State Model

Use three independent state axes for each project or glossary record in `team-metadata`.

### Lifecycle State

- `active`
- `softDeleted`
- `purged`

### Remote State

- `pendingCreate`
- `linked`
- `missing`
- `pendingDelete`
- `deleted`

### Record State

- `live`
- `tombstone`

## Team Metadata Repo

Create a shared repo named `team-metadata` when a new org/team is provisioned.

### Repo-Level Data

- `schemaVersion`
- `teamId`
- `installationId`
- `orgLogin`

### Record Layout

- `resources/projects/<uuid>.json`
- `resources/glossaries/<uuid>.json`

Each resource record should include:

- `id`
- `kind`
- `title`
- `repoName`
- `previousRepoNames`
- `githubRepoId`
- `githubNodeId`
- `fullName`
- `defaultBranch`
- `lifecycleState`
- `remoteState`
- `recordState`
- `createdAt`
- `updatedAt`
- `deletedAt`
- `createdBy`
- `updatedBy`
- `deletedBy`

### Glossary-Specific Summary Data

- `sourceLanguage`
- `targetLanguage`

### Project-Specific Summary Data

- lightweight summary data needed by the Projects page without opening the project repo
- for example chapter counts or other display-only summary fields if needed later

## Tombstones

Permanent deletion must not remove metadata records entirely.

Instead, convert the record into a tombstone and keep it indefinitely or for a very long retention window. This is required so stale clients with old local repos can distinguish:

- "this repo should be recreated remotely"
- "this repo was intentionally deleted and must not be recreated"

Minimum tombstone fields:

- `id`
- `kind`
- `repoName`
- `previousRepoNames`
- `githubRepoId`
- `fullName`
- `lifecycleState = purged`
- `remoteState = deleted`
- `recordState = tombstone`
- `deletedAt`
- `deletedBy`
- optional `deletionReason`

## Local Repo Metadata

Each local project/glossary repo should also store lightweight sync identity metadata.

Recommended fields:

- stable resource UUID
- kind
- `hasEverSynced`
- `lastKnownGithubRepoId`
- `lastKnownFullName`
- `lastSuccessfulSyncAt`

Glossaries already have a `glossaryId` in `glossary.json`; extend the local metadata model so sync decisions are not based only on repo name.

## Local-First UI Rules

### Visibility Rules

- Never let broker list membership decide whether a local repo is visible.
- Never hide a valid local glossary or project just because the broker omitted it from a listing.
- Remote failures and remote ambiguity should appear as sync status or warnings, not disappearance.

### Safe Automation Rules

- Local repo with `hasEverSynced = false` and metadata `remoteState = pendingCreate`:
  - create remote in the background
- Previously synced repo missing on remote:
  - do not auto-delete local
  - mark as `remoteState = missing`
  - require explicit resolution or tombstone lookup
- Tombstone match:
  - do not recreate remote
  - offer local archive/delete resolution
- Repo ID match with renamed remote repo:
  - relink local and update metadata

## Refresh And Reconciliation Flow

On refresh:

1. Load `team-metadata`.
2. Load local repos.
3. Reconcile by UUID first and repo name second.
4. Render from local repos.
5. Run sync/relink/recovery in the background.

If local repo exists but no metadata record exists:

- classify as `unregisteredLocal`
- keep it visible with warning
- offer repair/import-to-metadata flow

If metadata says resource exists but local repo is absent:

- clone or rebuild the local repo

If metadata says tombstone and local repo still exists:

- show explicit "permanently deleted remotely" resolution state
- do not recreate the remote repo

## Broker Responsibilities

Broker repo location:

- `/Users/hans/Desktop/gnosis-tms-github-app-broker`

The broker should support:

- creation of the `team-metadata` repo during team/org provisioning
- reading and writing metadata records
- writing tombstones on permanent deletion
- repo lookup by GitHub repo ID and current name

Existing project/glossary repo listing routes should remain available, but they should no longer act as the visibility gate for already-local repos.

## App Responsibilities

Desktop app repo location:

- `/Users/hans/Desktop/GnosisTMS`

The app should:

- render Projects and Glossaries from local repos only
- use `team-metadata` for identity/lifecycle decisions
- treat remote divergence as sync state, not presence/absence state
- stop filtering local glossaries/projects out of the page because remote discovery omitted them

## Cross-Page Implications

This is not only a Glossaries-page and Projects-page change. The same metadata model should be used anywhere the app currently treats `repoName` as identity for projects or glossaries.

### Chapter Glossary And Project References

- chapter-to-glossary links should resolve by stable UUID first, not only by `repoName`
- keep `repoName` as a locator or cache hint, not the true identity
- if a glossary repo is renamed, chapter links should continue to resolve through metadata
- if a glossary is tombstoned, chapter links should surface that state explicitly instead of silently breaking

### Cross-Page Identity Consistency

- anywhere the app currently passes `repoName` as the canonical identity for a project or glossary should move to UUID
- navigation, selection state, action dispatch, and link resolution should use UUID where possible
- repo name should remain mutable display/locator data only

### Delete / Restore / Permanent Delete Semantics

- metadata-driven lifecycle should apply across all screens that touch project/glossary resources
- pages that open, list, link, restore, rename, or permanently delete those resources should all read the same lifecycle/tombstone model
- soft-delete, restore, rename, and permanent-delete flows should not each invent their own interpretation of missing remote state

### Shared Sync / Conflict UI

- resource sync state should be a shared model reused across pages, not a page-specific ad hoc warning
- any screen that surfaces project/glossary state should be able to show:
  - `pendingCreate`
  - `linked`
  - `missing`
  - `pendingDelete`
  - `deleted`
  - `syncError`
  - `unregisteredLocal`

### New-Machine / Bootstrap Flows

- on a new machine, the app should reconstruct the team’s project and glossary resource set from `team-metadata`
- after reconstruction, local clone/sync can materialize the underlying repos
- bootstrap should not have to guess team resources purely from repo names or broker repo-property filtering

## Creation / Import / Delete Flows

### Create Or Import

1. Create the local repo first.
2. Write or import content locally.
3. Create or update the `team-metadata` record.
4. Display immediately from the local repo.
5. Create/link the remote repo and push in the background.

### Soft Delete

1. Update local repo content/state.
2. Update metadata to `lifecycleState = softDeleted`.
3. Keep repo link intact so restore remains possible.

### Permanent Delete

1. Convert metadata record to tombstone first.
2. Delete remote repo.
3. Local clients that still have the repo should see the tombstone state and resolve safely.

## Implementation Order

### Phase 1

- Fix app visibility so Projects and Glossaries no longer filter valid local repos out of the UI because of remote listing gaps.

### Phase 2

- Add local repo sync metadata:
  - UUID
  - `hasEverSynced`
  - last known repo identity

### Phase 3

- Add `team-metadata` repo creation and broker endpoints.

### Phase 4

- Move discovery/reconciliation onto metadata + local UUID model.

### Phase 5

- Add tombstones and permanent-delete handling.

### Phase 6

- Add explicit conflict/sync-resolution UI and admin repair tools.

## Concrete Task Breakdown By Repo

## Desktop App Repo Changes

Repo:

- `/Users/hans/Desktop/GnosisTMS`

### A. Replace Remote-Gated Discovery With Local-First Discovery

1. Change glossary discovery so the visible list always comes from local glossary repos.
2. Keep remote/broker data only as sync metadata and warning state.
3. Remove any code path that intersects local glossaries with the remote glossary repo list to decide visibility.
4. Apply the same rule to Projects for already-known local repos.
5. Preserve visible local items during refresh, background sync, and navigation back from detail screens.

Primary files to inspect:

- [src-ui/app/glossary-repo-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-repo-flow.js)
- [src-ui/app/glossary-discovery-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-discovery-flow.js)
- [src-ui/app/glossary-import-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-import-flow.js)
- [src-ui/app/project-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js)
- [src-ui/app/navigation.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/navigation.js)

### B. Add Local Repo Sync Identity Metadata

1. Define a local metadata file or metadata block for project repos and glossary repos.
2. For glossaries, either:
   - extend `glossary.json`, or
   - add a dedicated metadata file such as `.gnosis-sync.json`
3. For projects, add the same metadata model in the project repo.
4. Persist:
   - stable UUID
   - kind
   - `hasEverSynced`
   - `lastKnownGithubRepoId`
   - `lastKnownFullName`
   - `lastSuccessfulSyncAt`
5. Update local repo creation/import flows to initialize this metadata immediately.
6. Update background sync flows to mark `hasEverSynced = true` only after a successful remote link/push.

Primary files to inspect:

- [src-tauri/src/glossary_storage.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/glossary_storage.rs)
- [src-tauri/src/project_import](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import)
- [src-tauri/src/glossary_repo_sync.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/glossary_repo_sync.rs)
- [src-tauri/src/project_repo_sync.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_repo_sync.rs)

### C. Add Team Metadata Client Model

1. Add JS model/types/helpers for loading `team-metadata` records.
2. Add local state slices for:
   - team metadata load status
   - per-resource sync state
   - tombstone resolution state
3. Add reconciliation helpers:
   - match by UUID first
   - fallback to repo name/history when UUID metadata is missing
4. Add state transitions for:
   - `pendingCreate`
   - `linked`
   - `missing`
   - `pendingDelete`
   - `deleted`
   - `unregisteredLocal`
5. Update cross-page resource references so UUID becomes the primary identity key for:
   - glossary selection
   - chapter glossary links
   - project/glossary navigation and actions

Primary files to add or inspect:

- [src-ui/app/state.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/state.js)
- [src-ui/app/glossary-shared.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-shared.js)
- [src-ui/app/project-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js)
- new metadata-specific app files under `src-ui/app/`

### D. Refactor Create / Import / Delete Flows

1. Create/import should always:
   - create local repo
   - write content locally
   - write metadata record
   - render from local immediately
   - start remote creation/link/push in the background
2. Soft delete should:
   - update local repo content
   - update metadata lifecycle state
3. Permanent delete should:
   - write tombstone to `team-metadata`
   - delete remote repo
   - leave stale local copies visible only as tombstoned/conflict state
4. Rename should:
   - update local repo metadata
   - update metadata record `repoName`
   - append prior name to `previousRepoNames`
   - sync remote rename/relink once supported

Primary files to inspect:

- [src-ui/app/glossary-import-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-import-flow.js)
- [src-ui/app/glossary-lifecycle-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-lifecycle-flow.js)
- [src-ui/app/project-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js)
- [src-ui/app/repo-creation.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/repo-creation.js)

### E. Add Sync Conflict UI

1. Add visible per-resource states instead of hiding resources:
   - `Pending remote create`
   - `Remote missing`
   - `Renamed remotely`
   - `Permanently deleted`
   - `Sync error`
2. Add actions where appropriate:
   - retry remote creation
   - relink
   - archive/delete local copy
   - repair metadata
3. Make sure empty states only appear when there are truly no local resources to show.
4. Reuse the same sync/conflict model anywhere project/glossary status appears, not only on the main list pages.

Primary files to inspect:

- [src-ui/screens/glossaries.js](/Users/hans/Desktop/GnosisTMS/src-ui/screens/glossaries.js)
- [src-ui/screens/projects.js](/Users/hans/Desktop/GnosisTMS/src-ui/screens/projects.js)
- [src-ui/styles/content.css](/Users/hans/Desktop/GnosisTMS/src-ui/styles/content.css)

## Broker Repo Changes

Repo:

- `/Users/hans/Desktop/gnosis-tms-github-app-broker`

### A. Add Team Metadata Repo Provisioning

1. Extend org/team provisioning flow so `team-metadata` is created automatically for new teams.
2. Initialize the repo with:
   - repo root manifest
   - directory structure for project and glossary records
   - schema version
3. Ensure the repo gets the correct custom property/type if needed.

### B. Add Team Metadata Read/Write Endpoints

1. Add broker handlers for:
   - load team metadata manifest
   - list project metadata records
   - list glossary metadata records
   - load a single record by UUID
   - upsert a project/glossary record
   - convert record to tombstone
2. Decide whether metadata writes happen by:
   - direct file commit helper in the broker repo, or
   - generic git contents API helpers
3. Return enough repo identity data to support relink:
   - repo ID
   - node ID
   - full name
   - default branch

Primary broker files to inspect:

- [src/server.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/server.js)
- [src/glossary-routes.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/glossary-routes.js)
- [src/project-routes.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/project-routes.js)
- [src/glossary-repos.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/glossary-repos.js)
- new metadata route/handler files under `src/`

### C. Add Repo Lookup Helpers

1. Add helper endpoints or internal functions to resolve:
   - repo by GitHub repo ID
   - repo by current full name
   - repo by historical repo name if needed via metadata
2. Keep using repo ID as the preferred remote identity when known.
3. Continue exposing current project/glossary repo listing routes, but stop relying on them as visibility gates in the app.

### D. Support Permanent Deletion Tombstones

1. When a project/glossary is permanently deleted:
   - write/update the metadata tombstone first
   - then delete the remote project/glossary repo
2. Do not delete the metadata record afterward.
3. Ensure broker handlers can still return tombstones to clients.

## Metadata Schema Files

Recommended `team-metadata` repo structure:

```text
team-metadata/
  manifest.json
  resources/
    projects/
      <uuid>.json
    glossaries/
      <uuid>.json
  indexes/
    by-repo-name.json
    by-github-repo-id.json
```

### `manifest.json`

Suggested fields:

- `schemaVersion`
- `teamId`
- `installationId`
- `orgLogin`
- `createdAt`
- `updatedAt`

### Resource Record Shape

Suggested shared fields:

```json
{
  "id": "uuid",
  "kind": "glossary",
  "title": "Gnosis ES-VI",
  "repoName": "gnosis-es-vi-8",
  "previousRepoNames": ["gnosis-es-vi-7"],
  "githubRepoId": 123456789,
  "githubNodeId": "R_kgDO...",
  "fullName": "Ha-An-team/gnosis-es-vi-8",
  "defaultBranch": "main",
  "lifecycleState": "active",
  "remoteState": "linked",
  "recordState": "live",
  "createdAt": "2026-04-09T00:00:00Z",
  "updatedAt": "2026-04-09T00:00:00Z",
  "createdBy": "user-id",
  "updatedBy": "user-id"
}
```

Glossary-specific extension:

```json
{
  "sourceLanguage": { "code": "es", "name": "Spanish" },
  "targetLanguage": { "code": "vi", "name": "Vietnamese" }
}
```

Project-specific extension:

```json
{
  "chapterCount": 12
}
```

### Tombstone Record Shape

```json
{
  "id": "uuid",
  "kind": "glossary",
  "title": "Gnosis ES-VI",
  "repoName": "gnosis-es-vi-8",
  "previousRepoNames": ["gnosis-es-vi-7"],
  "githubRepoId": 123456789,
  "fullName": "Ha-An-team/gnosis-es-vi-8",
  "lifecycleState": "purged",
  "remoteState": "deleted",
  "recordState": "tombstone",
  "deletedAt": "2026-04-09T00:00:00Z",
  "deletedBy": "user-id",
  "deletionReason": "Permanent delete from app"
}
```

## Alpha Reset Assumption

This plan assumes alpha-stage reset is acceptable.

- Do not spend time building migration logic for old repos or old orgs.
- After implementation, delete old alpha data and create a new org/team with the new model from the start.
- Optimize for a correct architecture going forward, not backward compatibility with pre-metadata repos.

Because of that:

- migration tooling is out of scope
- compatibility shims for legacy project/glossary repos should be kept minimal
- if a temporary fallback is needed during implementation, keep it local and short-lived

## Test Cases

### Glossaries

1. Import glossary with no remote collision:
   - local repo created
   - visible immediately
   - metadata written
   - remote created later
2. Import glossary with remote repo-name collision:
   - numbered repo name chosen
   - visible immediately
   - metadata reflects chosen repo name
3. Refresh immediately after successful import:
   - glossary remains visible
   - no empty-state regression
4. Broker list temporarily omits remote glossary:
   - glossary remains visible locally
   - warning shown
5. Remote glossary permanently deleted:
   - tombstone returned
   - local repo not recreated
   - explicit resolution UI shown

### Projects

1. Existing local project remains visible when remote listing fails.
2. Previously synced project whose remote is missing becomes `remote missing`, not silently hidden.
3. Project rename updates metadata and historical repo names.
4. Project repo relinks correctly if remote name changes but repo ID matches.

### Cross-Page Identity And Linking

1. A chapter linked to a glossary continues to resolve after the glossary repo name changes.
2. A chapter linked to a glossary surfaces tombstone/conflict state correctly if that glossary is permanently deleted.
3. Navigation and actions that previously relied on `repoName` still work when UUID is the primary identity.
4. Delete/restore state shown on one page matches the state shown on other pages for the same resource.

### Bootstrap / New Machine

1. In a fresh local install, the app reconstructs available projects and glossaries from `team-metadata`.
2. Local clone/sync after bootstrap materializes the expected repos.
3. Repo-name changes and historical names do not break bootstrap resolution.

### Cross-Client / Long-Gap Cases

1. Old client reconnects after months with stale local repo and live metadata:
   - repo stays visible
   - sync state resolves correctly
2. Old client reconnects after permanent deletion:
   - tombstone prevents remote resurrection
   - user can archive/delete local copy
3. Two clients import/create resources concurrently:
   - UUID identity remains stable
   - metadata records do not collide

### Failure Cases

1. Broker unavailable while local repo exists:
   - UI still shows local resource
   - remote state warning shown
2. GitHub permissions temporarily missing:
   - resource remains visible locally
   - remote state becomes warning/error, not disappearance
3. Metadata repo missing or corrupted:
   - app surfaces metadata warning
   - local repos still visible

## Staged Delivery And Testing Plan

Do not implement this as one large merge. Break it into short phases with a usable checkpoint and test pass after each phase.

### Stage 1: Stop Hiding Valid Local Data

Scope:

- fix Glossaries so refresh/navigation never hides a valid local glossary because broker discovery omitted it
- apply the same principle to Projects where possible for already-local repos
- do not add `team-metadata` yet

Expected outcome:

- local repos remain visible across navigation and refresh
- remote problems show warnings instead of empty-state disappearance

Testing after Stage 1:

- import a glossary, open editor, go back to Glossaries page
- refresh Glossaries page
- restart app and verify local glossary still appears
- verify Projects still load and local project file state still appears
- run:
  - `npm test`
  - `npm run build`
  - `cargo check`

### Stage 2: Add Local Sync Identity Metadata

Scope:

- add local sync metadata to glossary repos and project repos
- persist UUID, `hasEverSynced`, and last-known remote identity
- update create/import flows to initialize this metadata

Expected outcome:

- every newly created/imported local repo has enough identity metadata to classify `pendingCreate` versus `previously synced`

Testing after Stage 2:

- create glossary and inspect local repo metadata file
- import glossary and inspect local repo metadata file
- create project and inspect local repo metadata file
- verify no regression in editor or list-page loading
- run:
  - `npm test`
  - `npm run build`
  - `cargo check`

### Stage 3: Create `team-metadata` Repo For New Teams

Scope:

- extend broker/team provisioning to create `team-metadata`
- initialize manifest and directory layout
- add minimal read endpoint to verify the repo exists and is readable

Expected outcome:

- new org/team setup automatically includes `team-metadata`

Testing after Stage 3:

- create a fresh alpha org/team
- verify `team-metadata` repo exists remotely
- verify manifest file exists and schema is correct
- verify broker can read it
- run broker checks:
  - `node --check` on changed broker files
- run app checks:
  - `npm test`
  - `npm run build`
  - `cargo check`

### Stage 4: Write Metadata Records During Create / Import

Scope:

- when creating/importing a glossary or project:
  - create local repo
  - write local content
  - write metadata record
  - render immediately from local
  - then create/link/push remote in background
- use UUID as the real resource identity in metadata

Expected outcome:

- all newly created/imported alpha data has metadata from birth

Testing after Stage 4:

- create glossary in fresh org/team and inspect metadata record
- import glossary in fresh org/team and inspect metadata record
- create project and inspect metadata record
- refresh app and ensure all resources remain visible
- restart app and ensure all resources remain visible
- run:
  - `npm test`
  - `npm run build`
  - `cargo check`

### Stage 5: Read From Metadata During Discovery / Reconciliation

Scope:

- load `team-metadata` in app discovery
- reconcile local repos against metadata by UUID first
- use metadata for lifecycle and remote-state decisions
- stop using remote repo listing as the visibility gate

Expected outcome:

- local-first UI is backed by explicit shared identity/lifecycle state

Testing after Stage 5:

- refresh after create/import
- rename resource and verify metadata updates
- verify resource remains visible if broker listing is delayed or incomplete
- verify project and glossary pages both still work
- run:
  - `npm test`
  - `npm run build`
  - `cargo check`

### Stage 6: Add Tombstones And Permanent Delete Semantics

Scope:

- permanent delete writes metadata tombstone first
- remote repo is deleted afterward
- stale local copies become visible conflict/tombstone state, not resurrected resources

Expected outcome:

- permanently deleted resources cannot be silently recreated by old local repos

Testing after Stage 6:

- permanently delete glossary and verify tombstone record
- permanently delete project and verify tombstone record
- simulate stale local repo and verify it does not auto-recreate remote
- verify UI shows explicit resolution state
- run:
  - `npm test`
  - `npm run build`
  - `cargo check`

### Stage 7: Add Conflict Resolution UI

Scope:

- add user-facing states for:
  - `pendingCreate`
  - `missing`
  - `deleted`
  - `syncError`
  - `unregisteredLocal`
- add retry/relink/archive/delete-local actions as needed

Expected outcome:

- no silent ambiguity remains in the UI

Testing after Stage 7:

- simulate each state and verify message/action correctness
- verify no page falls back to misleading empty-state copy
- run:
  - `npm test`
  - `npm run build`
  - `cargo check`

## Recommended Implementation Sequence For The Next Thread

1. Stage 1: stop hiding valid local data.
2. Stage 2: add local sync identity metadata.
3. Stage 3: create `team-metadata` for new teams.
4. Stage 4: write metadata records during create/import.
5. Stage 5: read metadata during discovery/reconciliation.
6. Stage 6: add tombstones and permanent-delete handling.
7. Stage 7: add explicit conflict-resolution UI.

## Immediate Risk Notes

- UUID repo names are not required.
- Human-readable repo names can remain, but they must not be treated as stable identity.
- UUID should be the true identity; repo names should be mutable aliases tracked in metadata history.
