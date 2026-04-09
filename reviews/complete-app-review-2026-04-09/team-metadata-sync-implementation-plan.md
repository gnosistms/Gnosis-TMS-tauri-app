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

## Migration Plan

For existing teams:

1. Scan remote project/glossary repos.
2. Scan local project/glossary repos.
3. Create metadata records for known active resources.
4. Mark ambiguous resources for manual review.
5. Do not auto-delete local repos during migration.

Where authoritative deletion history is unavailable, do not invent tombstones. Only create tombstones when there is reliable evidence that the resource was intentionally purged.

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

- Migrate existing orgs.

### Phase 7

- Add explicit conflict/sync-resolution UI and admin repair tools.

## Immediate Risk Notes

- UUID repo names are not required.
- Human-readable repo names can remain, but they must not be treated as stable identity.
- UUID should be the true identity; repo names should be mutable aliases tracked in metadata history.

