# QA Lists / Glossaries File And Function Parity Checklist

Goal: make QA Lists follow the Glossary design at the file level and function level, with differences only where QA functionality is intentionally different:

- QA list has one language instead of source + target.
- QA term has one text value plus notes instead of source variants, target variants, target variant notes, global notes, and footnote.
- QA list default behavior is per language instead of one default glossary per team.
- QA list TMX import must reject multi-language TMX files.

Legend:

- `[x]` Already has a matching file/function shape or the difference is intentional.
- `[ ]` Needs refactor or behavior parity work.
- **Copy** means mirror the glossary structure closely.
- **Adapt** means mirror the glossary structure but keep QA-specific data shape.
- **Rewrite** means replace current QA-specific flow with the glossary design pattern.
- **Share** means extract common helper code so both features call the same implementation.

## JavaScript File-Level Checklist

### Facade And Top-Level Flow

- [x] `src-ui/app/glossary-flow.js` -> `src-ui/app/qa-list-flow.js`
  - Current state: `qa-list-flow.js` is now a facade that re-exports focused modules matching the glossary flow shape.
  - Needed action: **Completed** for the facade split.
  - New QA files needed:
    - `src-ui/app/qa-list-discovery-flow.js`
    - `src-ui/app/qa-list-lifecycle-flow.js`
    - `src-ui/app/qa-list-import-flow.js`
    - `src-ui/app/qa-list-export-flow.js`
    - `src-ui/app/qa-list-editor-flow.js`
    - `src-ui/app/qa-term-draft.js`

### Top-Level Discovery

- [x] `src-ui/app/glossary-discovery-flow.js` -> `src-ui/app/qa-list-discovery-flow.js`
  - [x] `glossariesPageOwnsTeam` -> `qaListsPageOwnsTeam`: **Adapted**; uses `qaListsPage`, visible owner state, and `teamCacheKey`.
  - [x] `primeGlossariesLoadingState` -> `primeQaListsLoadingState`: **Adapted**; cache seeding, page-owner preservation, and editor QA navigation preservation are in place.
  - [x] `isGlossaryLoadCurrent` -> `isQaListLoadCurrent`: **Adapted**; selected-team guard prevents stale loads from replacing another team's data.
  - [x] `loadTeamGlossaries` -> `loadTeamQaLists`: **Adapted**; now uses page sync, progress badges, `waitForNextPaint`, local seed before remote refresh, stale-load guard, and query observer refresh.
  - Reuse candidate: **Share** a generic top-level resource discovery loader for cache seed, local seed, background refresh, page sync, and stale-load guard.

### Lifecycle

- [x] `src-ui/app/glossary-lifecycle-flow.js` -> `src-ui/app/qa-list-lifecycle-flow.js`
  - [x] `glossaryById` -> `qaListById`: **Adapted**.
  - [x] `lifecycleActionBlockedMessage` -> `qaListLifecycleActionBlockedMessage`: **Adapted**; terminology changes only.
  - [x] `glossaryMetadataRecord` -> `qaListMetadataRecord`: **Explicitly deferred**; QA lists currently use repo metadata directly and do not have glossary-style team metadata records.
  - [x] `commitGlossaryMutationStrict` -> `commitQaListMutationStrict`: **Explicitly deferred** until QA has glossary-style team metadata records; current QA commit is isolated in the lifecycle file and uses repo/local commands directly.
  - [x] `glossaryWriteBlockedMessage` -> `qaListWriteBlockedMessage`: **Adapted**.
  - [x] `glossaryLifecycleWriteBlockedMessage` -> `qaListLifecycleWriteBlockedMessage`: **Adapted**.
  - [x] `areGlossaryLifecycleWritesDisabled` -> `areQaListLifecycleWritesDisabled`: **Adapted**.
  - [x] `areGlossaryHeavyWritesDisabled` -> `areQaListHeavyWritesDisabled`: **Adapted**; includes resource-page write state and QA list mutating write state.
  - [x] `toggleDeletedGlossaries` -> `toggleDeletedQaLists`: **Adapted**; move to lifecycle file.
  - [x] `openGlossaryRename` -> `openQaListRename`: **Adapted**; uses `openTopLevelRenameModal` plus resource guards.
  - [x] `updateGlossaryRenameName` -> `updateQaListRenameName`: **Adapted**; uses `updateEntityModalName`.
  - [x] `cancelGlossaryRename` -> `cancelQaListRename`: **Adapted**; uses `cancelEntityModal`.
  - [x] `submitGlossaryRename` -> `submitQaListRename`: **Adapted**; uses `guardTopLevelResourceAction`, tombstone-shape guard, and lifecycle write block.
  - [x] `deleteGlossary` -> `deleteQaList`: **Adapted**; uses glossary-style guard and blocked-write behavior.
  - [x] `restoreGlossary` -> `restoreQaList`: **Adapted**; uses glossary-style guard and blocked-write behavior.
  - [x] `openGlossaryPermanentDeletion` -> `openQaListPermanentDeletion`: **Adapted**; guards deleted state, owner permission, and heavy writes.
  - [x] `updateGlossaryPermanentDeletionConfirmation` -> `updateQaListPermanentDeletionConfirmation`: **Adapted**; uses `updateEntityModalConfirmation`.
  - [x] `cancelGlossaryPermanentDeletion` -> `cancelQaListPermanentDeletion`: **Adapted**.
  - [x] `confirmGlossaryPermanentDeletion` -> `confirmQaListPermanentDeletion`: **Adapted**; uses shared confirmation guard and blocked-write handling.
  - Reuse candidate: **Share** a generic top-level lifecycle controller parameterized by labels, state slots, query mutation factories, and repo commands.

### Create And Import

- [x] `src-ui/app/glossary-import-flow.js` -> `src-ui/app/qa-list-import-flow.js`
  - [x] `detectGlossaryImportFileType` -> `detectQaListImportFileType`: **Adapted**; TMX only.
  - [x] `readableImportFileLike` -> `readableImportFileLike`: **Copied**; still a future share candidate.
  - [x] `droppedPathFileLike` -> `droppedPathFileLike`: **Copied**; still a future share candidate.
  - [x] `importFileName` -> `importFileName`: **Copied**; still a future share candidate.
  - [x] `decodeBase64ToBytes` -> `decodeBase64ToBytes`: **Copied**; still a future share candidate.
  - [x] `importFileBytes` -> `importFileBytes`: **Copied**; still a future share candidate.
  - [x] `glossaryImportModalState` -> `qaListImportModalState`: **Adapted**; QA now has matching modal state and screen wiring.
  - [x] `setGlossaryImportError` -> `setQaListImportError`: **Adapted**.
  - [x] `setGlossariesPageProgress` -> `setQaListsPageProgress`: **Adapted**.
  - [x] `remoteGlossaryRepoUrl` -> `remoteQaListRepoUrl`: **Adapted**.
  - [x] `prepareLocalGlossaryRepo` -> `prepareLocalQaListRepo`: **Adapted**; uses existing QA repo preparation.
  - [x] `linkedGlossaryMetadataRecord` -> `linkedQaListMetadataRecord`: **Explicitly deferred**; QA create/import links local repos directly to GitHub repo metadata until QA team metadata records are introduced.
  - [x] `normalizedText` -> `normalizedText`: **Copied**; still a future share candidate.
  - [x] `normalizedLanguageCode` -> `normalizedLanguageCode`: **Copied**; still a future share candidate.
  - [x] `languageMatches` -> `languageMatches`: **Adapted**; QA compares one language.
  - [x] `importedGlossarySafetyError` -> `importedQaListSafetyError`: **Adapted**.
  - [x] `findImportedRemoteRepo` -> `findImportedRemoteRepo`: **Copied**; still a future share candidate.
  - [x] `repairIssueMatchesImportedGlossary` -> `repairIssueMatchesImportedQaList`: **Explicitly deferred**; QA has no metadata repair issue layer yet.
  - [x] `verifyImportedGlossaryState` -> `verifyImportedQaListState`: **Adapted**; verifies one language and term count.
  - [x] `rollbackStrictGlossaryCreate` -> `rollbackStrictQaListCreate`: **Adapted**.
  - [x] `createRemoteGlossaryRepoForAvailableName` -> `createRemoteQaListRepoForAvailableName`: **Adapted**; exact repo-name helper now avoids double-prefixing.
  - [x] `completeGlossaryCreateSynchronously` -> `completeQaListCreateSynchronously`: **Adapted**; QA create uses progress, rollback, sync, and query write coordination.
  - [x] `reloadGlossariesAfterWrite` -> `reloadQaListsAfterWrite`: **Adapted**.
  - [x] `openGlossaryCreation` -> `openQaListCreation`: **Adapted**; uses `guardResourceCreateStart`.
  - [x] `cancelGlossaryCreation` -> `cancelQaListCreation`: **Adapted**.
  - [x] `updateGlossaryCreationField` -> `updateQaListCreationField`: **Adapted**; one language field only.
  - [x] `submitGlossaryCreation` -> `submitQaListCreation`: **Adapted**; now uses `submitResourcePageWrite`.
  - [x] `canOpenGlossaryImport` -> `canOpenQaListImport`: **Adapted**.
  - [x] `openGlossaryImportModal` -> `openQaListImportModal`: **Adapted**.
  - [x] `cancelGlossaryImportModal` -> `cancelQaListImportModal`: **Adapted**.
  - [x] `importGlossaryFromTmx` -> `importQaListFromTmx`: **Adapted**; opens the QA import modal.
  - [x] `selectGlossaryImportFile` -> `selectQaListImportFile`: **Adapted**.
  - [x] `importGlossaryFile` -> `importQaListFile`: **Adapted**; preserves single-language validation.
  - [x] `handleDroppedGlossaryImportFile` -> `handleDroppedQaListImportFile`: **Adapted**.
  - [x] `handleDroppedGlossaryImportPath` -> `handleDroppedQaListImportPath`: **Adapted**.
  - Reuse candidate: **Share** file-type detection, byte reading, dropped-file handling, remote repo name allocation, resource-create progress, rollback scaffolding.

### Export

- [x] `src-ui/app/glossary-export-flow.js` -> `src-ui/app/qa-list-export-flow.js`
  - [x] `selectedTeam` -> `selectedTeam`: **Adapted** via QA list shared helpers.
  - [x] `sanitizeTmxFileName` -> `sanitizeTmxFileName`: **Copied**; still a future share candidate.
  - [x] `saveTmxFilePath` -> `saveTmxFilePath`: **Copied/adapted**; native save dialog parity.
  - [x] `downloadGlossaryAsTmx` -> `downloadQaListAsTmx`: **Adapted**; uses QA export command and labels.

### Editor Flow

- [x] `src-ui/app/glossary-editor-flow.js` -> `src-ui/app/qa-list-editor-flow.js`
  - [x] `resolveGlossaryForEditor` -> `resolveQaListForEditor`: **Adapted**.
  - [x] `glossaryEditorContext` -> `qaListEditorContext`: **Adapted**; move to editor flow file.
  - [x] `glossaryEditorContextMatches` -> `qaListEditorContextMatches`: **Adapted**; move to editor flow file.
  - [x] `glossaryEditorPayloadMatches` -> `qaListEditorPayloadMatches`: **Adapted**; move to editor flow file.
  - [x] `glossaryEditorHasOpenDraft` -> `qaListEditorHasOpenDraft`: **Adapted**.
  - [x] `glossaryEditorHasActiveTermWrite` -> `qaListEditorHasActiveTermWrite`: **Adapted**.
  - [x] `glossaryEditorHasActiveBackgroundSync` -> `qaListEditorHasActiveBackgroundSync`: **Intentional no-op**; QA has no background-sync session yet.
  - [x] `glossaryEditorHasPendingLocalTerms` -> `qaListEditorHasPendingLocalTerms`: **Adapted**.
  - [x] `canApplyGlossaryEditorSnapshot` -> `canApplyQaListEditorSnapshot`: **Adapted**.
  - [x] `maybeApplyGlossaryEditorSnapshot` -> `maybeApplyQaListEditorSnapshot`: **Adapted**.
  - [x] `primeSelectedGlossaryEditorLoadingState` -> `primeSelectedQaListEditorLoadingState`: **Adapted**; uses resolver and preserves search/navigation state.
  - [x] `loadSelectedGlossaryEditorData` -> `loadSelectedQaListEditorData`: **Adapted**; matches page sync, invalidate/fetch query, stale context, preserve visible data, and error handling.
  - [x] `openGlossaryEditor` -> `openQaListEditor`: **Adapted**; cache-first render followed by refresh.
  - [x] `updateGlossaryTermSearchQuery` -> `updateQaTermSearchQuery`: **Adapted**.
  - [x] `deleteGlossaryTerm` -> `deleteQaTerm`: **Adapted boundary**; QA keeps term delete in `qa-term-draft.js` with the rest of QA term writes.
  - Reuse candidate: **Share** editor snapshot guard mechanics across glossary and QA.

### Term Draft / Term Writes

- [x] `src-ui/app/glossary-term-draft.js` -> `src-ui/app/qa-term-draft.js`
  - [x] `normalizeSourceTermForDuplicateDetection` -> `normalizeQaTermTextForDuplicateDetection`: **Adapted**; QA checks one text field.
  - [x] `findRedundantSourceVariantIndices` -> `qaTermTextDuplicatesExistingTerm`: **Adapted**; no variant indices, same duplicate policy.
  - [x] `syncGlossaryTermDuplicateFeedbackDom` -> QA duplicate feedback handling: **Intentional adaptation**; QA uses modal error text instead of per-variant red highlights.
  - [x] `clearGlossaryTermDuplicateFeedback` -> QA duplicate feedback clear: **Intentional adaptation**; `updateQaTermDraftField` clears the modal error.
  - [x] `refreshGlossaryTermDuplicateFeedback` -> QA duplicate feedback refresh: **Intentional adaptation**; duplicate validation runs on submit and after pre-save sync.
  - [x] `shouldRefreshGlossaryTermDuplicateFeedback` -> QA equivalent: **Intentional no equivalent**; QA has one text field.
  - [x] `createGlossaryTermEditorModalState` -> QA inline state builder in `openQaTermEditor`: **Adapted**; QA fields are `text` and `notes`.
  - [x] `reopenGlossaryTermEditorWithLatestRemote` -> QA remote freshness handling: **Adapted**; QA blocks stale/deleted remote term saves with modal errors.
  - [x] `rollbackGlossaryTermSave` -> `rollbackQaTermSave`: **Adapted**.
  - [x] `nextOptimisticClientTermId` -> QA visible term handling: **Intentional no equivalent yet**; QA waits for save confirmation instead of creating optimistic visible terms.
  - [x] `showGlossaryEditorStatus` -> QA status handling: **Intentional no equivalent yet**; QA uses write spinner and errors, not scoped status badges.
  - [x] `clearGlossaryEditorStatus` -> QA status handling: **Intentional no equivalent yet**.
  - [x] `restoreFailedGlossaryTermSave` -> QA failed save handling: **Adapted**; modal error is restored on failure.
  - [x] `runGlossaryTermSaveIntent` -> QA save write path: **Partially adapted**; QA uses the term write coordinator active state but not the optimistic intent runner.
  - [x] `openGlossaryTermEditor` -> `openQaTermEditor`: **Adapted**; move from monolith.
  - [x] `cancelGlossaryTermEditor` -> `cancelQaTermEditor`: **Adapted**; move from monolith.
  - [x] `updateGlossaryTermDraftField` -> `updateQaTermDraftField`: **Adapted**; move from monolith.
  - [x] Variant mutators (`updateGlossaryTermVariant`, `updateGlossaryTermVariantNote`, `addGlossaryTermVariant`, `addGlossaryTermEmptyTargetVariant`, `removeGlossaryTermVariant`, `moveGlossaryTermVariantToIndex`): **Intentional no QA equivalent**; QA has no variants.
  - [x] `submitGlossaryTermEditor` -> `submitQaTermEditor`: **Adapted**; includes duplicate checks, pre-save sync freshness checks, rollback, query invalidation, and visible editor persistence.
  - [x] `deleteGlossaryTerm` -> `deleteQaTerm`: **Adapted**; includes pre-delete sync, rollback, and visible editor persistence.
  - Reuse candidate: **Share** remote term save/delete conflict scaffolding; keep resource-specific payload builders.

### Inline Markup

- [x] `src-ui/app/glossary-term-inline-markup-flow.js` -> `src-ui/app/qa-term-inline-markup-flow.js`
  - [x] `isGlossaryVariantTextarea` -> `isQaTermTextarea`: **Adapted**.
  - [x] `glossaryInlineStyleButtons` -> `qaTermInlineStyleButtons`: **Adapted**.
  - [x] `focusedGlossaryVariantTextarea` -> `focusedQaTermTextarea`: **Adapted**.
  - [x] `clearGlossaryInlineStyleButtons` -> `clearQaTermInlineStyleButtons`: **Adapted**.
  - [x] `syncGlossaryTermInlineStyleButtons` -> `syncQaTermInlineStyleButtons`: **Adapted**.
  - [x] `resolveTargetTextarea`: **Intentional no QA equivalent**; QA has one text field.
  - [x] `toggleGlossaryTermInlineStyle` -> `toggleQaTermInlineStyle`: **Adapted**.
  - Reuse candidate: **Share** generic inline-style button sync/toggle with selector and draft-update callbacks.

### Defaults

- [x] `src-ui/app/glossary-default-flow.js` -> `src-ui/app/qa-list-default-flow.js`
  - [x] `activeGlossariesExcept`: **Intentional no direct QA equivalent**; QA filters active lists by language.
  - [x] `compareDefaultCandidates`: **Intentional no direct QA equivalent**; QA replacement is per-language.
  - [x] `defaultGlossaryCandidateAfterDeletion` -> replacement selection inside `updateDefaultQaListAfterDeletion`: **Adapted**.
  - [x] `activeDefaultGlossaryIdForTeam` -> `activeDefaultQaListIdsForTeam`: **Intentional adaptation**; returns language-code map.
  - [x] `defaultGlossaryForTeam` -> `isDefaultQaList` / language lookup: **Intentional adaptation**.
  - [x] `makeGlossaryDefault` -> `makeQaListDefault`: **Adapted**; per-language.
  - [x] `makeGlossaryDefaultIfFirst` -> `makeQaListDefaultIfFirst`: **Adapted**; per-language.
  - [x] `updateDefaultGlossaryAfterDeletion` -> `updateDefaultQaListAfterDeletion`: **Adapted**; per-language.

### Queries And Cache

- [x] `src-ui/app/glossary-query.js` -> `src-ui/app/qa-list-query.js`
  - [x] `resetGlossariesQueryObserver` -> `resetQaListsQueryObserver`: **Adapted**.
  - [x] `glossaryRepoSyncByRepoName` -> `qaListRepoSyncByRepoName`: **Adapted**.
  - [x] `createGlossariesQuerySnapshot` -> `createQaListsQuerySnapshot`: **Adapted**; includes broker warning and sync issue fields.
  - [x] `applyGlossaryWriteIntentOverlay`: **Adapted**; QA query snapshots now preserve QA write-intent overlays.
  - [x] `applyGlossariesQuerySnapshotToState` -> `applyQaListsQuerySnapshotToState`: **Adapted**.
  - [x] `patchGlossaryQueryData` -> `patchQaListQueryData`: **Adapted**.
  - [x] `normalizeGlossariesSnapshotInput` -> inline QA array normalization: **Adapted but consider adding named function for parity**.
  - [x] `moveGlossaryToLifecycle` -> `moveQaListToLifecycle`: **Adapted**.
  - [x] `removeGlossaryFromQueryData` -> `removeQaListFromQueryData`: **Adapted**.
  - [x] `glossaryLifecycleIntent` -> `qaListLifecycleIntent`: **Adapted**.
  - [x] `glossaryInSnapshot` -> `qaListInSnapshot`: **Adapted**.
  - [x] `glossaryLocation` -> `qaListLocation`: **Adapted**.
  - [x] `glossaryTitleInSnapshot` -> `qaListTitleInSnapshot`: **Adapted**.
  - [x] `patchGlossaryInList` -> `patchQaListInList`: **Adapted**.
  - [x] `preserveGlossaryLifecyclePatchesInSnapshot` -> `preserveQaListLifecyclePatchesInSnapshot`: **Adapted**, with QA-specific create preservation.
  - [x] `preservePendingGlossaryLifecyclePatches` -> QA alias: **Adapted**.
  - [x] `seedGlossariesQueryFromCache` -> `seedQaListsQueryFromCache`: **Adapted**.
  - [x] `seedGlossariesQueryFromLocal` -> `seedQaListsQueryFromLocal`: **Adapted**.
  - [x] `createGlossariesQueryOptions` -> `createQaListsQueryOptions`: **Adapted**; includes recovery, broker warning, sync issue, and progress semantics.
  - [x] `ensureGlossariesQueryObserver` -> `ensureQaListsQueryObserver`: **Adapted**.
  - [x] lifecycle mutation factory and public mutation options: **Adapted**.
  - [x] `invalidateGlossariesQueryAfterMutation` -> `invalidateQaListsQueryAfterMutation`: **Adapted**.
  - [x] `persistQaListsQueryDataForTeam`: **QA-only helper**; acceptable but consider corresponding glossary helper or moving persistence into shared top-level state.

- [x] `src-ui/app/glossary-editor-query.js` -> `src-ui/app/qa-list-editor-query.js`
  - [x] `glossaryId` -> `qaListId`: **Adapted**.
  - [x] `glossaryRepoName` -> `qaListRepoName`: **Adapted**.
  - [x] query key, snapshot context, query options, get/set/remove cache: **Adapted**.

- [x] `src-ui/app/glossary-cache.js` -> `src-ui/app/qa-list-cache.js`
  - [x] `loadStoredGlossariesForTeam` -> `loadStoredQaListsForTeam`: **Adapted**.
  - [x] `saveStoredGlossariesForTeam` -> `saveStoredQaListsForTeam`: **Adapted**.
  - [x] `removeStoredGlossariesForTeam` -> `removeStoredQaListsForTeam`: **Adapted**.

- [x] `src-ui/app/glossary-default-cache.js` -> `src-ui/app/qa-list-default-cache.js`
  - QA is intentionally per-language, so function names and data shape differ.

### Repo Flow

- [x] `src-ui/app/glossary-repo-flow.js` -> `src-ui/app/qa-list-repo-flow.js`
  - Current state: QA repo flow is much smaller.
  - [x] `normalizeGlossaryBrokerError` -> `normalizeQaListBrokerError`: **Adapted**.
  - [x] metadata repair functions (`repairGlossaryMetadataFromRemoteRename`, `finalizeMissingGlossariesForTeam`, `metadataBackedGlossaryRepo`, `findMatchingRemoteGlossary`, `buildMetadataBackedGlossarySyncRepos`, `countRecoverableGlossaryMetadataRecords`): **Explicitly deferred**; QA lists do not yet have glossary-style team metadata records, so there is no metadata-backed repair layer to port.
  - [x] `normalizeRemoteGlossaryRepo` -> `normalizeRemoteQaListRepo`: **Adapted**.
  - [x] `glossaryRepoSyncDescriptor` -> `qaListRepoSyncDescriptor`: **Adapted**; `qaListRepoDescriptor` remains for editor command inputs.
  - [x] `getGlossarySyncIssueMessage` -> `getQaListSyncIssueMessage`: **Adapted**.
  - [x] `listRemoteGlossaryReposForTeam` -> `listRemoteQaListReposForTeam`: **Adapted**, but add broker error normalization.
  - [x] `syncGlossaryReposForTeam` -> `syncQaListReposForTeam`: **Adapted**, but add update-required prompt parity if needed.
  - [x] `listLocalGlossarySummariesForTeam` -> `listLocalQaListsForTeam`: **Adapted**.
  - [x] `ensureGlossaryNotTombstoned` -> `ensureQaListNotTombstoned`: **Adapted**; current QA version covers tombstone-shaped QA list records until QA metadata records exist.
  - [x] `loadRepoBackedGlossariesForTeam` -> `loadRepoBackedQaListsForTeam`: **Adapted**; QA query now calls the repo-flow loader instead of doing repo discovery inline.
  - [x] `createRemoteGlossaryRepoForTeam` -> `createRemoteQaListRepo`: **Adapted**.
  - [x] `permanentlyDeleteRemoteGlossaryRepoForTeam` -> `deleteRemoteQaListRepo`: **Adapted**.
  - [x] `repairGlossaryRepoBinding` -> `repairQaListRepoBinding`: **Explicitly deferred** with QA metadata repair support.
  - [x] `rebuildGlossaryLocalRepo` -> `rebuildQaListLocalRepo`: **Explicitly deferred** with QA metadata repair support.
  - [x] `syncSingleGlossaryForTeam` -> `syncSingleQaListForTeam`: **Adapted**.
  - Reuse candidate: **Share** repo sync issue parsing, remote repo normalization, missing-repo resolution UI, tombstone checks, and repair/rebuild wrappers.

### Shared State And Coordinators

- [x] `src-ui/app/glossary-shared.js` -> `src-ui/app/qa-list-shared.js`
  - [x] `selectedTeam` -> `selectedTeam`: **Adapted**.
  - [x] `canManageGlossaries` -> `canManageQaLists`: **Adapted**.
  - [x] `canCreateGlossaries` -> `canCreateQaLists`: **Adapted**.
  - [x] `canPermanentlyDeleteGlossaries` -> `canPermanentlyDeleteQaLists`: **Adapted**.
  - [x] `sortGlossaries` -> `sortQaLists`: **Adapted**.
  - [x] `selectedGlossary` -> `selectedQaList`: **Adapted**.
  - [x] `selectedGlossaryRepoName` -> `selectedQaListRepoName`: **Adapted**.
  - [x] `normalizeGlossarySummary` -> `normalizeQaList`: **Adapted**.
  - [x] `normalizeGlossaryTerm` -> `normalizeQaTerm`: **Adapted**.
  - [x] `applyGlossaryEditorPayload` -> `applyQaListEditorPayload`: **Adapted**.
  - [x] `upsertGlossarySummary` -> `upsertQaList`: **Adapted**.
  - [x] editable variant helpers: **Intentional no QA equivalent**.
  - [x] `buildGlossaryTargetVariantGuidance`: **Intentional no QA equivalent**.
  - [x] `updateGlossaryTermArray`: **Intentional no QA equivalent**.

- [x] `src-ui/app/glossary-top-level-state.js` -> `src-ui/app/qa-list-top-level-state.js`
  - [x] `glossarySnapshotFromList` -> `qaListSnapshotFromList`: **Adapted**.
  - [x] `applyGlossarySnapshotToState` -> `applyQaListSnapshotToState`: **Adapted**.
  - [x] `persistGlossariesForTeam` -> `persistQaListsForTeam`: **Adapted**.
  - [x] `removeGlossaryFromState` -> `removeQaListFromState`: **Adapted**.

- [x] `src-ui/app/glossary-write-coordinator.js` -> `src-ui/app/qa-list-write-coordinator.js`
  - [x] All title/lifecycle/repo intent key, scope, request/get, active checks, patch/apply/clear functions: **Adapted**; query snapshots now apply the QA write-intent overlay.

- [x] `src-ui/app/glossary-term-write-coordinator.js` -> `src-ui/app/qa-term-write-coordinator.js`
  - [x] All save intent key/scope/request/get/active/reset functions: **Adapted**.

- [x] `src-ui/app/glossary-term-sync.js` -> `src-ui/app/qa-term-sync.js`
  - [x] `findGlossaryTermById` -> `findQaTermById`: **Adapted**.
  - [x] UI-field preservation helpers: **Adapted** to QA `text`/`notes`.
  - [x] visible term upsert/replace/confirm/fail/remove/stale/reload functions: **Adapted**.

- [x] `src-ui/app/glossary-background-sync.js` -> `src-ui/app/qa-list-background-sync.js`
  - [x] All session, active input, interval, dirty, exit sync, start/stop functions: **Explicitly deferred**. Glossary editor has background sync; QA editor currently uses explicit refresh and term-write guards, with `qaListEditorHasActiveBackgroundSync()` returning false for parity-aware snapshot guards.

- [x] `src-ui/app/glossary-ruby.js`
  - Intentional shared file. QA uses glossary ruby helpers directly. Do not duplicate.

### Actions

- [x] `src-ui/app/actions/glossary-actions.js` -> `src-ui/app/actions/qa-actions.js`
  - [x] `createGlossaryActions` -> `createQaActions`: **Adapted**.
  - [x] `parseVariantAction`: **Intentional no QA equivalent**.
  - [x] Add QA action imports for new split files through `qa-list-flow.js` facade after refactor.
  - [x] Add QA import modal/dropped-file actions if we add `qa-list-import-modal.js`.
  - [x] Add repair/rebuild QA list actions if QA repo resolution parity is implemented: **Deferred with metadata repair**, because QA repo repair/rebuild actions require the glossary team-metadata layer.

## JavaScript Screen Checklist

- [x] `src-ui/screens/glossaries.js` -> `src-ui/screens/qa.js`
  - [x] `renderGlossaryLanguageFlow`: **Intentional QA equivalent is inline language name only**.
  - [x] `renderGlossaryCard` -> `renderQaListCard`: **Adapted**; includes lifecycle/write disabled state and repo resolution state. Repair/rebuild remains tied to future QA metadata support.
  - [x] `renderDeletedGlossariesSection` -> `renderDeletedQaListsSection`: **Adapted**.
  - [x] `renderGlossariesScreen` -> `renderQaScreen`: **Adapted**; includes recovery/broker warning markup, lifecycle/write disabled flags, sync snapshots, and status parity.

- [x] `src-ui/screens/glossary-editor.js` -> `src-ui/screens/qa-list-editor.js`
  - [x] `shortenChapterNavLabel` -> `shortenChapterNavLabel`: **Copy/adapt**; could share.
  - [x] `renderGlossaryEditorScreen` -> `renderQaListEditorScreen`: **Adapted**; refresh spinner now reflects active QA term writes and nav behavior remains aligned.
  - [x] `visibleTerms` filtering: **Intentional adaptation** for QA text/notes only.
  - [x] `renderTermCell` -> `renderTextCell`: **Intentional adaptation**.

- [x] `src-ui/screens/glossary-creation-modal.js` -> `src-ui/screens/qa-list-creation-modal.js`
  - [x] `renderLanguageOptions` -> `renderLanguageOptions`: **Copy/adapt**; possible shared helper.
  - [x] `renderGlossaryCreationModal` -> `renderQaListCreationModal`: **Adapted**, one language only.

- [x] `src-ui/screens/glossary-rename-modal.js` -> `src-ui/screens/qa-list-rename-modal.js`
  - [x] Render function: **Adapted**.

- [x] `src-ui/screens/glossary-permanent-deletion-modal.js` -> `src-ui/screens/qa-list-permanent-deletion-modal.js`
  - [x] Render function: **Adapted**; loading markup, disabled semantics, and copy style aligned.

- [x] `src-ui/screens/glossary-term-editor-modal.js` -> `src-ui/screens/qa-term-editor-modal.js`
  - [x] `renderVariantRow` / `renderVariantLane`: **Intentional no QA equivalent**.
  - [x] `renderGlossaryTermEditorModal` -> `renderQaTermEditorModal`: **Intentional adaptation**; QA text and notes are separate textareas.

- [x] `src-ui/screens/glossary-import-modal.js` -> `src-ui/screens/qa-list-import-modal.js`
  - [x] QA import modal added and wired to actions plus native/browser drop handling.

## Rust File-Level Checklist

Rust already has better file-level parity than JS:

- [x] `src-tauri/src/glossary_storage/mod.rs` -> `src-tauri/src/qa_list_storage/mod.rs`
- [x] `src-tauri/src/glossary_storage/io.rs` -> `src-tauri/src/qa_list_storage/io.rs`
- [x] `src-tauri/src/glossary_storage/terms.rs` -> `src-tauri/src/qa_list_storage/terms.rs`
- [x] `src-tauri/src/glossary_storage/tmx.rs` -> `src-tauri/src/qa_list_storage/tmx.rs`
- [x] `src-tauri/src/glossary_repo_sync.rs` -> `src-tauri/src/qa_list_repo_sync.rs`

## Rust Function Checklist

### Storage `mod.rs`

- [x] Public async commands: `list_local`, `load_editor_data`, `load_term`, `initialize_repo`, `import_tmx`, `inspect_tmx`, `export_tmx`, `prepare_local_repo`, `rename`, `soft_delete`, `restore`, `purge_local_repo`, `upsert_term`, `rollback_term_upsert`, `delete_term`: **Adapted** one-to-one.
- [x] Sync implementations: `*_sync` functions for all public commands: **Adapted** one-to-one.
- [x] Repo path helpers: `normalized_optional_identifier`, matcher, finder, repo path, git repo path, desired repo path: **Adapted** one-to-one.
- [x] JSON/read/build/count/load/map helpers: **Adapted** one-to-one.
- [x] Tests: fixture-specific glossary tests differ from QA tests intentionally. QA includes multi-language rejection test, which is intentional.
- [x] Review function-level internals for drift after JS refactor, but no file split is currently needed.

### Storage `io.rs`

- [x] `read_json_file` -> `read_json_file`: **Identical candidate**.
- [x] `ensure_gitattributes` -> `ensure_gitattributes`: **Identical candidate**.
- [x] `git_output` -> `git_output`: **Identical candidate**.
- [x] `write_json_pretty` -> `write_json_pretty`: **Identical candidate**.
- [x] `write_text_file` -> `write_text_file`: **Identical candidate**.
- Reuse candidate: **Share** this module instead of duplicating it under both storage folders.

### Storage `terms.rs`

- [x] `sanitize_term_values` -> `sanitize_term_values`: **Currently identical**.
- [x] `trim_non_empty_term_values` -> `trim_non_empty_term_values`: **Currently identical**.
- [x] `has_duplicate_term_values` -> `has_duplicate_term_values`: **Currently identical**.
- [x] `has_conflicting_source_terms` -> `has_conflicting_source_terms`: **Currently identical**.
- [x] `sanitize_target_term_pairs` -> `sanitize_target_term_pairs`: **Currently identical**.
- [x] `merge_note_text` -> `merge_note_text`: **Currently identical**.
- Reuse candidate: **Share** this module. QA may not need all glossary target-pair helpers, but duplicated identical code is unnecessary.

### Storage `tmx.rs`

- [x] `parse_tmx_glossary` -> `parse_tmx_qa_list`: **Intentional adaptation**; QA must reject multi-language files and creates one-language terms.
- [x] `serialize_tmx_glossary` -> `serialize_tmx_qa_list`: **Intentional adaptation**.
- [x] XML escaping helpers: **Share candidate**.
- [x] title cleanup / clean text / language normalization / language lookup helpers: **Share candidate**.
- [x] QA `tmx.rs` includes JS language-map extraction helpers not mirrored in glossary. Decision: defer Rust language-helper extraction until a shared Rust storage-helper pass; current parser differences are intentional because QA rejects multi-language TMX.

### Repo Sync

- [x] `sync_gtms_glossary_repos` -> `sync_gtms_qa_list_repos`: **Adapted**.
- [x] `sync_gtms_glossary_editor_repo` -> `sync_gtms_qa_list_editor_repo`: **Adapted**.
- [x] sync implementations, term change detection, snapshot error, inspect state, repo matcher/finder, clone/sync/enforce version/mark synced: **Adapted** one-to-one.
- Reuse candidate: **Share** most of repo sync through a generic resource descriptor, with resource-specific names, file names, and command wrappers.

## Tests To Add Or Move

- [x] Add JS parity tests for QA top-level loading: cache seed, local seed, immediate spinner, page sync badge.
- [x] Add JS parity tests for QA lifecycle guards: rename/delete/restore/permanent delete during refresh/write and offline.
- [x] Add JS parity tests for QA editor refresh spinner during term writes and editor loading.
- [x] Add JS parity tests for QA create/import progress and rollback behavior.
- [x] Keep QA-specific tests for single-language TMX rejection and per-language defaults.
- [x] Rust tests already cover core QA storage/sync parity; add tests only if shared modules are extracted.

## Shared-Code Opportunities

Before duplicating more QA files, prefer these shared abstractions:

1. **Generic top-level resource discovery flow**
   - Inputs: resource names, page state, selected team, cache seed, local seed, query options, apply snapshot, persistence, progress text.
   - Would serve Projects, Glossaries, and QA Lists.

2. **Generic top-level lifecycle controller**
   - Inputs: resource lookup, permission guard, tombstone guard, query mutation factories, modal state fields, metadata/local commit callback.
   - Would remove most duplication between glossary lifecycle and QA lifecycle.

3. **Generic import/create resource flow**
   - Inputs: file type, inspect/import commands, repo create/prepare/delete functions, metadata write strategy, validation, post-create open action.
   - Glossary and QA can share byte reading, dropped-file handling, progress, rollback, and page write coordination.

4. **Generic editor snapshot guard**
   - Inputs: selected resource context, editor state, open draft predicate, active write predicate, payload normalization/apply function.
   - Glossary and QA editor cache/background-refresh behavior should use the same guard.

5. **Generic repo sync core**
   - Rust repo sync files are structurally identical enough to share a generic implementation behind resource-specific wrappers.
   - JS repo-flow repair/rebuild/state-resolution can also become generic.

6. **Shared Rust storage helpers**
   - `io.rs` and much of `terms.rs` are duplicated and should become shared modules.
   - TMX XML escape/title/language helpers should be shared while parsers remain resource-specific.

## Recommended Refactor Order

1. [x] Split `qa-list-flow.js` into facade plus focused files without behavior changes.
2. [x] Add missing QA file pairs: discovery, lifecycle, import, export, editor, term draft, top-level state, write coordinators, term sync, optional background sync. Done for discovery/lifecycle/import/export/editor/term draft/top-level state/write coordinator/term sync; background sync is explicitly deferred because QA has no background-sync session yet.
3. [x] Port glossary shared controller usage into QA lifecycle/create/import/discovery. Done for lifecycle, discovery, create, and import.
4. [x] Fix screen parity after flow parity: QA card disabled states, repo resolution, import modal, editor spinner.
5. Extract shared JS helpers only after the QA files match the glossary shape, so shared abstractions are based on proven matching code.
6. Review Rust for shared helper extraction after JS parity is stable; Rust already has file-level parity.
