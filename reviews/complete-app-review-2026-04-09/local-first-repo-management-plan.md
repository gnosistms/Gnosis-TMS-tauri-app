# Shared Local-First Repo Management Plan

Status as of April 10, 2026:

- `Stage 9` in progress locally
- implemented so far:
  - local `team-metadata` repo path under each installation
  - team-setup bootstrap for the local `team-metadata` clone
  - local-first metadata reads for projects and glossaries
  - local tombstone lookup primitive in Tauri
  - local metadata upsert/delete + local git commit helpers in Tauri
  - local metadata push helper in Tauri
  - app-side project/glossary metadata writes now commit to the local `team-metadata` repo first and only push best-effort afterward
  - operation tombstone guards now check the local metadata repo by `resourceId` first
  - glossary top-level rename / soft-delete / restore mutations now commit metadata intent locally before running the repo mutation
  - project top-level rename / soft-delete / restore mutations now commit metadata intent locally before running the remote broker mutation
  - glossary manual creation now generates `glossaryId` in the app, commits pending metadata locally first, then initializes the local repo with that supplied ID
  - TMX glossary import now inspects the file first, commits pending metadata locally first, then imports into the local repo with the same supplied `glossaryId`
- not implemented yet:
  - create flows are still not metadata-first end to end
  - some non-queued handlers still mutate the resource repo or remote repo before metadata reconciliation is complete
  - persistent retry tracking for failed metadata pushes is not implemented yet

Goal:

- replace the remaining project/glossary-specific repo lifecycle code with one shared repo-management system that treats the local metadata repo as the first authority for read/write/update operations and lets GitHub reconciliation happen in the background

Core design rules:

1. Every project/glossary operation starts by checking local metadata for a tombstone.
2. If a tombstone exists, purge the local repo if present, stop the operation, and return no live resource.
3. Every local mutation writes intent to the local metadata repo first and commits it before touching the resource repo.
4. Local resource identity is UUID-based, not repo-name-based.
5. Human-readable repo names remain the preferred GitHub names, but they are mutable aliases, not identity.
6. Remote GitHub updates are asynchronous reconciliation steps after the local metadata commit, not the first source of truth.
7. Tombstone is terminal and beats any non-terminal update from another client or from stale local state.
8. A stale local client may commit intent first locally, but reconciliation must pull/merge remote metadata before push completion and invalidate any non-terminal mutation that loses to a tombstone.
9. If the local metadata repo itself is unavailable, the app must bootstrap or repair that metadata repo first; it must not bypass the metadata gate and mutate resource repos directly.

Immediate risk notes:

- UUID repo names are not required.
- Human-readable repo names can remain, but they must not be treated as stable identity.
- UUID should be the true identity; repo names should be mutable aliases tracked in metadata history.

Target architecture:

- add a real local `team-metadata` clone under each installation root
- store project/glossary records there as the authoritative local lifecycle ledger
- store local resource repos by stable resource ID, not by remote repo name
- introduce one shared repo-management state machine with per-resource adapters for:
  - bootstrap files
  - local repo initialization
  - remote repo creation/update/delete
  - editor-specific data loading
- introduce one shared background reconciliation queue that:
  - reads committed local metadata intent
  - performs remote GitHub work
  - updates local metadata again with the remote result
  - retries or surfaces repair states when background work fails

## Local-First Operation Contract

For create:

1. Generate or resume `resourceId`.
2. Generate or resume a stable `operationId` for the create attempt.
3. If that `resourceId` or `operationId` already exists in local metadata, treat the operation as replay/recovery instead of a brand-new create.
4. Check the create-time conflicts that actually matter:
   - desired repo-name reservation state
   - local path reservation state
   - any existing pending-create record with the same `operationId`
5. Write a `pendingCreate` metadata record to the local metadata repo and commit it.
6. Create and initialize the local repo using the `resourceId`-based local path.
7. If local repo initialization fails after the metadata commit, keep the metadata record in a recoverable local-error state instead of silently rolling it back.
8. Render the resource immediately from local state.
9. Queue background GitHub repo creation and metadata push.
10. When GitHub accepts a final repo name, update local metadata with the actual remote repo name/full name/repo ID.

For rename / soft-delete / restore:

1. Load the local metadata record.
2. Stop immediately if the record is tombstoned.
3. Write the next intended lifecycle/title state to the local metadata repo and commit it.
4. Apply the local repo change if needed.
5. If the local repo change fails after the metadata commit, keep the metadata intent plus a recoverable local-error state and do not silently roll the intent back.
6. Update the UI from local state immediately.
7. Queue the remote GitHub mutation and later commit the remote result back into local metadata.

For permanent delete:

1. Load the local metadata record.
2. Convert it to a tombstone in the local metadata repo and commit that tombstone first.
3. Remove the local repo immediately after the tombstone commit.
4. Remove the resource from the visible UI immediately.
5. If local purge fails, keep retryable local purge work recorded in metadata and continue treating the resource as tombstoned and hidden.
6. Queue remote metadata/tombstone push first, then remote repo deletion second.
7. If remote deletion fails, keep the tombstone; do not resurrect the resource locally.
8. If the remote tombstone push or remote repo deletion cannot complete yet, keep retryable remote work recorded in local metadata so background reconciliation can finish it later when connectivity returns.

For read / discovery:

1. Read local metadata first.
2. If a record is tombstoned, purge any stale local repo and suppress the resource from the live list.
3. If metadata says a live resource exists but the local repo is missing, keep the resource visible in a recoverable state and queue local rebuild/reclone work instead of hiding it.
4. Build visible resources from local metadata plus whatever local repo state is currently available.
5. Run remote reconciliation in the background to fill in missing remote details, repair origins, and refresh remote heads.
6. Never let a later remote read resurrect a tombstoned local resource.

Offline/failed-remote permanent delete rule:

- once a tombstone is committed locally, it remains the highest authority even if the app cannot yet push that tombstone to remote or delete the remote repo
- local UI and local discovery must continue treating the resource as permanently deleted
- background reconciliation must keep retrying the outstanding remote work until:
  - the tombstone commit is pushed to the remote metadata repo
  - the remote project/glossary repo is deleted or confirmed already absent
- a temporary network failure must not roll the tombstone back to `live`
- a later remote read that still shows the old repo must not resurrect the resource locally
- local metadata should record enough pending remote work to resume after restart, for example:
  - `pendingRemoteActions: ["pushTombstone", "deleteRemoteRepo"]`
  - or an equivalent reconciliation state model

Cross-client reconciliation rule:

- before a queued remote mutation is finalized, reconciliation must incorporate the latest remote metadata state
- if remote metadata already contains a tombstone for that `resourceId`, any queued local non-terminal mutation for that resource becomes invalid
- tombstone beats rename, restore, soft-delete reversal, and any other non-terminal update
- create replay may continue only if the remote metadata record is still the same pending/live resource and not tombstoned by another client
- for non-terminal conflicts that do not have an explicit deterministic merge rule, reconciliation should surface a repair/conflict state instead of silently picking a winner
- if reconciliation detects an invalidated mutation, the UI should surface a conflict/repair state instead of silently reapplying stale local intent

## Repo Naming Strategy

- do not append UUIDs to GitHub repo names
- keep GitHub repo names human-readable
- use UUID as the true resource identity and as the stable local repo key
- keep `desiredRepoName` and later `repoName`/`fullName` in metadata
- if GitHub name collision occurs, resolve it remotely and write the accepted final repo name back into metadata without renaming the local resource identity

## Shared Engine Responsibilities

- tombstone gate at the top of every operation
- metadata-first intent commit
- optimistic local state application
- local repo bootstrap/purge helpers
- queued remote reconciliation worker
- persisted mutation replay after reload
- repair-state classification when local or remote reconciliation fails
- one common status model for projects and glossaries

## Per-Resource Adapter Responsibilities

- project bootstrap files (`project.json`, chapter scaffolding, etc.)
- glossary bootstrap files (`glossary.json`, term structure, TMX import, etc.)
- project editor/chapter operations
- glossary editor/term operations
- glossary import can use the repo manager only for the part that creates a new glossary repo/resource
- once a glossary repo already exists, writing glossary terms or importing content into that existing repo is not a repo-manager concern
- project chapter/file import is not a repo-manager concern; it is a content mutation inside an already selected repo
- file format parsing, repo content writes, and page/editor-specific display remain outside the repo manager

## Recommended Staged Implementation

### Stage 9: Add Local Metadata Repo Foundation

- create a real local `team-metadata` repo path under each installation
- clone/bootstrap it during team setup and missing-installation recovery
- add Tauri commands for:
  - local metadata read
  - local metadata commit/write
  - local metadata pull/push
  - local tombstone lookup
- define a local metadata commit helper with signed-in user identity and deterministic commit messages

Expected outcome:

- the app has a local authoritative lifecycle ledger instead of talking only to broker metadata routes
- top-level rename / soft-delete / restore flows can start moving onto metadata-first sequencing without waiting for the full shared repo manager

### Stage 10: Move Resource Identity Off Repo Names

Status on 2026-04-10:

- partially complete
- local project/glossary repo resolution is now stable-ID-first instead of repo-name-first
- repo sync descriptors carry stable resource IDs
- local-first create no longer depends on the final GitHub repo name for either projects or glossaries
- a conservative migration/repair scan now maps existing local repos onto local team-metadata records and treats unmatched repos as repair candidates
- remaining gap: project repos still do not embed a stable project ID inside `project.json`, so very old installs without sync-state can only be migrated automatically when repo-name matching is unambiguous

- change local project/glossary storage to use resource IDs as the stable key
- preserve repo name as mutable metadata only
- migrate existing installations by first hydrating the local metadata clone from the existing remote `team-metadata` repo, then mapping current local repos onto those records
- treat stray local repos that have no matching metadata record as repair candidates, not as new authoritative live records
- update repo-sync descriptors to accept resource ID plus current remote repo name

Expected outcome:

- local creation no longer depends on knowing the final GitHub repo name

### Stage 11: Introduce Shared Repo-Management State Machine

Status on 2026-04-10:

- partially complete
- shared helpers now cover metadata-first mutations and tombstone prechecks
- projects and glossaries still have separate higher-level lifecycle flows, so the full adapter-based shared state machine is not finished

- build one shared engine for:
  - create
  - rename
  - soft-delete
  - restore
  - permanent delete
  - read/discovery prechecks
- require per-resource adapters rather than separate handwritten project/glossary lifecycle flows
- move tombstone check to the first line of every operation through this engine

Expected outcome:

- projects and glossaries stop duplicating repo-lifecycle logic

### Stage 12: Make Create Fully Local-First

Status on 2026-04-10:

- mostly complete
- glossary creation/import is local-first
- project creation is now local metadata first, local repo first, visible immediately, then remote creation/sync in the background
- project background reconciliation now repairs `origin` and can push the first local commit into an empty remote repo

- write `pendingCreate` to local metadata first
- initialize local repo first
- render immediately from local state
- push/create remote repo in the background
- update metadata with actual remote repo identity once created
- keep repo-name collision handling entirely inside the background reconcile path

Expected outcome:

- project and glossary creation no longer wait on remote repo creation before becoming locally usable

### Stage 13: Make Rename/Delete/Restore Fully Metadata-First

Status on 2026-04-10:

- partially complete
- rename, soft-delete, restore, and permanent delete are metadata-first in the main project/glossary flows that were refactored
- remaining gap: there is still duplicated lifecycle orchestration and some secondary paths still need to be folded into the same shared engine

- rename: commit new title/desired repo name locally first, then perform remote rename later
- soft-delete/restore: commit lifecycle locally first, then update remote repo metadata later
- permanent delete: commit tombstone locally first, purge local repo immediately, then delete remote repo later
- remove remaining direct remote-first lifecycle paths

Expected outcome:

- all top-level lifecycle operations follow the same local-first rule

### Stage 14: Unify Read Path Around Local Metadata Plus Background Reconciliation

Status on 2026-04-10:

- partially complete
- page loads already prefer local metadata plus local repos
- project/glossary discovery now surfaces explicit repair states instead of silently treating stray repos as authoritative
- background reconciliation now repairs `origin` for projects and glossaries, and project sync can handle empty remotes
- remaining gap: explicit repair actions and deeper remote mismatch recovery are still incomplete

- make page loads read local metadata + local repos first
- remove remaining repo-name-driven discovery shortcuts
- background remote reconciliation should:
  - attach/fix `origin`
  - repair missing remote identifiers
  - refresh remote head/default branch
  - surface repairable mismatch states
- keep the page usable even if remote reconciliation is slow or temporarily failing

Expected outcome:

- projects and glossaries load from the same local-first discovery model

### Stage 15: Add Recovery, Repair, And Migration Tooling

Status on 2026-04-10:

- started, not finished
- added backend repair/migration scan for local repo bindings against local team-metadata
- safe sync-state repairs are applied automatically
- repair issues are surfaced into discovery/UI state as explicit `repair` resolutions
- remaining gap: no user-triggered repair action exists yet for persistent conflicts like out-of-band remote rename or missing remote linkage

- add a repair command for:
  - missing `origin`
  - remote repo renamed out-of-band
  - metadata/remote mismatch
- add migration for existing installations to local metadata repo + resource-ID paths
- add explicit user-facing repair flows for persistent conflict states

Expected outcome:

- local-first repo management is robust enough to recover from partial failures without manual file surgery

## Testing Plan

- create two resources locally with the same desired repo name and verify only remote naming is disambiguated
- create a resource locally, kill the app before remote create finishes, relaunch, and verify replay continues from local metadata
- soft-delete then immediately permanently delete while background sync is still running and verify the tombstone wins
- manually delete a remote repo while local metadata says live and verify the app surfaces repair state without resurrecting deleted resources
- manually leave a stale local repo behind after tombstone and verify the tombstone gate purges it before display
- delete the full `installations` folder and verify the app rebuilds local metadata and resource repos from GitHub where possible
- run:
  - `npm test`
  - `npm run build`
  - `cargo check`

## Non-Goals

- do not change GitHub repo names to UUID-based names
- do not block local-first UI on remote broker latency
- do not keep separate handwritten repo lifecycle pipelines for projects and glossaries once the shared engine exists
