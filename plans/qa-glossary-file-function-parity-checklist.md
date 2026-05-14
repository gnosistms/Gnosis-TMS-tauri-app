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
  - [ ] `glossaryMetadataRecord` -> `qaListMetadataRecord`: **Adapt** only if QA metadata records exist or are introduced; otherwise document why QA uses repo metadata directly.
  - [ ] `commitGlossaryMutationStrict` -> `commitQaListMutationStrict`: **Deferred** until QA has glossary-style team metadata records; current QA commit is isolated in the lifecycle file and uses repo/local commands directly.
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

- [ ] `src-ui/app/glossary-import-flow.js` -> `src-ui/app/qa-list-import-flow.js`
  - [ ] `detectGlossaryImportFileType` -> `detectQaListImportFileType`: **Copy/adapt**; TMX only.
  - [ ] `readableImportFileLike` -> `readableImportFileLike`: **Share**.
  - [ ] `droppedPathFileLike` -> `droppedPathFileLike`: **Share**.
  - [ ] `importFileName` -> `importFileName`: **Share**.
  - [ ] `decodeBase64ToBytes` -> `decodeBase64ToBytes`: **Share**.
  - [ ] `importFileBytes` -> `importFileBytes`: **Share**.
  - [ ] `glossaryImportModalState` -> `qaListImportModalState`: **Adapt**; QA currently has no import modal, so either add matching modal state or explicitly document if we keep direct picker.
  - [ ] `setGlossaryImportError` -> `setQaListImportError`: **Copy/adapt**.
  - [ ] `setGlossariesPageProgress` -> `setQaListsPageProgress`: **Copy/adapt**.
  - [ ] `remoteGlossaryRepoUrl` -> `remoteQaListRepoUrl`: **Copy/adapt**.
  - [ ] `prepareLocalGlossaryRepo` -> `prepareLocalQaListRepo`: **Copy/adapt**; may call existing QA repo function.
  - [ ] `linkedGlossaryMetadataRecord` -> `linkedQaListMetadataRecord`: **Adapt** if QA metadata is introduced; otherwise document the repo metadata alternative.
  - [ ] `normalizedText` -> `normalizedText`: **Share**.
  - [ ] `normalizedLanguageCode` -> `normalizedLanguageCode`: **Share**.
  - [ ] `languageMatches` -> `languageMatches`: **Share/adapt**; QA compares one language.
  - [ ] `importedGlossarySafetyError` -> `importedQaListSafetyError`: **Copy/adapt**.
  - [ ] `findImportedRemoteRepo` -> `findImportedRemoteRepo`: **Share**.
  - [ ] `repairIssueMatchesImportedGlossary` -> `repairIssueMatchesImportedQaList`: **Adapt** if QA metadata repair exists.
  - [ ] `verifyImportedGlossaryState` -> `verifyImportedQaListState`: **Copy/adapt**; QA should verify one language and term count.
  - [ ] `rollbackStrictGlossaryCreate` -> `rollbackStrictQaListCreate`: **Copy/adapt**.
  - [ ] `createRemoteGlossaryRepoForAvailableName` -> `createRemoteQaListRepoForAvailableName`: **Copy/adapt**.
  - [ ] `completeGlossaryCreateSynchronously` -> `completeQaListCreateSynchronously`: **Rewrite/adapt**; current QA create does the work inline and lacks progress/strict verification.
  - [ ] `reloadGlossariesAfterWrite` -> `reloadQaListsAfterWrite`: **Copy/adapt**.
  - [ ] `openGlossaryCreation` -> `openQaListCreation`: **Rewrite/adapt**; current QA lacks `guardResourceCreateStart`.
  - [ ] `cancelGlossaryCreation` -> `cancelQaListCreation`: **Copy/adapt**.
  - [ ] `updateGlossaryCreationField` -> `updateQaListCreationField`: **Copy/adapt**; one language field only.
  - [ ] `submitGlossaryCreation` -> `submitQaListCreation`: **Rewrite/adapt**; current QA bypasses `submitResourcePageWrite`.
  - [ ] `canOpenGlossaryImport` -> `canOpenQaListImport`: **Copy/adapt**.
  - [ ] `openGlossaryImportModal` -> `openQaListImportModal`: **Copy/adapt** if adding QA import modal.
  - [ ] `cancelGlossaryImportModal` -> `cancelQaListImportModal`: **Copy/adapt** if adding QA import modal.
  - [ ] `importGlossaryFromTmx` -> `importQaListFromTmx`: **Rewrite/adapt**; current QA creates a hidden input directly.
  - [ ] `selectGlossaryImportFile` -> `selectQaListImportFile`: **Copy/adapt**.
  - [ ] `importGlossaryFile` -> `importQaListFile`: **Rewrite/adapt**; preserve single-language validation.
  - [ ] `handleDroppedGlossaryImportFile` -> `handleDroppedQaListImportFile`: **Copy/adapt** if QA import modal supports drag/drop.
  - [ ] `handleDroppedGlossaryImportPath` -> `handleDroppedQaListImportPath`: **Copy/adapt** if QA import modal supports drag/drop.
  - Reuse candidate: **Share** file-type detection, byte reading, dropped-file handling, remote repo name allocation, resource-create progress, rollback scaffolding.

### Export

- [ ] `src-ui/app/glossary-export-flow.js` -> `src-ui/app/qa-list-export-flow.js`
  - [ ] `selectedTeam` -> `selectedTeam`: **Share or adapt** to `qa-list-shared`.
  - [ ] `sanitizeTmxFileName` -> `sanitizeTmxFileName`: **Share**.
  - [ ] `saveTmxFilePath` -> `saveTmxFilePath`: **Share**.
  - [ ] `downloadGlossaryAsTmx` -> `downloadQaListAsTmx`: **Rewrite/adapt**; current QA export is inside monolith and should move here. Keep QA-specific command and file labels.

### Editor Flow

- [ ] `src-ui/app/glossary-editor-flow.js` -> `src-ui/app/qa-list-editor-flow.js`
  - [ ] `resolveGlossaryForEditor` -> `resolveQaListForEditor`: **Copy/adapt**.
  - [x] `glossaryEditorContext` -> `qaListEditorContext`: **Adapted**; move to editor flow file.
  - [x] `glossaryEditorContextMatches` -> `qaListEditorContextMatches`: **Adapted**; move to editor flow file.
  - [x] `glossaryEditorPayloadMatches` -> `qaListEditorPayloadMatches`: **Adapted**; move to editor flow file.
  - [x] `glossaryEditorHasOpenDraft` -> `qaListEditorHasOpenDraft`: **Adapted**.
  - [x] `glossaryEditorHasActiveTermWrite` -> `qaListEditorHasActiveTermWrite`: **Adapted**.
  - [ ] `glossaryEditorHasActiveBackgroundSync` -> `qaListEditorHasActiveBackgroundSync`: **Adapt** if QA gets background sync; otherwise document no QA background sync.
  - [x] `glossaryEditorHasPendingLocalTerms` -> `qaListEditorHasPendingLocalTerms`: **Adapted**.
  - [x] `canApplyGlossaryEditorSnapshot` -> `canApplyQaListEditorSnapshot`: **Adapted**.
  - [x] `maybeApplyGlossaryEditorSnapshot` -> `maybeApplyQaListEditorSnapshot`: **Adapted**.
  - [ ] `primeSelectedGlossaryEditorLoadingState` -> `primeSelectedQaListEditorLoadingState`: **Rewrite/adapt**; current QA differs on cached data and refresh state.
  - [ ] `loadSelectedGlossaryEditorData` -> `loadSelectedQaListEditorData`: **Rewrite/adapt**; match page sync, invalidate/fetch query, stale context, preserve visible data, and error handling.
  - [ ] `openGlossaryEditor` -> `openQaListEditor`: **Rewrite/adapt**; match cache-first render and background refresh behavior.
  - [x] `updateGlossaryTermSearchQuery` -> `updateQaTermSearchQuery`: **Adapted**.
  - [ ] `deleteGlossaryTerm` -> move `deleteQaTerm` to `qa-term-draft.js` or keep editor-level delete only if glossary does; align boundary.
  - Reuse candidate: **Share** editor snapshot guard mechanics across glossary and QA.

### Term Draft / Term Writes

- [ ] `src-ui/app/glossary-term-draft.js` -> `src-ui/app/qa-term-draft.js`
  - [ ] `normalizeSourceTermForDuplicateDetection` -> `normalizeQaTermTextForDuplicateDetection`: **Adapt**; QA checks one text field.
  - [ ] `findRedundantSourceVariantIndices` -> `qaTermTextDuplicatesExistingTerm`: **Adapt**; no variant indices, but same duplicate policy.
  - [ ] `syncGlossaryTermDuplicateFeedbackDom` -> QA duplicate feedback handling: **Adapt**; QA can use modal error instead of per-variant red highlights.
  - [ ] `clearGlossaryTermDuplicateFeedback` -> QA duplicate feedback clear: **Adapt** if DOM feedback is added.
  - [ ] `refreshGlossaryTermDuplicateFeedback` -> QA duplicate feedback refresh: **Adapt** if DOM feedback is added.
  - [ ] `shouldRefreshGlossaryTermDuplicateFeedback` -> QA equivalent: **Adapt** if needed.
  - [ ] `createGlossaryTermEditorModalState` -> `createQaTermEditorModalState`: **Copy/adapt**; QA fields are `text` and `notes`.
  - [ ] `reopenGlossaryTermEditorWithLatestRemote` -> `reopenQaTermEditorWithLatestRemote`: **Copy/adapt**.
  - [ ] `rollbackGlossaryTermSave` -> `rollbackQaTermSave`: **Copy/adapt**; already exists in monolith.
  - [ ] `nextOptimisticClientTermId` -> `nextOptimisticClientQaTermId`: **Copy/adapt** if QA uses optimistic visible terms.
  - [ ] `showGlossaryEditorStatus` -> `showQaListEditorStatus`: **Copy/adapt**.
  - [ ] `clearGlossaryEditorStatus` -> `clearQaListEditorStatus`: **Copy/adapt**.
  - [ ] `restoreFailedGlossaryTermSave` -> `restoreFailedQaTermSave`: **Adapt** if QA adopts write coordinator.
  - [ ] `runGlossaryTermSaveIntent` -> `runQaTermSaveIntent`: **Adapt** if QA adopts write coordinator.
  - [x] `openGlossaryTermEditor` -> `openQaTermEditor`: **Adapted**; move from monolith.
  - [x] `cancelGlossaryTermEditor` -> `cancelQaTermEditor`: **Adapted**; move from monolith.
  - [x] `updateGlossaryTermDraftField` -> `updateQaTermDraftField`: **Adapted**; move from monolith.
  - [x] Variant mutators (`updateGlossaryTermVariant`, `updateGlossaryTermVariantNote`, `addGlossaryTermVariant`, `addGlossaryTermEmptyTargetVariant`, `removeGlossaryTermVariant`, `moveGlossaryTermVariantToIndex`): **Intentional no QA equivalent**; QA has no variants.
  - [ ] `submitGlossaryTermEditor` -> `submitQaTermEditor`: **Rewrite/adapt**; current QA implementation should move and match remote freshness, rollback, status badges, query invalidation, and duplicate checks.
  - [ ] `deleteGlossaryTerm` -> `deleteQaTerm`: **Rewrite/adapt**; current QA implementation should move and match remote freshness, rollback, and status behavior.
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

- [ ] `src-ui/app/glossary-query.js` -> `src-ui/app/qa-list-query.js`
  - [x] `resetGlossariesQueryObserver` -> `resetQaListsQueryObserver`: **Adapted**.
  - [x] `glossaryRepoSyncByRepoName` -> `qaListRepoSyncByRepoName`: **Adapted**.
  - [ ] `createGlossariesQuerySnapshot` -> `createQaListsQuerySnapshot`: **Adapted but review**; QA lacks broker warning/sync issue fields used by glossary UI.
  - [ ] `applyGlossaryWriteIntentOverlay`: **No QA equivalent**; add if QA gets a write coordinator or confirm query preservation is sufficient.
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
  - [ ] `preservePendingGlossaryLifecyclePatches` -> QA alias: **Copy/adapt** for naming parity.
  - [x] `seedGlossariesQueryFromCache` -> `seedQaListsQueryFromCache`: **Adapted**.
  - [x] `seedGlossariesQueryFromLocal` -> `seedQaListsQueryFromLocal`: **Adapted**.
  - [ ] `createGlossariesQueryOptions` -> `createQaListsQueryOptions`: **Adapted but incomplete**; QA should match offline/recovery/progress semantics.
  - [x] `ensureGlossariesQueryObserver` -> `ensureQaListsQueryObserver`: **Adapted**.
  - [x] lifecycle mutation factory and public mutation options: **Adapted**.
  - [x] `invalidateGlossariesQueryAfterMutation` -> `invalidateQaListsQueryAfterMutation`: **Adapted**.
  - [x] `persistQaListsQueryDataForTeam`: **QA-only helper**; acceptable but consider corresponding glossary helper or moving persistence into shared top-level state.

- [x] `src-ui/app/glossary-editor-query.js` -> `src-ui/app/qa-list-editor-query.js`
  - [x] `glossaryId` -> `qaListId`: **Adapted**.
  - [x] `glossaryRepoName` -> `qaListRepoName`: **Adapted**.
  - [x] query key, snapshot context, query options, get/set/remove cache: **Adapted**.

- [ ] `src-ui/app/glossary-cache.js` -> `src-ui/app/qa-list-cache.js`
  - [x] `loadStoredGlossariesForTeam` -> `loadStoredQaListsForTeam`: **Adapted**.
  - [x] `saveStoredGlossariesForTeam` -> `saveStoredQaListsForTeam`: **Adapted**.
  - [x] `removeStoredGlossariesForTeam` -> `removeStoredQaListsForTeam`: **Adapted**.

- [x] `src-ui/app/glossary-default-cache.js` -> `src-ui/app/qa-list-default-cache.js`
  - QA is intentionally per-language, so function names and data shape differ.

### Repo Flow

- [ ] `src-ui/app/glossary-repo-flow.js` -> `src-ui/app/qa-list-repo-flow.js`
  - Current state: QA repo flow is much smaller.
  - [ ] `normalizeGlossaryBrokerError` -> `normalizeQaListBrokerError`: **Copy/adapt**.
  - [ ] metadata repair functions (`repairGlossaryMetadataFromRemoteRename`, `finalizeMissingGlossariesForTeam`, `metadataBackedGlossaryRepo`, `findMatchingRemoteGlossary`, `buildMetadataBackedGlossarySyncRepos`, `countRecoverableGlossaryMetadataRecords`): **Adapt or document not applicable** depending on QA metadata strategy.
  - [ ] `normalizeRemoteGlossaryRepo` -> `normalizeRemoteQaListRepo`: **Copy/adapt**.
  - [ ] `glossaryRepoSyncDescriptor` -> `qaListRepoSyncDescriptor`: **Copy/adapt**; current `qaListRepoDescriptor` is similar but not structurally paired.
  - [x] `getGlossarySyncIssueMessage` -> `getQaListSyncIssueMessage`: **Adapted**.
  - [x] `listRemoteGlossaryReposForTeam` -> `listRemoteQaListReposForTeam`: **Adapted**, but add broker error normalization.
  - [x] `syncGlossaryReposForTeam` -> `syncQaListReposForTeam`: **Adapted**, but add update-required prompt parity if needed.
  - [x] `listLocalGlossarySummariesForTeam` -> `listLocalQaListsForTeam`: **Adapted**.
  - [ ] `ensureGlossaryNotTombstoned` -> `ensureQaListNotTombstoned`: **Copy/adapt**; missing and needed for lifecycle parity.
  - [ ] `loadRepoBackedGlossariesForTeam` -> `loadRepoBackedQaListsForTeam`: **Rewrite/adapt**; current QA query manually lists remote, syncs, lists local, merges metadata.
  - [x] `createRemoteGlossaryRepoForTeam` -> `createRemoteQaListRepo`: **Adapted**.
  - [x] `permanentlyDeleteRemoteGlossaryRepoForTeam` -> `deleteRemoteQaListRepo`: **Adapted**.
  - [ ] `repairGlossaryRepoBinding` -> `repairQaListRepoBinding`: **Copy/adapt** if QA can have missing local repo bindings.
  - [ ] `rebuildGlossaryLocalRepo` -> `rebuildQaListLocalRepo`: **Copy/adapt** if QA can rebuild from GitHub.
  - [x] `syncSingleGlossaryForTeam` -> `syncSingleQaListForTeam`: **Adapted**.
  - Reuse candidate: **Share** repo sync issue parsing, remote repo normalization, missing-repo resolution UI, tombstone checks, and repair/rebuild wrappers.

### Shared State And Coordinators

- [ ] `src-ui/app/glossary-shared.js` -> `src-ui/app/qa-list-shared.js`
  - [x] `selectedTeam` -> `selectedTeam`: **Adapted**.
  - [x] `canManageGlossaries` -> `canManageQaLists`: **Adapted**.
  - [ ] `canCreateGlossaries` -> `canCreateQaLists`: **Copy/adapt**; QA currently relies on resource capabilities.
  - [ ] `canPermanentlyDeleteGlossaries` -> `canPermanentlyDeleteQaLists`: **Copy/adapt** if permissions are parallel.
  - [x] `sortGlossaries` -> `sortQaLists`: **Adapted**.
  - [x] `selectedGlossary` -> `selectedQaList`: **Adapted**.
  - [x] `selectedGlossaryRepoName` -> `selectedQaListRepoName`: **Adapted**.
  - [x] `normalizeGlossarySummary` -> `normalizeQaList`: **Adapted**.
  - [x] `normalizeGlossaryTerm` -> `normalizeQaTerm`: **Adapted**.
  - [ ] `applyGlossaryEditorPayload` -> QA editor payload applier: **Adapt/move** current `applyQaListEditorSnapshot`.
  - [x] `upsertGlossarySummary` -> `upsertQaList`: **Adapted**.
  - [x] editable variant helpers: **Intentional no QA equivalent**.
  - [x] `buildGlossaryTargetVariantGuidance`: **Intentional no QA equivalent**.
  - [x] `updateGlossaryTermArray`: **Intentional no QA equivalent**.

- [ ] `src-ui/app/glossary-top-level-state.js` -> `src-ui/app/qa-list-top-level-state.js`
  - [ ] `glossarySnapshotFromList` -> `qaListSnapshotFromList`: **Copy/adapt**.
  - [ ] `applyGlossarySnapshotToState` -> `applyQaListSnapshotToState`: **Copy/adapt**; currently embedded in query.
  - [ ] `persistGlossariesForTeam` -> `persistQaListsForTeam`: **Copy/adapt**.
  - [ ] `removeGlossaryFromState` -> `removeQaListFromState`: **Copy/adapt**.

- [x] `src-ui/app/glossary-write-coordinator.js` -> `src-ui/app/qa-list-write-coordinator.js`
  - [x] All title/lifecycle/repo intent key, scope, request/get, active checks, patch/apply/clear functions: **Adapted**; query snapshots now apply the QA write-intent overlay.

- [ ] `src-ui/app/glossary-term-write-coordinator.js` -> `src-ui/app/qa-term-write-coordinator.js`
  - [ ] All save intent key/scope/request/get/active/reset functions: **Copy/adapt** if QA term writes should match glossary term write behavior.

- [x] `src-ui/app/glossary-term-sync.js` -> `src-ui/app/qa-term-sync.js`
  - [x] `findGlossaryTermById` -> `findQaTermById`: **Adapted**.
  - [x] UI-field preservation helpers: **Adapted** to QA `text`/`notes`.
  - [x] visible term upsert/replace/confirm/fail/remove/stale/reload functions: **Adapted**.

- [ ] `src-ui/app/glossary-background-sync.js` -> `src-ui/app/qa-list-background-sync.js`
  - [ ] All session, active input, interval, dirty, exit sync, start/stop functions: **Adapt or explicitly defer**. Glossary editor has background sync; QA editor currently does not have a corresponding file.

- [x] `src-ui/app/glossary-ruby.js`
  - Intentional shared file. QA uses glossary ruby helpers directly. Do not duplicate.

### Actions

- [ ] `src-ui/app/actions/glossary-actions.js` -> `src-ui/app/actions/qa-actions.js`
  - [x] `createGlossaryActions` -> `createQaActions`: **Adapted**.
  - [x] `parseVariantAction`: **Intentional no QA equivalent**.
  - [ ] Add QA action imports for new split files through `qa-list-flow.js` facade after refactor.
  - [ ] Add QA import modal/dropped-file actions if we add `qa-list-import-modal.js`.
  - [ ] Add repair/rebuild QA list actions if QA repo resolution parity is implemented.

## JavaScript Screen Checklist

- [ ] `src-ui/screens/glossaries.js` -> `src-ui/screens/qa.js`
  - [x] `renderGlossaryLanguageFlow`: **Intentional QA equivalent is inline language name only**.
  - [ ] `renderGlossaryCard` -> `renderQaListCard`: **Adapt**, but add lifecycle/write disabled state, repo resolution state, repair/rebuild actions if supported.
  - [x] `renderDeletedGlossariesSection` -> `renderDeletedQaListsSection`: **Adapted**.
  - [ ] `renderGlossariesScreen` -> `renderQaScreen`: **Adapt**, but add recovery/broker warning markup, lifecycle/write disabled flags, sync snapshots, and status parity.

- [ ] `src-ui/screens/glossary-editor.js` -> `src-ui/screens/qa-list-editor.js`
  - [x] `shortenChapterNavLabel` -> `shortenChapterNavLabel`: **Copy/adapt**; could share.
  - [ ] `renderGlossaryEditorScreen` -> `renderQaListEditorScreen`: **Adapt**, but fix refresh spinner parity (`backgroundRefreshing`) and keep nav behavior aligned.
  - [x] `visibleTerms` filtering: **Intentional adaptation** for QA text/notes only.
  - [x] `renderTermCell` -> `renderTextCell`: **Intentional adaptation**.

- [x] `src-ui/screens/glossary-creation-modal.js` -> `src-ui/screens/qa-list-creation-modal.js`
  - [x] `renderLanguageOptions` -> `renderLanguageOptions`: **Copy/adapt**; possible shared helper.
  - [x] `renderGlossaryCreationModal` -> `renderQaListCreationModal`: **Adapted**, one language only.

- [x] `src-ui/screens/glossary-rename-modal.js` -> `src-ui/screens/qa-list-rename-modal.js`
  - [x] Render function: **Adapted**.

- [ ] `src-ui/screens/glossary-permanent-deletion-modal.js` -> `src-ui/screens/qa-list-permanent-deletion-modal.js`
  - [ ] Render function: **Adapt**, but align button loading markup/disabled semantics and copy style.

- [x] `src-ui/screens/glossary-term-editor-modal.js` -> `src-ui/screens/qa-term-editor-modal.js`
  - [x] `renderVariantRow` / `renderVariantLane`: **Intentional no QA equivalent**.
  - [x] `renderGlossaryTermEditorModal` -> `renderQaTermEditorModal`: **Intentional adaptation**; QA text and notes are separate textareas.

- [ ] `src-ui/screens/glossary-import-modal.js` -> `src-ui/screens/qa-list-import-modal.js`
  - [ ] Missing QA import modal. **Copy/adapt** if we want exact import UX parity.

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
- [ ] Review function-level internals for drift after JS refactor, but no file split is currently needed.

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
- [ ] QA `tmx.rs` includes JS language-map extraction helpers not mirrored in glossary. Decide whether to **Share** language lookup from a common Rust language module.

### Repo Sync

- [x] `sync_gtms_glossary_repos` -> `sync_gtms_qa_list_repos`: **Adapted**.
- [x] `sync_gtms_glossary_editor_repo` -> `sync_gtms_qa_list_editor_repo`: **Adapted**.
- [x] sync implementations, term change detection, snapshot error, inspect state, repo matcher/finder, clone/sync/enforce version/mark synced: **Adapted** one-to-one.
- Reuse candidate: **Share** most of repo sync through a generic resource descriptor, with resource-specific names, file names, and command wrappers.

## Tests To Add Or Move

- [ ] Add JS parity tests for QA top-level loading: cache seed, local seed, immediate spinner, page sync badge.
- [ ] Add JS parity tests for QA lifecycle guards: rename/delete/restore/permanent delete during refresh/write and offline.
- [ ] Add JS parity tests for QA editor refresh spinner during term writes and editor loading.
- [ ] Add JS parity tests for QA create/import progress and rollback behavior.
- [ ] Keep QA-specific tests for single-language TMX rejection and per-language defaults.
- [ ] Rust tests already cover core QA storage/sync parity; add tests only if shared modules are extracted.

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
2. [ ] Add missing QA file pairs: discovery, lifecycle, import, export, editor, term draft, top-level state, write coordinators, term sync, optional background sync. Done for discovery/lifecycle/import/export/editor/term draft/top-level state/write coordinator/term sync; background sync remains deferred.
3. [ ] Port glossary shared controller usage into QA lifecycle/create/import/discovery. Done for lifecycle and discovery; create/import still need the fuller glossary resource-create/import-modal flow.
4. [ ] Fix screen parity after flow parity: QA card disabled states, repo resolution, import modal, editor spinner.
5. Extract shared JS helpers only after the QA files match the glossary shape, so shared abstractions are based on proven matching code.
6. Review Rust for shared helper extraction after JS parity is stable; Rust already has file-level parity.
