# Team Metadata And Local-First Sync Implementation Plan

## Progress Tracker

### Current Status

- current implementation stage: `Stage 8`
- stage status: `implemented and committed in the app repo`
- latest app commit: `ccec3b1` `Label team setup finish-step failures`
- latest broker commit relevant to this plan: `fc2a847` `Diagnose custom property schema failures`
- next intended stage: `no further numbered stage is planned yet`
- active blocker under investigation: new-team setup can still fail on the final finish step while configuring the org-level GitHub custom repository property schema

### Stage 1 Progress

Stage goal:

- stop hiding valid local data
- keep the UI fast and local-first
- prevent remote discovery gaps from replacing visible local resources with empty/error states

Completed in the current local worktree:

- Glossaries now keep local glossary repos visible even when remote glossary discovery omits them.
- Glossary remote-recognition mismatch is surfaced as a warning/notice instead of silently filtering those glossaries out.
- Glossary discovery no longer replaces an already-visible local glossary list with an error card when the later remote step fails.
- Projects now preserve the currently visible cached/local project list when a remote refresh returns an empty remote project list.

Files changed for current Stage 1 work:

- [src-ui/app/glossary-repo-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-repo-flow.js)
- [src-ui/app/glossary-discovery-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-discovery-flow.js)
- [src-ui/app/project-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js)

Verification already completed for current Stage 1 work:

- `npm test`: passed
- `npm run build`: passed
- `cargo check`: passed

Current Stage 1 caveat:

- the Projects-side fallback is intentionally conservative
- it preserves already-visible cached/local project state when a remote refresh comes back empty
- it does not yet introduce true local project identity or full local-first project discovery
- that deeper project model is deferred to `Stage 2`

Recommended resume point if a thread crashes now:

1. Re-test the exact glossary regression manually:
   - import glossary
   - editor opens
   - go back to Glossaries page
   - refresh page
   - restart app
2. If behavior is correct, keep the Stage 1 files as-is; they are already part of the current combined Stage 1 + Stage 2 worktree.
3. Stage 2 local sync identity work is already in the current local worktree; do not redo it before inspecting the new `.git/gnosis-sync-state.json` files.

### Stage 2 Progress

Stage goal:

- add machine-local sync identity metadata to project and glossary repos
- keep that metadata out of tracked content files
- persist enough local state to distinguish unsynced-local repos from previously synced repos later

Completed in the current local worktree:

- Added a shared Rust helper that writes local sync identity metadata to `gnosis-sync-state.json` inside each repo's `.git` directory.
- Glossary create/import flows now initialize local sync metadata with glossary UUID and kind immediately after successful local repo initialization.
- Glossary repo sync now records successful remote linkage with `hasEverSynced`, `lastKnownFullName`, `lastKnownGithubRepoId`, and `lastSuccessfulSyncAt`.
- Project repo clone/sync now records the same local sync identity fields using the shared helper.
- Glossary and project sync descriptors now pass `repoId` through from the JS side so Rust can persist the last-known remote GitHub repo identity locally.

Files changed for current Stage 2 work:

- [src-tauri/src/local_repo_sync_state.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/local_repo_sync_state.rs)
- [src-tauri/src/glossary_storage.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/glossary_storage.rs)
- [src-tauri/src/glossary_repo_sync.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/glossary_repo_sync.rs)
- [src-tauri/src/project_repo_sync.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_repo_sync.rs)
- [src-tauri/src/lib.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/lib.rs)
- [src-ui/app/glossary-repo-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-repo-flow.js)
- [src-ui/app/project-repo-sync-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-repo-sync-flow.js)

Verification already completed for current Stage 2 work:

- `npm test`: passed
- `npm run build`: passed
- `cargo check`: passed

Current Stage 2 caveat:

- the new local sync identity is being written and refreshed, but the UI does not consume it yet for conflict/recovery decisions
- local-first visibility still depends on the Stage 1 guardrails rather than the eventual metadata-driven reconciliation model
- `team-metadata` and local sync-state resolution are still future stages

Recommended resume point if a thread crashes now:

1. Spot-check a freshly created/imported glossary repo and a freshly cloned project repo for `.git/gnosis-sync-state.json`.
2. Commit the current Stage 1 + Stage 2 work together if the local metadata files look correct.
3. Then begin Stage 3 by creating the `team-metadata` repo contract and broker bootstrap flow for new teams.

## Goal

Make local git repos the only user-facing source of truth for Projects and Glossaries, while adding a shared `team-metadata` repo so repo identity, lifecycle, permanent deletion, and remote reconciliation become unambiguous across clients.

Fast UI rule:

- when local repos already exist, first paint must come from local disk immediately
- metadata reads and remote sync must enrich or reconcile that local view afterward in the background
- remote or broker work must not block the initial visible UI for existing local resources

## Core Design

- UI state mirrors only local repos.
- Project and glossary content lives in their own local git repos.
- Remote GitHub sync only changes the UI indirectly by changing local repos through pull/push/relink flows.
- Metadata and remote reconciliation happen after local-first render, not before it.
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

## New Team Setup Flow

When a new team is created or first provisioned for use in the app, the setup flow should explicitly establish the metadata repo before project/glossary work begins.

### Required Order

1. Create or connect the GitHub App team/org installation.
2. Create the `team-metadata` repo immediately.
3. Initialize the repo with:
   - `manifest.json`
   - `resources/projects/`
   - `resources/glossaries/`
   - optional `indexes/`
4. Write the initial manifest contents:
   - `schemaVersion`
   - `teamId`
   - `installationId`
   - `orgLogin`
   - `createdAt`
   - `updatedAt`
5. Verify the broker can read the repo.
6. Verify the broker can write the repo by performing the initial bootstrap commit successfully.
7. Only after those checks succeed should the team be treated as fully ready for project/glossary creation in the app.

### Failure Handling

If team creation succeeds but `team-metadata` setup fails:

- do not silently treat the team as fully usable for projects/glossaries
- place the team into an explicit "team setup incomplete" state
- show a recoverable warning in the app
- allow retry of metadata repo setup
- avoid partial assumptions that cause later project/glossary sync ambiguity

### Team Readiness Rule

A team should be considered ready for project/glossary lifecycle features only when:

- the GitHub App installation exists
- the `team-metadata` repo exists
- the metadata manifest has been initialized
- broker read/write access to that repo is confirmed

This readiness rule applies to lifecycle operations and metadata-backed reconciliation. If local repos already exist on disk, the app should still render them immediately while showing any setup-incomplete warning state in parallel.

### Suggested Verification For New Team Setup

- create a fresh alpha team/org
- verify `team-metadata` repo exists remotely
- verify manifest contents are correct
- verify broker can read metadata repo
- verify broker can write a metadata record to it
- verify the app does not allow project/glossary creation until the setup succeeds

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

## Conflict Resolution And Merge Rules

The plan requires explicit conflict rules for both the shared `team-metadata` repo and project/glossary lifecycle state.

### Metadata Write Model

- store one resource record per file, keyed by UUID
- treat each UUID record file as the primary writable unit
- do not treat indexes as primary writable truth
- derive indexes from the record files whenever possible

### Optimistic Concurrency

Metadata writes should use optimistic concurrency.

Recommended rule:

1. client reads the current metadata record and remembers its base version
2. client computes the intended update from that version
3. client sends the write request with the base version
4. broker rejects the write if the record changed since that base version
5. client reloads the latest record, reapplies its intended action against the new latest version, and retries if still valid

### What "Retry On Conflict" Means

"Retry on conflict" does not mean blindly resubmitting the same payload.

It means:

1. detect stale write attempt
2. reload the newest metadata record
3. recompute the next valid state from the newest record
4. attempt the write again only if that recomputed transition is still valid

Example:

- client A reads glossary record with `repoName = foo`
- client B reads the same record
- client A renames to `bar` and writes successfully
- client B tries to soft-delete using stale `foo` data
- broker rejects client B's stale write
- client B reloads the latest record
- client B reapplies "soft delete this glossary" to the new `repoName = bar` state
- client B retries with the new base version

### Suggested Version Field

Use one of:

- per-record `revision`
- per-record `updatedAt` plus strict compare semantics
- broker-side git blob/commit SHA for the record being updated

Broker-side git commit or blob SHA is preferred if easy to implement cleanly.

### Lifecycle Precedence Rules

Recommended precedence:

- `purged` beats `softDeleted`
- `softDeleted` beats `active`
- tombstone beats any non-terminal update

Practical consequences:

- permanent delete is terminal
- rename is invalid after tombstone
- restore is invalid after tombstone
- content edits are invalid after tombstone
- rename is allowed while live, including when `softDeleted`, only if product wants that behavior explicitly
- if that behavior is undesirable, restrict rename to `active` records only

### Conflict Outcomes

#### Rename vs Rename

- first successful write wins
- second writer reloads latest record
- second writer reapplies rename if still intended and repo name remains available
- if the new desired name collides, auto-suffix according to naming rules

#### Rename vs Soft Delete

- stale write reloads latest record
- apply delete to the latest renamed record
- final state becomes `softDeleted` with the latest `repoName`

#### Restore vs Soft Delete

- last successful valid write wins, subject to base-version retry
- if restore loses race, client reloads and reapplies only if resource is still live and not purged

#### Any Live Update vs Permanent Delete

- permanent delete wins
- stale non-terminal update reloads and then becomes invalid if the record is now tombstoned
- client must surface conflict instead of retrying forever

### Index Update Rules

- indexes such as `by-repo-name.json` and `by-github-repo-id.json` should be treated as derived data
- do not rely on direct concurrent manual edits to index files
- if possible, broker should regenerate or update indexes from the authoritative record files in the same write operation

### Client-Side Conflict Handling

When a conflict cannot be safely auto-resolved:

- keep the local resource visible
- show explicit conflict state
- avoid destructive automatic cleanup
- offer user/admin recovery actions where appropriate

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

1. Load local repos first.
2. Render from local repos immediately.
3. Load `team-metadata` in the background.
4. Reconcile by UUID first and repo name second.
5. Run sync/relink/recovery in the background.

Important rule:

- `team-metadata` is authoritative for identity and lifecycle, but it must not delay first paint when local repos already exist
- persistent cache can help as a warm-start optimization, but local git remains the canonical first-load source

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

### Metadata Write Permissions

The broker must enforce metadata writes with the same permission model used for project/glossary lifecycle actions.

Recommended minimum rules:

- create/import metadata records:
  - require the same permission used to create projects/glossaries
- rename metadata records:
  - require the same permission used to rename projects/glossaries
- soft delete / restore metadata records:
  - require the same permission used to delete/restore projects/glossaries
- permanent delete / tombstone conversion:
  - require the same permission used for permanent deletion in the app

The broker should reject metadata writes that do not meet those permission checks, even if the client UI attempted the action.

## App Responsibilities

Desktop app repo location:

- `/Users/hans/Desktop/GnosisTMS`

The app should:

- render Projects and Glossaries from local repos only
- render immediately from local repos before waiting on metadata or broker reads
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
- this is the main case where no local repos exist yet, so a loading/bootstrap state is acceptable until local repos are materialized

## Creation / Import / Delete Flows

### Create Or Import

1. Create the local repo first.
2. Write or import content locally.
3. Create or update the `team-metadata` record.
4. Display immediately from the local repo.
5. Create/link the remote repo and push in the background.

### Soft Delete

1. Update local repo content/state immediately.
2. Update the UI immediately from that local change.
3. Update metadata to `lifecycleState = softDeleted`.
4. Keep repo link intact so restore remains possible.

### Permanent Delete

1. Update the local UI state immediately so the action feels instant.
2. Convert metadata record to tombstone.
3. Delete remote repo.
4. Local clients that still have the repo should see the tombstone state and resolve safely.

## Partial Failure Rules

Multi-step operations must keep explicit intermediate state instead of assuming every step succeeds.

### Create / Import Partial Failures

If local repo creation/import succeeds but metadata write fails:

- keep the local repo visible
- mark the resource as local-only / metadata-write-failed
- do not hide it from the page
- allow retry of metadata registration

If metadata write succeeds but remote repo creation fails:

- keep the local repo visible
- keep metadata record live with `remoteState = pendingCreate` or `missing`, depending on the failure type
- allow retry of remote creation/link

### Delete Partial Failures

If tombstone write succeeds but remote repo deletion fails:

- keep metadata as tombstoned
- set `remoteState = pendingDelete`
- do not restore the live record automatically
- allow retry of remote deletion

If remote repo deletion succeeds but local stale copies still exist on some clients:

- clients should resolve that through the tombstone state
- do not recreate the remote repo

### Team Setup Partial Failures

If team/org creation succeeds but `team-metadata` setup fails:

- leave the team in `setup incomplete`
- do not allow normal project/glossary lifecycle actions
- allow retry of metadata repo creation/bootstrap
- if local repos already exist, still render them immediately while showing the setup warning

## Repair And Admin Tooling

The first implementation can keep this minimal, but the architecture should assume a small repair surface will exist.

Recommended repair/admin actions:

- retry incomplete team setup
- rebuild metadata indexes from canonical record files
- retry `pendingCreate`
- retry `pendingDelete`
- relink a resource by GitHub repo ID
- register an `unregisteredLocal` repo into metadata

Repair tools should be designed to work from metadata record truth first, local repo second, and remote repo third.

## Implementation Order

### Phase 1

- Fix app visibility so Projects and Glossaries no longer filter valid local repos out of the UI because of remote listing gaps.
- Ensure first paint comes from local repos immediately, with remote sync updates happening afterward.

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
2. Render immediately from local repos without waiting on metadata or broker calls.
3. Keep remote/broker data only as sync metadata and warning state.
4. Remove any code path that intersects local glossaries with the remote glossary repo list to decide visibility.
5. Apply the same rule to Projects for already-known local repos.
6. Preserve visible local items during refresh, background sync, and navigation back from detail screens.

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
6. Ensure metadata loads enrich already-rendered local resources instead of blocking their first display.

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
   - update local repo content immediately
   - update UI immediately from local state
   - update metadata lifecycle state
3. Permanent delete should:
   - update local UI state immediately
   - write tombstone to `team-metadata`
   - delete remote repo
   - leave stale local copies visible only as tombstoned/conflict state
4. Rename should:
   - update local repo metadata immediately
   - update UI immediately from local state
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
   - visible immediately from local repo before remote sync finishes
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
2. Existing local project renders immediately from local data before remote refresh completes.
3. Previously synced project whose remote is missing becomes `remote missing`, not silently hidden.
4. Project rename updates metadata and historical repo names.
5. Project repo relinks correctly if remote name changes but repo ID matches.

### Cross-Page Identity And Linking

1. A chapter linked to a glossary continues to resolve after the glossary repo name changes.
2. A chapter linked to a glossary surfaces tombstone/conflict state correctly if that glossary is permanently deleted.
3. Navigation and actions that previously relied on `repoName` still work when UUID is the primary identity.
4. Delete/restore state shown on one page matches the state shown on other pages for the same resource.

### Bootstrap / New Machine

1. In a fresh local install, the app reconstructs available projects and glossaries from `team-metadata`.
2. Local clone/sync after bootstrap materializes the expected repos.
3. Repo-name changes and historical names do not break bootstrap resolution.
4. Once local repos exist, subsequent launches render immediately from local repos before reconciliation completes.

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
- first paint comes from local repos without waiting for remote/broker work

Testing after Stage 1:

- import a glossary, open editor, go back to Glossaries page
- refresh Glossaries page
- restart app and verify local glossary still appears
- verify the glossary list paints from local data immediately, before remote refresh completes
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
- UI remains fast because newly created/imported resources still render from local repos immediately

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

Status as of April 9, 2026:

- implemented
- app commit: `ce23778` `Add team metadata repo inspection command`
- broker commit: `51f696a` `Bootstrap team metadata repo during org setup`

What is now done:

- new team/org setup creates the `team-metadata` repo automatically
- the repo is initialized with the manifest and required directory structure
- the app verifies setup by checking that the metadata repo is readable before treating team setup as complete

Deployment note:

- the broker commit above was pushed so hosted broker environments can deploy this setup path

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

Status as of April 9, 2026:

- implemented
- app commit: `50bc3db` `Persist team metadata records during repo creation`
- broker commit: `dc54dad` `Add team metadata record routes`

What is now done:

- project create writes metadata records from the start instead of waiting for later discovery
- glossary create/import writes metadata records during creation/import
- optimistic local-first rendering stays in place while metadata and remote repo linkage complete in the background

Deployment note:

- the broker commit above must be deployed for live metadata writes during create/import

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
- local-first optimistic rendering is preserved

Testing after Stage 4:

- create glossary in fresh org/team and inspect metadata record
- import glossary in fresh org/team and inspect metadata record
- create project and inspect metadata record
- refresh app and ensure all resources remain visible
- restart app and ensure all resources remain visible
- verify create/import still render from local immediately before background remote work completes
- run:
  - `npm test`
  - `npm run build`
  - `cargo check`

### Stage 5: Read From Metadata During Discovery / Reconciliation

Status as of April 9, 2026:

- implemented locally
- app commit: `5c34f6d` `Read team metadata during discovery`
- broker commit: `3495771` `Add team metadata read routes`

What is now done:

- broker exposes metadata read routes for projects and glossaries
- Tauri exposes metadata read commands/types
- project discovery reads `team-metadata`, merges metadata with local cache and remote repo data, and stops using remote repo listing as the visibility gate
- glossary discovery reads `team-metadata`, reconciles by UUID first, and can still sync local repos from metadata-backed remote identity
- project/glossary rename and soft delete/restore now best-effort update metadata so discovery stays coherent

Known boundary after Stage 5:

- permanent delete still removes the remote repo directly; tombstone semantics are not implemented yet
- stale local repos are not yet blocked from reappearing via explicit tombstone/conflict state
- those behaviors remain Stage 6 work
- follow-up UX not yet implemented:
  if `/Users/hans/Library/Application Support/com.gnosis.tms/installations` is deleted, discovery can rebuild from GitHub, but the app does not yet show an explicit “local installation data was missing, rebuilding from GitHub” message during recovery

Deployment note:

- Stage 5 requires the broker commit above to be pushed/deployed before the app can use the new metadata read routes live
- that broker commit has already been pushed; deployment is the remaining hosted-environment dependency

Scope:

- load `team-metadata` in app discovery
- reconcile local repos against metadata by UUID first
- use metadata for lifecycle and remote-state decisions
- stop using remote repo listing as the visibility gate

Expected outcome:

- local-first UI is backed by explicit shared identity/lifecycle state
- metadata enrichment does not slow first paint for existing local repos

Testing after Stage 5:

- refresh after create/import
- rename resource and verify metadata updates
- verify resource remains visible if broker listing is delayed or incomplete
- verify project and glossary pages both still work
- verify local-first render still happens before metadata reconciliation completes
- run:
  - `npm test`
  - `npm run build`
  - `cargo check`

### Stage 6: Add Tombstones And Permanent Delete Semantics

Status as of April 9, 2026:

- implemented
- app commit: `360bbfe` `Add tombstones for permanent deletes`

What is now done:

- permanent glossary delete writes a metadata tombstone first, then deletes the remote repo, then purges the local repo
- permanent project delete writes a metadata tombstone first, then deletes the remote repo, then purges the local repo
- if remote permanent delete fails before completion, the app best-effort restores the prior live metadata record instead of leaving a false tombstone behind
- metadata normalization and Tauri input payloads now preserve `deletedAt`
- project/glossary discovery keeps tombstone records visible instead of allowing stale local repos to silently reappear as active resources
- project repo sync skips tombstoned/deleted resources so stale local state does not auto-recreate or re-sync a permanently deleted resource
- deleted project/glossary cards now show a permanent-delete state instead of offering restore/delete actions again

Known boundary after Stage 6:

- Stage 7 conflict-resolution UX is still not implemented
- tombstones are now preserved and surfaced, but there is not yet a richer user-facing recovery flow for other metadata conflict states like `missing` or `syncError`
- follow-up UX not yet implemented:
  if `/Users/hans/Library/Application Support/com.gnosis.tms/installations` is deleted, discovery can rebuild from GitHub, but the app does not yet show an explicit “local installation data was missing, rebuilding from GitHub” message during recovery

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

Status as of April 9, 2026:

- implemented
- app commit: `8066a00` `Add explicit resource conflict states`

What is now done:

- projects and glossaries now show explicit on-card warning/error states for `pendingCreate`, `missing`, `deleted`, `syncError`, and `unregisteredLocal`
- conflict-state rendering is local-first and uses the existing list/card layouts instead of hiding resources behind empty states
- project/glossary lifecycle actions are disabled when the resource is in a terminal or ambiguous metadata state
- project discovery now classifies metadata-backed missing remotes and local unregistered resources explicitly
- glossary discovery now classifies metadata-backed missing remotes and local unregistered resources explicitly
- project/glossary sync no longer auto-retries resources that are already classified as `missing`

Known boundary after Stage 7:

- the app now explains these conflict states, but it still does not offer a dedicated repair/relink workflow from the card itself

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

### Stage 8: Add Missing-Installations Recovery UX

Status as of April 9, 2026:

- implemented
- app commit: `66b2cdf` `Add missing-installations recovery messaging`

What is now done:

- project discovery now recognizes when metadata says recoverable project repos exist but no local project repos are present, and surfaces an explicit rebuild-from-GitHub message
- glossary discovery now recognizes when metadata says recoverable glossary repos exist but no local glossary repos are present, and surfaces an explicit rebuild-from-GitHub message
- both Projects and Glossaries pages now show recovery messaging instead of making the user infer rebuild activity from generic loading or sync badges alone
- the recovery message is shown during the rebuild path and remains visible after the page settles so the user understands what happened

Known boundary after Stage 8:

- the app still does not provide dedicated repair/relink/archive actions from the resource cards themselves
- the next likely follow-up is turning the current warning-only conflict states into actionable repair flows

Scope:

- detect when the local `installations` folder or a per-team local installation repo set is missing
- treat that condition as a rebuild-from-GitHub recovery path, not a generic error
- show explicit recovery messaging while local repos are being recloned or rebuilt
- avoid misleading empty-state copy while recovery is in progress

Expected outcome:

- deleting `/Users/hans/Library/Application Support/com.gnosis.tms/installations` becomes a clear self-healing recovery path for synced data

Testing after Stage 8:

- delete the full `installations` folder while remote repos still exist
- relaunch or refresh the app
- verify the app shows explicit rebuild messaging instead of empty-state copy
- verify projects/glossaries reappear after the background clone/rebuild completes
- run:
  - `npm test`
  - `npm run build`
  - `cargo check`

### Post-Stage 8 Follow-Up Work

Status as of April 10, 2026:

- implemented and committed where noted below

Additional app commits after Stage 8:

- `6f6f636` `Unify resource mutations and glossary sync handling`
- `aaced8c` `Rename final team setup step`
- `ccec3b1` `Label team setup finish-step failures`

Additional broker commits after Stage 8:

- `84540be` `Add glossary metadata delete route`
- `fc2a847` `Diagnose custom property schema failures`

What is now done:

- projects and glossaries now share one top-level optimistic mutation/replay pipeline for rename, soft-delete, and restore
- glossary top-level optimistic mutations now persist and replay after reload the same way project mutations do
- the final team-setup modal heading now says `Finish team setup`
- the final finish-team-setup flow now labels which sub-step failed instead of surfacing an unlabeled raw error
- broker-side diagnostics for the org-level custom-properties schema step now include:
  - the failing finish-step label
  - installation account type
  - installation permission snapshot
  - the raw GitHub response body

Current blocker:

- new-team setup can still fail on the final finish step with a GitHub `404`
- the failing step is not project or glossary repo creation; it is the org-level custom property schema setup call:
  - `PATCH /orgs/{orgLogin}/properties/schema`
- the finish flow currently runs in this order:
  1. inspect installation
  2. configure organization / ensure admins team / ensure `team-metadata`
  3. configure GitHub custom repository property schema
  4. inspect `team-metadata`
- because the team usually appears after cancelling and refreshing, the likely interpretation is:
  - org setup and `team-metadata` creation already succeeded
  - the remaining failure is specifically the custom-properties schema step

What the `gnosis_tms_repo_type` custom property is for:

- property name: `gnosis_tms_repo_type`
- allowed values: `project`, `glossary`
- purpose:
  - mark GitHub repos created by Gnosis TMS
  - distinguish project repos from glossary repos
  - let broker-side repo listing filter the installation’s repos down to Gnosis TMS-managed repos

Immediate next step for the next thread:

- reproduce new-team setup again after the deployed broker includes `fc2a847`
- capture the full new finish-step error text
- determine from that message whether the `404` means:
  - missing GitHub App custom-properties permission
  - org/account context does not support the endpoint for this installation token
  - or some other org-level access condition that GitHub masks as `404`

## Recommended Implementation Sequence For The Next Thread

1. Stage 1: stop hiding valid local data.
2. Stage 2: add local sync identity metadata.
3. Stage 3: create `team-metadata` for new teams.
4. Stage 4: write metadata records during create/import.
5. Stage 5: read metadata during discovery/reconciliation.
6. Stage 6: add tombstones and permanent-delete handling.
7. Stage 7: add explicit conflict-resolution UI.
8. Stage 8: add missing-installations recovery UX.

Throughout all stages:

- preserve the fast local-first UX rule
- if a change risks making metadata or broker work block first paint for existing local repos, revise the design before merging

## Immediate Risk Notes

- UUID repo names are not required.
- Human-readable repo names can remain, but they must not be treated as stable identity.
- UUID should be the true identity; repo names should be mutable aliases tracked in metadata history.
