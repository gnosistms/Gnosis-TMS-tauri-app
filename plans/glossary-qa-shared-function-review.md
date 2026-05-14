# Glossary / QA Lists Shared Function Review

Goal: review the glossary and QA list implementations file by file, list the functions in each file, and evaluate whether the same function could be modified to work for both resources.

Legend:

- **Share directly**: the same function can serve both with little or no change.
- **Share with config**: one generic function can serve both if passed labels, state slots, command names, normalizers, or resource-specific operations.
- **Keep separate**: the data model or behavior is sufficiently different that sharing would make the code harder to read or riskier.
- **Defer**: sharing is possible, but only after another missing layer exists, usually QA team metadata or QA background sync.

## High-Level Conclusion

Most duplicated infrastructure can be shared, especially cache/query wrappers, import/export byte handling, lifecycle guards, editor snapshot guards, repo sync mechanics, write coordinators, and Rust repo/storage path helpers.

The main places that should remain separate, or only share lower-level helpers, are:

- Term editing: glossary terms have source variants, target variants, target variant notes, global notes, footnotes, untranslated flags, and drag/reorder behavior; QA terms have one text plus notes.
- Defaults: glossary has one default per team; QA has one default per language.
- TMX parsing/serialization: glossary is bilingual/multi-variant; QA is single-language and must reject multi-language TMX.
- Metadata repair/rebuild: glossary has team metadata records; QA currently uses repo metadata directly.
- Background sync: glossary editor has a background sync session; QA editor currently does not.

## JavaScript App Files

### `src-ui/app/glossary-flow.js` / `src-ui/app/qa-list-flow.js`

Functions: none. These are facades.

Assessment: **Share directly** is not relevant. The facade shape is already equivalent. Keep separate files for public import ergonomics, or replace both with a generated/export map only if the module graph becomes cumbersome.

### `glossary-discovery-flow.js` / `qa-list-discovery-flow.js`

Functions:

- `glossariesPageOwnsTeam` / `qaListsPageOwnsTeam`: **Share with config**. Needs page-state selector, selected team key, cache key.
- `primeGlossariesLoadingState` / `primeQaListsLoadingState`: **Share with config**. Needs resource label, state fields, cache loader, selected-resource preservation rules.
- `isGlossaryLoadCurrent` / `isQaListLoadCurrent`: **Share with config**. Same stale-load guard.
- `loadTeamGlossaries` / `loadTeamQaLists`: **Share with config**. Same cache seed, local seed, query observer, page sync, progress and stale guard pattern.

Recommendation: Extract a generic `createRepoResourceDiscoveryFlow(config)` after projects/glossaries/QA settle around the same loading contract.

### `glossary-lifecycle-flow.js` / `qa-list-lifecycle-flow.js`

Functions:

- `glossaryById` / `qaListById`: **Share with config**.
- `lifecycleActionBlockedMessage` / `qaListLifecycleActionBlockedMessage`: **Share with config** for labels and permission predicates.
- `glossaryMetadataRecord`: **Defer**. QA has no equivalent team metadata record yet.
- `commitGlossaryMutationStrict` / `commitQaListLifecycleMutation`: **Share with config after metadata parity**. Today glossary is metadata-first; QA is repo/local-command-first.
- `glossaryWriteBlockedMessage` / `qaListWriteBlockedMessage`: **Share with config**.
- `glossaryLifecycleWriteBlockedMessage` / `qaListLifecycleWriteBlockedMessage`: **Share with config**.
- `areGlossaryLifecycleWritesDisabled` / `areQaListLifecycleWritesDisabled`: **Share directly** if page state is injected.
- `areGlossaryHeavyWritesDisabled` / `areQaListHeavyWritesDisabled`: **Share with config** for mutating-write predicate.
- `toggleDeletedGlossaries` / `toggleDeletedQaLists`: **Share with config**.
- `openGlossaryRename` / `openQaListRename`: **Share with config**.
- `updateGlossaryRenameName` / `updateQaListRenameName`: **Share with config**.
- `cancelGlossaryRename` / `cancelQaListRename`: **Share with config**.
- `submitGlossaryRename` / `submitQaListRename`: **Share with config**, except commit function differs until metadata parity.
- `deleteGlossary` / `deleteQaList`: **Share with config**, except commit function differs until metadata parity.
- `restoreGlossary` / `restoreQaList`: **Share with config**, except commit function differs until metadata parity.
- `openGlossaryPermanentDeletion` / `openQaListPermanentDeletion`: **Share with config**.
- `updateGlossaryPermanentDeletionConfirmation` / `updateQaListPermanentDeletionConfirmation`: **Share with config**.
- `cancelGlossaryPermanentDeletion` / `cancelQaListPermanentDeletion`: **Share with config**.
- `confirmGlossaryPermanentDeletion` / `confirmQaListPermanentDeletion`: **Share with config**, with resource-specific remote delete/purge operations.

Recommendation: Good candidate for a shared lifecycle controller, but only after deciding whether QA gets metadata records.

### `glossary-import-flow.js` / `qa-list-import-flow.js`

Functions:

- `detectGlossaryImportFileType` / `detectQaListImportFileType`: **Share with config**. Same extension detection, different allowed set currently.
- `readableImportFileLike`: **Share directly**.
- `droppedPathFileLike`: **Share directly**.
- `importFileName`: **Share directly**.
- `decodeBase64ToBytes`: **Share directly**.
- `importFileBytes`: **Share directly**.
- `glossaryImportModalState` / `qaListImportModalState`: **Share with config** for state slot.
- `setGlossaryImportError` / `setQaListImportError`: **Share with config** for state slot.
- `setGlossariesPageProgress` / `setQaListsPageProgress`: **Share with config**.
- `remoteGlossaryRepoUrl` / `remoteQaListRepoUrl`: **Share directly**.
- `prepareLocalGlossaryRepo` / `prepareLinkedLocalQaListRepo`: **Share with config** for repo prepare command/helper.
- `linkedGlossaryMetadataRecord`: **Defer**. QA has no linked metadata record yet.
- `normalizedText`: **Share directly**.
- `normalizedLanguageCode`: **Share directly**.
- `languageMatches`: **Share directly** with one/two-language expectations injected.
- `importedGlossarySafetyError` / `importedQaListSafetyError`: **Share with config** for resource label.
- `findImportedRemoteRepo`: **Share directly**.
- `repairIssueMatchesImportedGlossary`: **Defer**. QA has no repair issue layer yet.
- `verifyImportedGlossaryState` / `verifyImportedQaListState`: **Share with config** for language validation shape and local list command.
- `rollbackStrictGlossaryCreate` / `rollbackStrictQaListCreate`: **Share with config** for purge/delete commands.
- `createRemoteGlossaryRepoForAvailableName` / `createRemoteQaListRepoForAvailableName`: **Share with config**.
- `completeGlossaryCreateSynchronously` / `completeQaListCreateSynchronously`: **Share with config** for initialize command, metadata write strategy, and language fields.
- `reloadGlossariesAfterWrite` / `reloadQaListsAfterWrite`: **Share with config**.
- `openGlossaryCreation` / `openQaListCreation`: **Share with config** for creation fields.
- `cancelGlossaryCreation` / `cancelQaListCreation`: **Share with config**.
- `updateGlossaryCreationField` / `updateQaListCreationField`: **Share with config** for valid fields.
- `submitGlossaryCreation` / `submitQaListCreation`: **Share with config** for language shape and create operation.
- `canOpenGlossaryImport` / `canOpenQaListImport`: **Share with config**.
- `openGlossaryImportModal` / `openQaListImportModal`: **Share with config**.
- `cancelGlossaryImportModal` / `cancelQaListImportModal`: **Share with config**.
- `importGlossaryFromTmx` / `importQaListFromTmx`: **Share with config**.
- `selectGlossaryImportFile` / `selectQaListImportFile`: **Share with config**.
- `importGlossaryFile` / `importQaListFile`: **Share with config**, but the import/inspect commands and language validation are resource-specific.
- `handleDroppedGlossaryImportFile` / `handleDroppedQaListImportFile`: **Share with config**.
- `handleDroppedGlossaryImportPath` / `handleDroppedQaListImportPath`: **Share with config**.
- QA-only `textContent`, `normalizeTmxLanguageCode`, `tmxNodeLanguageCode`, `parseQaListTmx`: **Keep separate or move to QA-specific parser module**. Glossary import does not use this JS parser path.

Recommendation: Extract shared import/create scaffolding, not a single all-in-one import function.

### `glossary-export-flow.js` / `qa-list-export-flow.js`

Functions:

- `selectedTeam`: **Share directly** or remove local duplication by importing shared selected team.
- `sanitizeTmxFileName`: **Share directly**.
- `saveTmxFilePath`: **Share directly**.
- `downloadGlossaryAsTmx` / `downloadQaListAsTmx`: **Share with config** for selected resource, command name, filename builder, and labels.

Recommendation: Strong shared-helper candidate.

### `glossary-editor-flow.js` / `qa-list-editor-flow.js`

Functions:

- `resolveGlossaryForEditor` / `resolveQaListForEditor`: **Share with config**.
- `selectedQaListEditorMatches`: **Share with config**; glossary equivalent is embedded in context matching.
- `glossaryEditorContext` / `qaListEditorContext`: **Share with config**.
- `glossaryEditorContextMatches` / `qaListEditorContextMatches`: **Share with config**.
- `glossaryEditorPayloadMatches` / `qaListEditorPayloadMatches`: **Share with config**.
- `glossaryEditorHasOpenDraft` / `qaListEditorHasOpenDraft`: **Share with config**.
- `glossaryEditorHasActiveTermWrite` / `qaListEditorHasActiveTermWrite`: **Share with config**.
- `glossaryEditorHasActiveBackgroundSync` / `qaListEditorHasActiveBackgroundSync`: **Share with config**, but QA currently returns false.
- `glossaryEditorHasPendingLocalTerms` / `qaListEditorHasPendingLocalTerms`: **Share with config**.
- `canApplyGlossaryEditorSnapshot` / `canApplyQaListEditorSnapshot`: **Share with config**.
- `maybeApplyGlossaryEditorSnapshot` / `maybeApplyQaListEditorSnapshot`: **Share with config**.
- QA-only `loadRepoBackedQaListEditorSnapshot`, `applyQaListEditorSnapshot`, `syncAndRefreshQaListEditorSnapshot`, `resolveDefaultQaListForLanguage`, `openEditorQaList`, `applyQaListEditorSummary`: **Share partially**. Some are QA-specific because editor QA opens by active target language/default QA list. The generic pieces are snapshot application and summary priming.
- `primeSelectedGlossaryEditorLoadingState` / `primeSelectedQaListEditorLoadingState`: **Share with config**.
- `loadSelectedGlossaryEditorData` / `loadSelectedQaListEditorData`: **Share with config** for query options, tombstone guard, sync operation, payload applier.
- `openGlossaryEditor` / `openQaListEditor`: **Share with config**, except glossary background-sync start/stop.
- `updateGlossaryTermSearchQuery` / `updateQaTermSearchQuery`: **Share with config**.
- `deleteGlossaryTerm`: **Do not share from editor flow**. QA keeps term delete in `qa-term-draft.js`; better move glossary delete into term draft or a generic term-write module before sharing.

Recommendation: Extract a generic editor snapshot guard first; defer full editor open/load unification until background sync is either shared or explicitly optional.

### `glossary-term-draft.js` / `qa-term-draft.js`

Functions:

- `normalizeSourceTermForDuplicateDetection` / `normalizeQaTermTextForDuplicateDetection`: **Share directly** as ruby-stripped text normalization.
- `findRedundantSourceVariantIndices` / `qaTermTextDuplicatesExistingTerm`: **Share partially**. Same duplicate policy, different result shape because glossary has variants.
- `syncGlossaryTermDuplicateFeedbackDom`, `clearGlossaryTermDuplicateFeedback`, `refreshGlossaryTermDuplicateFeedback`, `shouldRefreshGlossaryTermDuplicateFeedback`: **Keep separate**. Glossary has per-variant red highlights; QA uses modal error.
- `createGlossaryTermEditorModalState` / QA inline state in `openQaTermEditor`: **Share with config** if QA gets a named modal-state builder.
- `reopenGlossaryTermEditorWithLatestRemote`: **Share with config** if QA adopts the same stale-term reopening UI. Today QA uses simpler modal errors.
- `rollbackGlossaryTermSave` / `rollbackQaTermSave`: **Share with config** for rollback command and input builder.
- `nextOptimisticClientTermId`: **Keep separate or defer**. QA does not currently create optimistic visible terms.
- `showGlossaryEditorStatus`, `clearGlossaryEditorStatus`: **Defer**. QA does not currently use scoped status badges for term writes.
- `restoreFailedGlossaryTermSave`: **Defer**. QA has simpler restore behavior because it is not optimistic.
- `runGlossaryTermSaveIntent`: **Defer**. QA uses an active write counter/coordinator, not the same optimistic intent runner.
- `openGlossaryTermEditor` / `openQaTermEditor`: **Share with config** after modal-state builders align.
- `cancelGlossaryTermEditor` / `cancelQaTermEditor`: **Share with config**.
- `updateGlossaryTermDraftField` / `updateQaTermDraftField`: **Share with config** for valid fields and duplicate-feedback clearing.
- Glossary-only `updateGlossaryTermVariant`, `updateGlossaryTermVariantNote`, `addGlossaryTermVariant`, `addGlossaryTermEmptyTargetVariant`, `removeGlossaryTermVariant`, `moveGlossaryTermVariantToIndex`: **Keep separate**. QA has no variants.
- `submitGlossaryTermEditor` / `submitQaTermEditor`: **Share only lower-level pieces**: validation, rollback, sync, and persistence helpers. Full function should stay separate unless QA adopts optimistic term intents.
- QA-only `qaTermRecordsMatch`, `qaTermDuplicateErrorState`, `persistQaListEditorTerms`, `deleteQaTerm`: **Share partially**. `deleteQaTerm` could share a generic term-delete command scaffold; the rest are QA-specific state shape.

Recommendation: Do not force one full term editor function. Share duplicate normalization, rollback scaffolding, and repo command wrappers only.

### `glossary-term-inline-markup-flow.js` / `qa-term-inline-markup-flow.js`

Functions:

- `isGlossaryVariantTextarea` / `isQaTermTextarea`: **Share with config**.
- `glossaryInlineStyleButtons` / `qaTermInlineStyleButtons`: **Share with config**.
- `focusedGlossaryVariantTextarea` / `focusedQaTermTextarea`: **Share with config**.
- `clearGlossaryInlineStyleButtons` / `clearQaTermInlineStyleButtons`: **Share with config**.
- `syncGlossaryTermInlineStyleButtons` / `syncQaTermInlineStyleButtons`: **Share with config**.
- `resolveTargetTextarea`: **Keep separate**. QA has no source/target side distinction.
- `toggleGlossaryTermInlineStyle` / `toggleQaTermInlineStyle`: **Share with config**.

Recommendation: Extract a generic inline-markup controller.

### `glossary-default-flow.js` / `qa-list-default-flow.js`

Functions:

- `activeGlossariesExcept`, `compareDefaultCandidates`, `defaultGlossaryCandidateAfterDeletion`: **Keep separate or share only as list-selection helpers**. QA default is per-language.
- `activeDefaultGlossaryIdForTeam` / `activeDefaultQaListIdsForTeam`: **Keep separate**. Return shape differs.
- `defaultGlossaryForTeam` / `isDefaultQaList`: **Keep separate**. Semantics differ.
- `makeGlossaryDefault` / `makeQaListDefault`: **Share with config** if default store supports singleton and grouped-by-language modes.
- `makeGlossaryDefaultIfFirst` / `makeQaListDefaultIfFirst`: **Share with config**.
- `updateDefaultGlossaryAfterDeletion` / `updateDefaultQaListAfterDeletion`: **Share with config** for candidate selection mode.

Recommendation: Share a small “default resource store” helper, not the high-level default logic.

### `glossary-query.js` / `qa-list-query.js`

Functions:

- `resetGlossariesQueryObserver` / `resetQaListsQueryObserver`: **Share with config**.
- `glossaryRepoSyncByRepoName` / `qaListRepoSyncByRepoName`: **Share directly**.
- `createGlossariesQuerySnapshot` / `createQaListsQuerySnapshot`: **Share with config**.
- `createQaListDiscoverySnapshot`: **Share with config**; glossary has equivalent discovery state normalization in snapshot flow.
- `applyGlossaryWriteIntentOverlay` / QA inline overlay call: **Share with config**.
- `applyGlossariesQuerySnapshotToState` / `applyQaListsQuerySnapshotToState`: **Share with config**.
- `patchGlossaryQueryData` / `patchQaListQueryData`: **Share with config**.
- `normalizeGlossariesSnapshotInput`: **Share with config**; QA should get a named equivalent if extracted.
- `upsertQaListQueryData`: **Share with config**; glossary could use the same upsert helper if needed.
- `moveGlossaryToLifecycle` / `moveQaListToLifecycle`: **Share directly** with injected patch function.
- `removeGlossaryFromQueryData` / `removeQaListFromQueryData`: **Share with config**.
- `glossaryLifecycleIntent` / `qaListLifecycleIntent`: **Share directly**.
- `glossaryInSnapshot` / `qaListInSnapshot`: **Share with config**.
- `glossaryLocation` / `qaListLocation`: **Share with config**.
- `glossaryTitleInSnapshot` / `qaListTitleInSnapshot`: **Share with config**.
- `patchGlossaryInList` / `patchQaListInList`: **Share with config**.
- `preserveGlossaryLifecyclePatchesInSnapshot` / `preserveQaListLifecyclePatchesInSnapshot`: **Share with config**.
- `preservePendingGlossaryLifecyclePatches` / `preservePendingQaListLifecyclePatches`: **Share directly as alias factory**.
- `seedGlossariesQueryFromCache` / `seedQaListsQueryFromCache`: **Share with config**.
- `seedGlossariesQueryFromLocal` / `seedQaListsQueryFromLocal`: **Share with config**.
- `createGlossariesQueryOptions` / `createQaListsQueryOptions`: **Share with config**.
- `ensureGlossariesQueryObserver` / `ensureQaListsQueryObserver`: **Share with config**.
- `createGlossaryLifecycleMutationOptions` / `createQaListLifecycleMutationOptions`: **Share with config**.
- `createGlossaryRenameMutationOptions` / `createQaListRenameMutationOptions`: **Share with config**.
- `createGlossarySoftDeleteMutationOptions` / `createQaListSoftDeleteMutationOptions`: **Share with config**.
- `createGlossaryRestoreMutationOptions` / `createQaListRestoreMutationOptions`: **Share with config**.
- `createGlossaryPermanentDeleteMutationOptions` / `createQaListPermanentDeleteMutationOptions`: **Share with config**.
- `invalidateGlossariesQueryAfterMutation` / `invalidateQaListsQueryAfterMutation`: **Share with config**.
- `persistQaListsQueryDataForTeam`: **Share with config** if glossary moves query persistence into query module.

Recommendation: Strong candidate for a generic `repoResourceQueryController`.

### `glossary-editor-query.js` / `qa-list-editor-query.js`

Functions:

- `glossaryId` / `qaListId`: **Share with config**.
- `glossaryRepoName` / `qaListRepoName`: **Share with config**.
- `glossaryEditorQueryKey` / `qaListEditorQueryKey`: **Share with config**.
- `withGlossarySnapshotContext` / `withQaListSnapshotContext`: **Share with config**.
- `createGlossaryEditorQueryOptions` / `createQaListEditorQueryOptions`: **Share with config**.
- `getCachedGlossaryEditorPayload` / `getCachedQaListEditorPayload`: **Share with config**.
- `setCachedGlossaryEditorPayload` / `setCachedQaListEditorPayload`: **Share with config**.
- `removeGlossaryEditorQuery` / `removeQaListEditorQuery`: **Share with config**.

Recommendation: Excellent shared module candidate.

### `glossary-cache.js` / `qa-list-cache.js`

Functions:

- `loadStoredGlossariesForTeam` / `loadStoredQaListsForTeam`: **Share with config**.
- `saveStoredGlossariesForTeam` / `saveStoredQaListsForTeam`: **Share with config**.
- `removeStoredGlossariesForTeam` / `removeStoredQaListsForTeam`: **Share with config**.

Recommendation: Extract generic team-scoped resource cache.

### `glossary-default-cache.js` / `qa-list-default-cache.js`

Functions:

- `normalizeGlossaryId`: **Share directly** as normalized id helper.
- `loadStoredDefaultGlossaryIdForTeam` / `loadStoredDefaultQaListIdsForTeam`: **Share with config**, but return shape differs.
- `saveStoredDefaultGlossaryIdForTeam` / `saveStoredDefaultQaListIdForTeamLanguage`: **Share with config** if cache supports singleton and grouped defaults.
- `removeStoredDefaultGlossaryIdForTeam` / `removeStoredDefaultQaListIdForTeamLanguage`: **Share with config**.
- QA-only `teamDefaultsKey`: **Share directly** as key builder if generalized.

Recommendation: Generic default cache can support `mode: "singleton" | "byLanguage"`.

### `glossary-repo-flow.js` / `qa-list-repo-flow.js`

Functions:

- `ensureInvoke`: **Share directly**.
- `normalizeGlossaryBrokerError` / `normalizeQaListBrokerError`: **Share with config** for label.
- Glossary-only metadata repair functions: `repairGlossaryMetadataFromRemoteRename`, `finalizeMissingGlossariesForTeam`, `metadataBackedGlossaryRepo`, `findMatchingRemoteGlossary`, `buildMetadataBackedGlossarySyncRepos`, `countRecoverableGlossaryMetadataRecords`, `getMissingRemoteGlossaryMessage`, `glossaryMetadataRecordIsTombstone`, `glossaryMatchesMetadataRecord`, `purgeTombstonedGlossariesForTeam`, `repairGlossaryRepoBinding`, `rebuildGlossaryLocalRepo`: **Defer**. QA needs team metadata records before these can share meaningfully.
- `normalizeRemoteGlossaryRepo` / `normalizeRemoteQaListRepo`: **Share directly**.
- `glossaryRepoSyncDescriptor` / `qaListRepoSyncDescriptor`: **Share with config** for id field.
- `getGlossarySyncIssueMessage` / `getQaListSyncIssueMessage`: **Share with config** for label.
- `listRemoteGlossaryReposForTeam` / `listRemoteQaListReposForTeam`: **Share with config** for command.
- `syncGlossaryReposForTeam` / `syncQaListReposForTeam`: **Share with config** for command and payload key.
- `openRequiredAppUpdatePromptFromGlossarySnapshots`: **Share directly** if QA also opens update-required prompt.
- `listLocalGlossarySummariesForTeam` / `listLocalQaListsForTeam`: **Share with config** for command.
- `purgeLocalGlossaryRepo` / QA purge via import/lifecycle command: **Share with config** if exposed as named QA function.
- `persistVisibleGlossaries`: **Share with config** if QA visible persistence is moved here.
- `runGlossaryRepoPageSync`: **Share directly**.
- `ensureGlossaryNotTombstoned` / `ensureQaListNotTombstoned`: **Share with config**, once QA tombstone source is decided.
- `loadRepoBackedGlossariesForTeam` / `loadRepoBackedQaListsForTeam`: **Share with config**, with metadata-repair hooks optional.
- `createRemoteGlossaryRepoForTeam` / `createRemoteQaListRepoWithName`: **Share with config**.
- `createRemoteQaListRepo`: **QA-specific convenience wrapper**.
- `prepareLocalQaListRepo` / glossary prepare helper in import flow: **Share with config** if both are moved into repo flow.
- `permanentlyDeleteRemoteGlossaryRepoForTeam` / `deleteRemoteQaListRepo`: **Share with config**.
- `syncSingleGlossaryForTeam` / `syncSingleQaListForTeam`: **Share with config**.
- QA-only `teamSupportsQaListRepos`, `qaListRepoDescriptor`, `mergeQaListRepoMetadata`: **Share with config** or move to generic repo-resource helper.

Recommendation: High-value shared repo-resource module, but metadata-repair hooks must be optional.

### `glossary-shared.js` / `qa-list-shared.js`

Functions:

- `selectedTeam`: **Share directly**.
- `canManageGlossaries` / `canManageQaLists`: **Share with config** or direct permission helper.
- `canCreateGlossaries` / `canCreateQaLists`: **Share directly**.
- `canPermanentlyDeleteGlossaries` / `canPermanentlyDeleteQaLists`: **Share directly**.
- `sortGlossaries` / `sortQaLists`: **Share with config** for sort keys.
- `selectedGlossary` / `selectedQaList`: **Share with config**.
- `selectedGlossaryRepoName` / `selectedQaListRepoName`: **Share with config**.
- `normalizeGlossarySummary` / `normalizeQaList`: **Share partially**. Common repo/lifecycle fields can be shared; language fields differ.
- `normalizeGlossaryTerm` / `normalizeQaTerm`: **Keep separate** or share a common base plus resource-specific fields.
- `applyGlossaryEditorPayload` / `applyQaListEditorPayload`: **Share with config**.
- `upsertGlossarySummary` / `upsertQaList`: **Share with config**.
- Glossary-only editable variant helpers: `normalizeEditableTerms`, `isGlossaryEmptyTargetVariant`, `normalizeEditableTargetTerms`, `alignTargetVariantNotes`, `normalizeEditableTargetVariantNotes`, `sanitizeEditableTerms`, `sanitizeEditableTargetTerms`, `sanitizeEditableTargetTermPairs`, `mergeTargetVariantNoteText`, `buildGlossaryTargetVariantGuidance`, `updateGlossaryTermArray`: **Keep separate or move to glossary-term helpers**. QA has no variants.
- QA-only `normalizeId`, `createFallbackId`, `normalizeLanguage`: **Share directly or move to common resource normalizers**.

Recommendation: Share top-level resource normalizers and selection helpers, not term-shape-specific helpers.

### `glossary-top-level-state.js` / `qa-list-top-level-state.js`

Functions:

- `glossarySnapshotFromList` / `qaListSnapshotFromList`: **Share with config**.
- `applyGlossarySnapshotToState` / `applyQaListSnapshotToState`: **Share with config**.
- `persistGlossariesForTeam` / `persistQaListsForTeam`: **Share with config**.
- `removeGlossaryFromState` / `removeQaListFromState`: **Share with config**.
- QA-only `createQaResourceId`: **Share directly** as generic resource id helper.
- QA-only `currentQaListTeam`, `selectedQaListTeamMatches`: **Share with config**.
- QA-only `ensureQaListsQueryDataForTeam`, `applyQaListsQueryDataForTeam`, `upsertQaListForTeam`, `saveCurrentTeamQaLists`: **Share with config**; glossary has equivalents split across query/shared/cache.
- QA-only `repoBackedQaListInput`, `repoBackedQaTermRollbackInput`: **Share with config**.
- QA-only `triggerQaListRepoSync`, `syncSingleQaListOrThrow`: **Share with config**.
- QA-only `qaListCreationRollbackMessage`: **Share with config** for labels.

Recommendation: Consolidate top-level state/query persistence boundaries before sharing.

### `glossary-write-coordinator.js` / `qa-list-write-coordinator.js`

Functions:

- `resetGlossaryWriteCoordinator` / `resetQaListWriteCoordinator`: **Share with config**.
- `glossaryTitleIntentKey` / `qaListTitleIntentKey`: **Share with config**.
- `glossaryLifecycleIntentKey` / `qaListLifecycleIntentKey`: **Share with config**.
- `glossaryRepoSyncIntentKey` / `qaListRepoSyncIntentKey`: **Share with config**.
- `teamMetadataWriteScope` / `qaListTeamMetadataWriteScope`: **Share with config**.
- `requestGlossaryWriteIntent` / `requestQaListWriteIntent`: **Share with config**.
- `getGlossaryWriteIntent` / `getQaListWriteIntent`: **Share with config**.
- `anyGlossaryWriteIsActive` / `anyQaListWriteIsActive`: **Share with config**.
- `anyGlossaryMutatingWriteIsActive` / `anyQaListMutatingWriteIsActive`: **Share with config**.
- `patchGlossary` / `patchQaList`: **Share with config**.
- `intentMatchesSnapshot`: **Share directly**.
- `applyGlossaryWriteIntentsToSnapshot` / `applyQaListWriteIntentsToSnapshot`: **Share with config**.
- `clearConfirmedGlossaryWriteIntents` / `clearConfirmedQaListWriteIntents`: **Share with config**.

Recommendation: Excellent shared coordinator wrapper candidate.

### `glossary-term-write-coordinator.js` / `qa-term-write-coordinator.js`

Functions:

- `glossaryTermSaveIntentKey` / `qaTermSaveIntentKey`: **Share with config**.
- `glossaryTermWriteScope` / `qaTermWriteScope`: **Share with config**.
- `requestGlossaryTermWriteIntent` / `requestQaTermWriteIntent`: **Share with config**.
- `getGlossaryTermWriteIntent` / `getQaTermWriteIntent`: **Share with config**.
- `anyGlossaryTermWriteIsActive` / `anyQaTermWriteIsActive`: **Share with config**.
- `resetGlossaryTermWriteCoordinator` / `resetQaTermWriteCoordinator`: **Share with config**.
- QA-only `beginQaTermWrite`, `endQaTermWrite`, `qaListTermWriteIsActive`: **Defer**. These exist because QA still has active-count compatibility alongside the intent coordinator.

Recommendation: Share after QA term writes fully adopt intent-based execution.

### `glossary-term-sync.js` / `qa-term-sync.js`

Functions:

- `findGlossaryTermById` / `findQaTermById`: **Share with config**.
- `glossaryTermUiFields` / `qaTermUiFields`: **Share with config**.
- `withGlossaryTermUiFields` / `withQaTermUiFields`: **Share with config**.
- `normalizedVisibleGlossaryTerm` / `normalizedVisibleQaTerm`: **Share with config**.
- `updateGlossarySummaryTermCount` / `updateQaListSummaryTermCount`: **Share with config**.
- `setGlossaryEditorTerms` / `setQaListEditorTerms`: **Share with config**.
- `updateGlossaryEditorTerm` / `updateQaListEditorTerm`: **Share with config**.
- `buildGlossaryTermFromDraft` / `buildQaTermFromDraft`: **Share with config** for term shape builder.
- `upsertVisibleGlossaryTerm` / `upsertVisibleQaTerm`: **Share with config**.
- `replaceOptimisticGlossaryTerm` / `replaceOptimisticQaTerm`: **Share with config**.
- `markVisibleGlossaryTermConfirmed` / `markVisibleQaTermConfirmed`: **Share with config**.
- `markVisibleGlossaryTermFailed` / `markVisibleQaTermFailed`: **Share with config**.
- `removeVisibleGlossaryTerm` / `removeVisibleQaTerm`: **Share with config**.
- `applyGlossaryTermsStale` / `applyQaTermsStale`: **Share with config**.
- `markGlossaryTermsStale` / `markQaTermsStale`: **Share with config**.
- `loadGlossaryTermFromDisk` / `loadQaTermFromDisk`: **Share with config** for command and selected repo input.
- `ensureGlossaryTermReadyForEdit` / `ensureQaTermReadyForEdit`: **Share with config**.

Recommendation: Strong candidate for generic visible-term sync helper.

## JavaScript Screens

### `screens/glossaries.js` / `screens/qa.js`

Functions:

- `renderGlossaryLanguageFlow`: **Keep separate**. QA has one language display, not source-target flow.
- `renderGlossaryCard` / `renderQaListCard`: **Share with config** for labels, metadata rows, actions, default behavior, resolution derivation.
- `renderDeletedGlossariesSection` / `renderDeletedQaListsSection`: **Share with config**.
- `renderGlossariesScreen` / `renderQaScreen`: **Share with config**.

Recommendation: Good generic resource-list screen candidate.

### `screens/glossary-editor.js` / `screens/qa-list-editor.js`

Functions:

- `shortenChapterNavLabel`: **Share directly**.
- `renderGlossaryEditorScreen` / `renderQaListEditorScreen`: **Share partially**. Header/nav/search/loading shell can be shared; table columns and term rendering should stay resource-specific.

### `screens/glossary-creation-modal.js` / `screens/qa-list-creation-modal.js`

Functions:

- `renderLanguageOptions`: **Share directly**.
- `renderGlossaryCreationModal` / `renderQaListCreationModal`: **Share with config** for title and fields. Glossary has source + target; QA has language only.

### `screens/glossary-rename-modal.js` / `screens/qa-list-rename-modal.js`

Functions:

- `renderGlossaryRenameModal` / `renderQaListRenameModal`: **Share with config**.

### `screens/glossary-permanent-deletion-modal.js` / `screens/qa-list-permanent-deletion-modal.js`

Functions:

- `renderGlossaryPermanentDeletionModal` / `renderQaListPermanentDeletionModal`: **Share with config**.

### `screens/glossary-term-editor-modal.js` / `screens/qa-term-editor-modal.js`

Functions:

- Glossary-only `renderVariantRow`, `renderVariantLane`: **Keep separate**.
- `renderGlossaryTermEditorModal` / `renderQaTermEditorModal`: **Share only modal shell/actions/error styling**. Body is different enough to keep separate.

### `screens/glossary-import-modal.js` / `screens/qa-list-import-modal.js`

Functions:

- `renderGlossaryImportModal` / `renderQaListImportModal`: **Share with config**.

## Rust Files

### `glossary_storage/mod.rs` / `qa_list_storage/mod.rs`

Functions:

- Public command sync functions `list_local_*`, `load_*_editor_data`, `load_*_term`, `initialize_*_repo`, `import_tmx_to_*_repo`, `inspect_tmx_*_import`, `export_*_to_tmx`, `rename_*`, `update_*_lifecycle`, `purge_local_*_repo`, `prepare_local_*_repo`, `upsert_*_term`, `rollback_*_term_upsert`, `delete_*_term`: **Share with config at a lower level**, but keep command wrappers separate for Tauri command names and typed input/output.
- `normalized_optional_identifier`: **Share directly**.
- `glossary_repo_matches_identifier` / `qa_list_repo_matches_identifier`: **Share with config**.
- `find_glossary_repo_path` / `find_qa_list_repo_path`: **Share with config**.
- `glossary_repo_path` / `qa_list_repo_path`: **Share with config**.
- `glossary_git_repo_path` / `qa_list_git_repo_path`: **Share with config**.
- `desired_glossary_git_repo_path` / `desired_qa_list_git_repo_path`: **Share with config**.
- `read_glossary_value` / `read_qa_list_value`: **Share with config**.
- `build_local_glossary_summary` / `build_local_qa_list_summary`: **Share partially**. Repo fields/lifecycle/term count common; language fields differ.
- `read_glossary_file` / `read_qa_list_file`: **Share with config** for type.
- `count_glossary_term_files` / `count_qa_list_term_files`: **Share directly**.
- `load_glossary_terms` / `load_qa_list_terms`: **Share with config** for term type.
- Glossary-only `first_term_label`, `aligned_target_variant_notes`: **Keep separate**.
- `map_term_record`: **Share partially**. Common lifecycle/id fields can share, term body differs.

Recommendation: Extract shared repo/path/io/count helpers first; avoid genericizing all typed command wrappers.

### `glossary_storage/io.rs` / `qa_list_storage/io.rs`

Functions detected by the simple extractor: none, because these are likely private helpers not matched by the scan or are identical module contents.

Assessment: **Share directly**. This file should almost certainly become a common Rust storage IO module if the code is identical.

### `glossary_storage/terms.rs` / `qa_list_storage/terms.rs`

Functions:

- `merge_note_text`: **Share directly**.

Other public helpers in these modules were not detected by the simple private-function scan but should be reviewed for direct sharing; prior parity work indicated most term sanitizing helpers are identical.

### `glossary_storage/tmx.rs` / `qa_list_storage/tmx.rs`

Functions:

- `write_tmx_tuv`: **Glossary-specific wrapper**, but the XML write primitive can be shared.
- `escape_xml_text` / `escape_xml_text`: **Share directly**.
- `escape_xml_attr` / `escape_xml_attr`: **Share directly**.
- `title_from_import_file_name` / `title_from_file_name`: **Share directly** after naming normalization.
- `clean_tmx_text` / `clean_tmx_text`: **Share directly**.
- `normalize_tmx_language_code` / `normalize_language_code`: **Share directly**.
- `read_tmx_language_attr` / `read_tmx_attr`: **Share directly** with attribute-name parameter.
- `read_tuv_language` / `read_tuv_language`: **Share directly**.
- `language_name_for_iso_code` / `language_info_for_code`: **Share partially**. Better use one common Rust language module.
- QA-only `language_name_map`, `extract_js_string_property`: **Keep separate short-term**, or replace with a common generated language data module.

Recommendation: Share XML escaping, title cleanup, text cleanup, and language-code normalization immediately; keep parsers separate.

### `glossary_repo_sync.rs` / `qa_list_repo_sync.rs`

Functions:

- `sync_gtms_glossary_repos_sync` / `sync_gtms_qa_list_repos_sync`: **Share with config**, keep command wrappers separate.
- `sync_gtms_glossary_editor_repo_sync` / `sync_gtms_qa_list_editor_repo_sync`: **Share with config**, keep command wrappers separate.
- `glossary_term_changes_between_commits` / `qa_list_term_changes_between_commits`: **Share with config** for term deserialization/summary.
- `term_id_from_repo_relative_path`: **Share directly**.
- `snapshot_from_glossary_sync_error` / `snapshot_from_qa_list_sync_error`: **Share with config**.
- `inspect_glossary_repo_state` / `inspect_qa_list_repo_state`: **Share with config**.
- `normalized_optional_identifier`: **Share directly**.
- `glossary_repo_matches_identifier` / `qa_list_repo_matches_identifier`: **Share with config**.
- `find_glossary_repo_path` / `find_qa_list_repo_path`: **Share with config**.
- `resolve_or_desired_glossary_git_repo_path` / `resolve_or_desired_qa_list_git_repo_path`: **Share with config**.
- `sync_glossary_repo` / `sync_qa_list_repo`: **Share with config**.
- `ensure_glossary_origin_remote` / `ensure_qa_list_origin_remote`: **Share with config**.
- `clone_glossary_repo` / `clone_qa_list_repo`: **Share with config**.
- `enforce_remote_glossary_app_version` / `enforce_remote_qa_list_app_version`: **Share with config**.
- `mark_glossary_repo_synced` / `mark_qa_list_repo_synced`: **Share with config**.

Recommendation: Very strong candidate for a generic Rust repo sync engine behind resource-specific command wrappers.

## Recommended Refactor Sequence

1. Extract tiny safe helpers first:
   - JS import file byte helpers.
   - JS TMX save filename/path helpers.
   - JS editor snapshot guard.
   - JS cache/query key helpers.
   - Rust XML escaping/title/text/language-code helpers.
   - Rust repo path/id helpers.

2. Extract medium generic controllers:
   - `repoResourceQueryController`.
   - `repoResourceLifecycleController`.
   - `repoResourceImportCreateController`.
   - `visibleTermSyncController`.

3. Defer risky unification:
   - Term editor submit UI/optimistic flow.
   - Defaults.
   - Metadata repair/rebuild.
   - Background sync.
   - Full TMX parsers.

4. Keep public facades and Tauri command wrappers resource-specific. They preserve readable domain language and make app actions easy to trace.
