# Glossary / QA Lists Shared Framework Design

## Goal

Build a shared framework for the work that is genuinely similar across Glossaries and QA Lists, without forcing their different domain models into one confusing abstraction.

The right model is:

- Glossary and QA List remain domain modules.
- Shared code owns repeated workflow: cache, query, refresh, lifecycle mutations, create/import/export scaffolding, editor snapshot guards, and write-intent preservation.
- Each resource provides an adapter/config object that describes its names, state fields, commands, normalizers, permissions, and intentional differences.
- Shared code must not bypass TanStack Query or resource snapshot application. All cache/local/remote data flows through the same query-owned update path.

## Non-Negotiable Invariants

The shared framework exists partly to prevent the cache/local/sync revert bugs we have seen before. These rules must be built into the framework contract, not left to each caller:

1. **Team/cache ownership guard**
   - Cached data may only seed visible state when the cached team key matches the currently selected team.
   - Local disk data and remote refresh results must be ignored if the selected team changed while the load was running.

2. **Single state update path**
   - Cache seed, local seed, remote refresh, and mutation results must all flow through TanStack Query data and a resource `applySnapshot` operation.
   - Resource flows must not update visible list state around the side of query except through the configured snapshot applier.

3. **Write-intent preservation**
   - Query snapshots must apply active and recently settled write intents before visible state changes.
   - Refreshes must not temporarily revert rename/delete/restore/create changes while the server or local repo catches up.

4. **Immediate user feedback**
   - Refresh buttons and progress badges must update before long-running work starts.
   - A page that uses status badges for refresh/sync progress must show the first useful badge immediately.

5. **Mutation rollback**
   - Create/import/lifecycle mutations must have explicit rollback behavior.
   - On failure, query cache, visible state, local repo, remote repo, and metadata records must either be restored or the error must clearly say what could not be rolled back.

6. **Optional capabilities stay optional**
   - Metadata repair, background sync, default selection, and rebuild actions must be represented as optional adapter capabilities.
   - Shared controllers should branch on capability presence, not on resource names like `glossary` or `qa`.

## Core Design

Create a shared layer:

```text
src-ui/app/repo-resource/
```

Suggested modules:

1. `resource-cache.js`
   - Team-scoped load/save/remove cache.
   - Replaces the duplicated internals of `glossary-cache.js` and `qa-list-cache.js`.
   - Enforces cache-key matching before a cached snapshot can become visible.

2. `resource-query.js`
   - TanStack query observer setup.
   - Snapshot normalization.
   - Cache seed, local seed, background refresh.
   - Stale team guard.
   - Write-intent overlay preservation.
   - Mutation factories for rename/delete/restore/permanent delete.
   - Owns the only allowed path from loaded data to visible page state.

3. `resource-lifecycle.js`
   - Open rename.
   - Submit rename.
   - Soft delete.
   - Restore.
   - Permanent delete confirmation.
   - Permission/offline/write guards.

4. `resource-import-create.js`
   - File picker/drop handling.
   - Byte reading.
   - Remote repo name allocation.
   - Create repo, prepare local repo, initialize/import, sync, verify, rollback.
   - Resource-specific inspect/import commands injected by config.
   - Supports explicit rollback hooks for remote repo, local repo, and metadata records.

5. `resource-export.js`
   - TMX filename sanitizing.
   - Save dialog.
   - Export command dispatch.

6. `resource-editor.js`
   - Editor context guards.
   - Cache-first editor opening.
   - Apply snapshot only if safe.
   - Preserve visible editor data during refresh.
   - Active draft/write/background-sync blockers.
   - Treats background sync as an optional capability.

7. `visible-term-sync.js`
   - Upsert visible term.
   - Mark stale/failed/confirmed.
   - Remove term.
   - Reload term from disk.
   - Resource-specific term normalizer injected.

## Adapter Shape

Each resource should provide a config object. The exact shape can evolve, but it should look roughly like this:

```js
export const glossaryResource = {
  kind: "glossary",
  route: "glossaries",
  labels: {
    singular: "glossary",
    plural: "glossaries",
    titleSingular: "Glossary",
    titlePlural: "Glossaries",
    termSingular: "glossary term",
  },
  state: {
    page: () => state.glossariesPage,
    discovery: () => state.glossaryDiscovery,
    editor: () => state.glossaryEditor,
    getVisibleContext: () => ({
      teamId: state.selectedTeamId,
      selectedId: state.selectedGlossaryId,
      cacheKey: state.glossariesPage.visibleCacheKey,
    }),
    setRefreshing: (isRefreshing) => setResourcePageRefreshing(state.glossariesPage, isRefreshing),
    setDiscoveryState: (nextDiscovery) => { state.glossaryDiscovery = nextDiscovery; },
  },
  ids: {
    selectedId: () => state.selectedGlossaryId,
    setSelectedId: (id) => { state.selectedGlossaryId = id; },
    resourceIdField: "glossaryId",
  },
  cache: {
    keyForTeam: teamCacheKey,
    loadForTeam: loadStoredGlossariesForTeam,
    saveForTeam: saveStoredGlossariesForTeam,
    removeForTeam: removeStoredGlossariesForTeam,
  },
  query: {
    key: (teamId) => glossaryKeys.byTeam(teamId),
    editorKey: (team, glossary) => glossaryEditorQueryKey(team, glossary),
    collectionField: "glossaries",
    createSnapshot: createGlossariesQuerySnapshot,
    applySnapshot: applyGlossariesQuerySnapshotToState,
    patchQueryData: patchGlossaryQueryData,
    preserveWriteIntents: preserveGlossaryLifecyclePatchesInSnapshot,
    applyWriteIntentOverlay: applyGlossaryWriteIntentOverlay,
    persistSnapshot: (team, snapshot) => persistGlossariesForTeam(team, snapshot.glossaries),
  },
  normalize: {
    resource: normalizeGlossarySummary,
    term: normalizeGlossaryTerm,
  },
  permissions: {
    canManage: canManageGlossaries,
    canCreate: canCreateGlossaries,
    canPermanentDelete: canPermanentlyDeleteGlossaries,
  },
  repo: {
    listLocal: listLocalGlossarySummariesForTeam,
    listRemote: listRemoteGlossaryReposForTeam,
    syncMany: syncGlossaryReposForTeam,
    syncOne: syncSingleGlossaryForTeam,
    createRemote: createRemoteGlossaryRepoForTeam,
    prepareLocal: prepareLocalGlossaryRepo,
    deleteRemote: permanentlyDeleteRemoteGlossaryRepoForTeam,
  },
  operations: {
    initializeRepo: initializeGlossaryRepo,
    inspectTmxImport: inspectGlossaryTmxImport,
    importTmx: importGlossaryTmx,
    exportTmx: exportGlossaryTmx,
    renameResource: renameGlossary,
    softDeleteResource: softDeleteGlossary,
    restoreResource: restoreGlossary,
    purgeLocalRepo: purgeLocalGlossaryRepo,
  },
  modals: {
    creation: {
      open: openGlossaryCreationModal,
      close: resetGlossaryCreation,
      setStatus: setGlossaryCreationStatus,
      setError: setGlossaryCreationError,
      updateField: updateGlossaryCreationField,
    },
    import: {
      open: openGlossaryImportModalState,
      close: resetGlossaryImport,
      setStatus: setGlossaryImportStatus,
      setError: setGlossaryImportError,
    },
    rename: {
      open: openGlossaryRenameModalState,
      close: resetGlossaryRename,
      setStatus: setGlossaryRenameStatus,
      setError: setGlossaryRenameError,
      updateName: updateGlossaryRenameName,
    },
    permanentDeletion: {
      open: openGlossaryPermanentDeletionModalState,
      close: resetGlossaryPermanentDeletion,
      setStatus: setGlossaryPermanentDeletionStatus,
      setError: setGlossaryPermanentDeletionError,
      updateConfirmation: updateGlossaryPermanentDeletionConfirmation,
    },
  },
  createImport: {
    buildCreateInput: buildGlossaryCreateInput,
    buildImportInput: buildGlossaryImportInput,
    writeMetadataRecord: writeLinkedGlossaryMetadataRecord,
    verifyCreatedResource: verifyCreatedGlossaryState,
    verifyImportedResource: verifyImportedGlossaryState,
    rollbackRemote: rollbackGlossaryRemoteRepo,
    rollbackLocal: rollbackGlossaryLocalRepo,
    rollbackMetadata: rollbackGlossaryMetadataRecord,
  },
  capabilities: {
    metadataRepair: {
      ensureNotTombstoned: ensureGlossaryNotTombstoned,
      repairBinding: repairGlossaryRepoBinding,
      rebuildLocalRepo: rebuildGlossaryLocalRepo,
      inspectAndMigrateBindings: inspectAndMigrateLocalRepoBindings,
    },
    backgroundSync: {
      isActive: glossaryBackgroundSyncIsActive,
      needsExitSync: glossaryBackgroundSyncNeedsExitSync,
      start: startGlossaryBackgroundSyncSession,
      stopBeforeSwitch: syncAndStopGlossaryBackgroundSyncSession,
      markDirty: markGlossaryBackgroundSyncDirty,
    },
    defaultSelection: {
      mode: "single",
      getActiveIds: activeDefaultGlossaryIdForTeam,
      makeDefault: makeGlossaryDefault,
      makeDefaultIfFirst: makeGlossaryDefaultIfFirst,
      updateAfterDeletion: updateDefaultGlossaryAfterDeletion,
    },
  },
};
```

QA Lists would provide the same shape with QA labels, QA state slots, QA commands, QA normalizers, and QA-specific behavior.

Prefer operation functions over raw command strings in the adapter. The resource module should know Tauri command names and payload shapes; shared controllers should call domain operations such as `initializeRepo(input)` or `renameResource(input)`.

For QA Lists, metadata hooks can be no-ops until QA has glossary-style team metadata records:

```js
createImport: {
  writeMetadataRecord: async () => null,
  rollbackMetadata: async () => null,
}
```

Optional capabilities should be absent or `null` when unsupported. Shared controllers should check capability presence:

```js
if (resource.capabilities.backgroundSync) {
  await resource.capabilities.backgroundSync.stopBeforeSwitch(render);
}
```

Expected optional capability shapes:

```js
backgroundSync: {
  isActive,
  needsExitSync,
  start,
  stopBeforeSwitch,
  markDirty,
}

metadataRepair: {
  ensureNotTombstoned,
  repairBinding,
  rebuildLocalRepo,
  inspectAndMigrateBindings,
}

defaultSelection: {
  mode: "single" | "perLanguage",
  getActiveIds,
  makeDefault,
  makeDefaultIfFirst,
  updateAfterDeletion,
}
```

For unsupported capabilities, omit the capability or set it to `null`. Shared controllers must branch on capability presence only.

## Boundaries

Do not force these into the shared framework yet:

- Glossary term editor vs QA term editor. The data model is too different.
- Glossary default vs QA per-language default. Share only a small default-cache helper.
- TMX parsing. Share XML/text helpers, but keep parsers separate.
- Glossary metadata repair/rebuild. QA does not have the same metadata layer yet.
- Glossary background sync. Make it an optional adapter capability, not a required framework feature.

## State Update Contract

Shared controllers should not receive raw list setters like `setList(items)` as their primary write mechanism. They should receive snapshot-level operations:

- `createSnapshot(input)`
- `applySnapshot(snapshot, context)`
- `patchQueryData(queryData, resourceId, patch)`
- `preserveWriteIntents(nextSnapshot, previousSnapshot)`
- `persistSnapshot(team, snapshot)`
- `queryKey(teamId)`
- `cacheKey(team)`
- `collectionField`

This keeps cache, local disk, remote refresh, and mutation results on the same path. It also makes it harder for a future flow to update `state.glossaries` or `state.qaLists` directly and reintroduce flicker/revert bugs.

Modal state should also be updated through named modal operations instead of raw object mutation. Shared controllers should call operations like `setCreationError(message)`, `setImportStatus(status)`, or `closeRenameModal()` rather than directly assigning fields on `state.glossaryCreation` or `state.qaListCreation`.

## Create / Import Contract

The create/import controller should run a strict ordered workflow:

1. Validate permissions, online state, selected team, and write availability.
2. Read/inspect file or validate creation fields.
3. Allocate remote repo name.
4. Create remote repo.
5. Prepare local repo.
6. Initialize or import local content.
7. Write metadata record when the resource supports metadata.
8. Sync repo.
9. Verify remote, local, metadata, language, and term count.
10. Apply query snapshot and visible state through the shared query path.

On failure after any side effect, rollback must run in reverse order:

1. Metadata record.
2. Local repo.
3. Remote repo.
4. Query/visible optimistic state.

The error shown to the user should include rollback failure details when rollback cannot complete.

## Public File Shape

Keep domain-specific public files:

- `glossary-flow.js`
- `qa-list-flow.js`
- `glossary-query.js`
- `qa-list-query.js`
- related lifecycle/import/export/editor files

But make them thin wrappers around shared controllers.

Example:

```js
const glossaryQuery = createRepoResourceQueryController(glossaryResource);

export const loadTeamGlossaries = glossaryQuery.loadTeamResources;
export const seedGlossariesQueryFromCache = glossaryQuery.seedFromCache;
```

And for QA:

```js
const qaListQuery = createRepoResourceQueryController(qaListResource);

export const loadTeamQaLists = qaListQuery.loadTeamResources;
export const seedQaListsQueryFromCache = qaListQuery.seedFromCache;
```

This preserves readable domain imports while removing duplicated workflow code.

## Pre-Implementation Guardrails

Before wiring real Glossary or QA List flows into the shared framework, add fake-resource contract tests for the framework itself. These tests should use a minimal in-memory adapter instead of glossary or QA modules, so they prove the shared controller behavior without depending on current domain implementation details.

Required fake-resource contract tests:

- Cache data is ignored when the team/cache key does not match the selected team.
- Local load results are ignored when the selected team changes while the load is running.
- Remote refresh results are ignored when the selected team changes while the refresh is running.
- Cache seed, local seed, remote refresh, and mutation results all update visible state only through query snapshot application.
- Active or recently settled write-intent overlays survive a refresh and prevent temporary rename/delete/restore/create reversions.
- Refresh spinner and first progress badge update synchronously before the long-running refresh work starts.
- Mutation failure rolls back query data and visible state.
- Side-effect failure after create/import attempts rollback in reverse order: metadata, local repo, remote repo, then query/visible optimistic state.
- Optional capabilities can be omitted or set to `null` without breaking shared controllers.
- Shared controllers branch on capability presence, not resource names such as `glossary` or `qa`.

Implement the framework in vertical slices. The first real slice should be the query/cache controller only. Do not extract lifecycle, create/import/export, or editor behavior until the query/cache controller passes the fake-resource contract tests and works for both Glossaries and QA Lists through thin wrappers.

## Refactor Order

0. Add the fake-resource shared framework contract test harness.
   - Use a minimal resource adapter with in-memory cache, query snapshot, repo load, mutation, and rollback hooks.
   - Make the tests assert controller behavior directly instead of asserting glossary-specific or QA-specific labels.
   - Keep these tests as permanent regression coverage for future resource types.

1. Extract low-risk helpers.
   - Import byte reading.
   - TMX filename/save dialog.
   - Resource cache.
   - Editor snapshot guard.
   - Add tests for each helper before wiring it into both resources.

2. Extract the query controller.
   - This gives the biggest payoff because it centralizes cache/load/sync/write-intent behavior.
   - Required tests:
     - Cache seed only applies when team/cache key matches.
     - Stale local/remote loads do not replace another team's visible data.
     - Refresh starts spinner and progress badge immediately.
     - Soft delete/restore/rename/create do not revert during refresh.
     - Mutations update through query data, not direct list mutation.

3. Extract the lifecycle controller.
   - Rename/delete/restore/permanent delete become config-driven.
   - Required tests:
     - Rename/delete/restore blocked during active write where appropriate.
     - Permanent delete blocked during refresh/write.
     - Offline and permission errors surface without mutation.
     - Mutation rollback restores query data and visible state.

4. Extract create/import/export scaffolding.
   - This has more moving parts, so do it after query/lifecycle are stable.
   - Required tests:
     - Create rollback deletes remote/local side effects after initialize failure.
     - Import rollback deletes remote/local side effects after import failure.
     - Import rejects unsupported files and resource-specific language mismatches.
     - Export uses correct filename and command.

5. Extract visible term sync helpers.
   - Share term list mechanics, not the term editor UI.
   - Required tests:
     - Open draft prevents background snapshot replacement.
     - Active term write prevents background snapshot replacement.
     - Failed term save keeps visible error state.

6. Later, consider Rust shared modules.
   - Repo sync engine.
   - Storage path helpers.
   - IO helpers.
   - XML escaping/language normalization helpers.

## Design Principle

Share workflow, not domain model.

Glossary and QA Lists should still read like glossary and QA code at the edges, while the repeated repo-resource machinery lives in one place.

The shared framework should be strict about data-flow invariants and flexible about resource capabilities. That combination is the main protection against making the cache/local/sync workflow bugs more generic instead of actually removing them.
