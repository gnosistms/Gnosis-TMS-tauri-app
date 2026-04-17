import {
  cancelEditorConflictResolutionModal as cancelEditorConflictResolutionModalFlow,
  copyEditorConflictResolutionVersion as copyEditorConflictResolutionVersionFlow,
  openEditorConflictResolutionModal as openEditorConflictResolutionModalFlow,
  saveEditorConflictResolution as saveEditorConflictResolutionFlow,
  updateEditorConflictResolutionFinalText as updateEditorConflictResolutionFinalTextFlow,
} from "./editor-conflict-resolution-flow.js";
import {
  deleteActiveEditorRowComment as deleteActiveEditorRowCommentFlow,
  loadActiveEditorRowComments as loadActiveEditorRowCommentsFlow,
  openEditorRowComments as openEditorRowCommentsFlow,
  saveActiveEditorRowComment as saveActiveEditorRowCommentFlow,
  switchEditorSidebarTab as switchEditorSidebarTabFlow,
  updateEditorCommentDraft as updateEditorCommentDraftFlow,
} from "./editor-comments-flow.js";
import { resolveEditorSidebarTabForField } from "./editor-comments.js";
import {
  loadSelectedChapterEditorData as loadSelectedChapterEditorDataFlow,
  openTranslateChapter as openTranslateChapterFlow,
} from "./editor-chapter-load-flow.js";
import {
  restoreMountedEditorGlossaryHighlightsFromCache as restoreMountedEditorGlossaryHighlightsFromCacheFlow,
  syncEditorGlossaryHighlightRowDom as syncEditorGlossaryHighlightRowDomFlow,
  syncVisibleEditorGlossaryHighlightRows as syncVisibleEditorGlossaryHighlightRowsFlow,
} from "./editor-glossary-flow.js";
import {
  applyEditorAiReview as applyEditorAiReviewFlow,
  runEditorAiReview as runEditorAiReviewFlow,
} from "./editor-ai-review-flow.js";
import { runEditorAiTranslate as runEditorAiTranslateFlow } from "./editor-ai-translate-flow.js";
import {
  replaceSelectedEditorRows as replaceSelectedEditorRowsFlow,
  showEditorRowInContext as showEditorRowInContextFlow,
  selectAllEditorReplaceRows as selectAllEditorReplaceRowsFlow,
  toggleEditorReplaceEnabled as toggleEditorReplaceEnabledFlow,
  updateEditorRowFilterMode as updateEditorRowFilterModeFlow,
  toggleEditorReplaceRowSelected as toggleEditorReplaceRowSelectedFlow,
  toggleEditorSearchFilterCaseSensitive as toggleEditorSearchFilterCaseSensitiveFlow,
  updateEditorReplaceQuery as updateEditorReplaceQueryFlow,
  updateEditorSearchFilterQuery as updateEditorSearchFilterQueryFlow,
} from "./editor-search-flow.js";
import {
  persistEditorChapterSelections as persistEditorChapterSelectionsFlow,
  updateEditorSourceLanguage as updateEditorSourceLanguageFlow,
  updateEditorTargetLanguage as updateEditorTargetLanguageFlow,
} from "./editor-selection-flow.js";
import {
  cancelEditorUnreviewAllModal as cancelEditorUnreviewAllModalFlow,
  confirmEditorUnreviewAll as confirmEditorUnreviewAllFlow,
  flushDirtyEditorRows as flushDirtyEditorRowsFlow,
  openEditorUnreviewAllModal as openEditorUnreviewAllModalFlow,
  persistEditorRowOnBlur as persistEditorRowOnBlurFlow,
  resolveEditorRowConflict as resolveEditorRowConflictFlow,
  scheduleDirtyEditorRowScan as scheduleDirtyEditorRowScanFlow,
  toggleEditorRowFieldMarker as toggleEditorRowFieldMarkerFlow,
  updateEditorRowFieldValue as updateEditorRowFieldValueFlow,
  updateEditorRowTextStyle as updateEditorRowTextStyleFlow,
} from "./editor-persistence-flow.js";
import { reconcileDirtyTrackedEditorRows } from "./editor-dirty-row-state.js";
import {
  cancelEditorReplaceUndoModal as cancelEditorReplaceUndoModalFlow,
  confirmEditorReplaceUndo as confirmEditorReplaceUndoFlow,
  loadActiveEditorFieldHistory as loadActiveEditorFieldHistoryFlow,
  openEditorReplaceUndoModal as openEditorReplaceUndoModalFlow,
  restoreEditorFieldHistory as restoreEditorFieldHistoryFlow,
  toggleEditorHistoryGroupExpanded as toggleEditorHistoryGroupExpandedFlow,
} from "./editor-history-flow.js";
import {
  cancelEditorRowPermanentDeletionModal as cancelEditorRowPermanentDeletionModalFlow,
  cancelInsertEditorRowModal as cancelInsertEditorRowModalFlow,
  confirmEditorRowPermanentDeletion as confirmEditorRowPermanentDeletionFlow,
  confirmInsertEditorRow as confirmInsertEditorRowFlow,
  openEditorRowPermanentDeletionModal as openEditorRowPermanentDeletionModalFlow,
  openInsertEditorRowModal as openInsertEditorRowModalFlow,
  restoreEditorRow as restoreEditorRowFlow,
  softDeleteEditorRow as softDeleteEditorRowFlow,
  toggleDeletedEditorRowGroup as toggleDeletedEditorRowGroupFlow,
} from "./editor-row-structure-flow.js";
import {
  applyChapterMetadataToState,
  applyEditorSelectionsToProjectState,
  applyEditorUiState,
  markEditorRowsPersisted,
  normalizeEditorRows,
  resolveChapterSourceWordCount,
  updateEditorChapterRow,
} from "./editor-state-flow.js";
import { applyStructuralEditorChange } from "./editor-structural-change-flow.js";
import { waitForNextPaint } from "./runtime.js";
import { saveStoredEditorFontSizePx } from "./editor-preferences.js";
import { ensureEditorRowReadyForActivation } from "./editor-row-sync-flow.js";
import { findEditorRowById } from "./editor-utils.js";
import {
  noteEditorBackgroundSyncScrollActivity as noteEditorBackgroundSyncScrollActivityFlow,
  syncEditorBackgroundNow as syncEditorBackgroundNowFlow,
  startEditorBackgroundSyncSession,
  syncAndStopEditorBackgroundSyncSession,
} from "./editor-background-sync.js";
import {
  hideNavigationLoadingModal,
  showNavigationLoadingModal,
} from "./navigation-loading.js";
import {
  coerceEditorFontSizePx,
  createTargetLanguageManagerState,
  state,
} from "./state.js";

export const MANAGE_TARGET_LANGUAGES_OPTION_VALUE = "__manage_target_languages__";
export { resolveChapterSourceWordCount };

export function openEditorReplaceUndoModal(commitSha) {
  openEditorReplaceUndoModalFlow(commitSha);
}

export function cancelEditorReplaceUndoModal() {
  cancelEditorReplaceUndoModalFlow();
}

export function syncEditorGlossaryHighlightRowDom(
  rowId,
  chapterState = state.editorChapter,
  root = document,
) {
  syncEditorGlossaryHighlightRowDomFlow(rowId, chapterState, root);
}

export function restoreMountedEditorGlossaryHighlightsFromCache(
  root = document,
  chapterState = state.editorChapter,
) {
  restoreMountedEditorGlossaryHighlightsFromCacheFlow(root, chapterState);
}

export function syncVisibleEditorGlossaryHighlightRows(
  root = document,
  scrollContainer = root?.querySelector?.(".translate-main-scroll") ?? null,
  chapterState = state.editorChapter,
) {
  syncVisibleEditorGlossaryHighlightRowsFlow(root, scrollContainer, chapterState);
}

export function loadActiveEditorFieldHistory(render) {
  loadActiveEditorFieldHistoryFlow(render);
}

export function loadActiveEditorRowComments(render) {
  loadActiveEditorRowCommentsFlow(render);
}

export async function setActiveEditorField(render, rowId, languageCode, options = {}) {
  if (!rowId || !languageCode) {
    return;
  }

  if (!(await ensureEditorRowReadyForActivation(render, rowId, options))) {
    return;
  }

  const previousSidebarTab = state.editorChapter.sidebarTab;
  const row = findEditorRowById(rowId, state.editorChapter);
  const nextSidebarTab = resolveEditorSidebarTabForField(
    previousSidebarTab,
    row,
    languageCode,
  );
  const isSameSelection =
    state.editorChapter.activeRowId === rowId
    && state.editorChapter.activeLanguageCode === languageCode;
  if (isSameSelection && previousSidebarTab === nextSidebarTab) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: rowId,
    activeLanguageCode: languageCode,
    sidebarTab: nextSidebarTab,
  };
  if (state.editorChapter.sidebarTab === "comments") {
    openEditorRowCommentsFlow(render, rowId, languageCode);
    return;
  }
  if (state.editorChapter.sidebarTab === "translate") {
    if (previousSidebarTab === "comments") {
      render?.({ scope: "translate-body" });
    }
    render?.({ scope: "translate-sidebar" });
    return;
  }

  if (previousSidebarTab === "comments") {
    render?.({ scope: "translate-body" });
  }
  loadActiveEditorFieldHistoryFlow(render);
}

function editorPersistenceOperations() {
  return {
    updateEditorChapterRow,
    applyEditorSelectionsToProjectState,
  };
}

function editorRowStructureOperations() {
  return {
    applyStructuralEditorChange,
    applyEditorSelectionsToProjectState,
  };
}

function editorChapterLoadOperations() {
  return {
    applyEditorUiState,
    normalizeEditorRows,
    applyChapterMetadataToState,
    loadActiveEditorFieldHistory,
    flushDirtyEditorRows,
    persistEditorChapterSelections,
  };
}

export function scheduleDirtyEditorRowScan(render, rowId) {
  scheduleDirtyEditorRowScanFlow(render, rowId, editorPersistenceOperations());
}

export function noteEditorBackgroundSyncScrollActivity() {
  noteEditorBackgroundSyncScrollActivityFlow();
}

export async function flushDirtyEditorRows(render, options = {}) {
  return flushDirtyEditorRowsFlow(render, editorPersistenceOperations(), options);
}

export function toggleEditorHistoryGroupExpanded(groupKey) {
  toggleEditorHistoryGroupExpandedFlow(groupKey);
}

export function toggleEditorReviewSectionExpanded(sectionKey) {
  if (!sectionKey || !state.editorChapter?.chapterId) {
    return;
  }

  const reviewExpandedSectionKeys =
    state.editorChapter.reviewExpandedSectionKeys instanceof Set
      ? new Set(state.editorChapter.reviewExpandedSectionKeys)
      : new Set(["last-update", "ai-review"]);

  if (reviewExpandedSectionKeys.has(sectionKey)) {
    reviewExpandedSectionKeys.delete(sectionKey);
  } else {
    reviewExpandedSectionKeys.add(sectionKey);
  }

  state.editorChapter = {
    ...state.editorChapter,
    reviewExpandedSectionKeys,
  };
}

export async function runEditorAiReview(render) {
  await runEditorAiReviewFlow(render);
}

export async function runEditorAiTranslate(render, actionId) {
  await runEditorAiTranslateFlow(render, actionId, {
    updateEditorRowFieldValue,
    persistEditorRowOnBlur,
  });
}

export async function applyEditorAiReview(render) {
  await applyEditorAiReviewFlow(render, {
    updateEditorRowFieldValue,
    persistEditorRowOnBlur,
  });
}

export function openEditorRowComments(render, rowId, languageCode) {
  openEditorRowCommentsFlow(render, rowId, languageCode);
}

export function openEditorConflictResolutionModal(render, rowId, languageCode) {
  openEditorConflictResolutionModalFlow(render, rowId, languageCode, {
    loadActiveEditorFieldHistory,
  });
}

export function cancelEditorConflictResolutionModal(render) {
  cancelEditorConflictResolutionModalFlow(render);
}

export function updateEditorConflictResolutionFinalText(nextValue) {
  updateEditorConflictResolutionFinalTextFlow(nextValue);
}

export async function copyEditorConflictResolutionVersion(render, side) {
  await copyEditorConflictResolutionVersionFlow(render, side);
}

export async function saveEditorConflictResolution(render) {
  await saveEditorConflictResolutionFlow(render, {
    updateEditorChapterRow,
    applyEditorSelectionsToProjectState,
    reconcileDirtyTrackedEditorRows,
    loadActiveEditorFieldHistory,
    syncEditorBackgroundNow: syncEditorBackgroundNowFlow,
  });
}

export function switchEditorSidebarTab(render, tab) {
  switchEditorSidebarTabFlow(render, tab, {
    loadActiveEditorFieldHistory,
  });
}

export function updateEditorCommentDraft(nextValue) {
  updateEditorCommentDraftFlow(nextValue);
}

export async function saveActiveEditorRowComment(render) {
  await saveActiveEditorRowCommentFlow(render);
}

export async function deleteActiveEditorRowComment(render, commentId) {
  await deleteActiveEditorRowCommentFlow(render, commentId);
}

export async function persistEditorChapterSelections(render) {
  await persistEditorChapterSelectionsFlow(render, {
    applyChapterMetadataToState,
    applyEditorSelectionsToProjectState,
  });
}

export async function loadSelectedChapterEditorData(render, options = {}) {
  await loadSelectedChapterEditorDataFlow(render, options, editorChapterLoadOperations());
}

export async function openTranslateChapter(render, chapterId) {
  const navigationLoadingToken = showNavigationLoadingModal("Loading file...", "Opening the editor.");
  render();

  if (
    state.screen === "translate"
    && state.editorChapter?.chapterId
    && state.editorChapter.chapterId !== chapterId
  ) {
    try {
      await syncAndStopEditorBackgroundSyncSession(render);
      await openTranslateChapterFlow(render, chapterId, editorChapterLoadOperations());
      if (state.screen === "translate" && state.editorChapter?.chapterId === chapterId && state.editorChapter.status === "ready") {
        startEditorBackgroundSyncSession(render);
      }
    } finally {
      hideNavigationLoadingModal(navigationLoadingToken);
      render();
    }
    return;
  }

  try {
    await openTranslateChapterFlow(render, chapterId, editorChapterLoadOperations());
    if (state.screen === "translate" && state.editorChapter?.chapterId === chapterId && state.editorChapter.status === "ready") {
      startEditorBackgroundSyncSession(render);
    }
  } finally {
    hideNavigationLoadingModal(navigationLoadingToken);
    render();
  }
}

export function updateEditorSourceLanguage(render, nextCode) {
  updateEditorSourceLanguageFlow(render, nextCode, {
    applyChapterMetadataToState,
    applyEditorSelectionsToProjectState,
  });
}

export function updateEditorTargetLanguage(render, nextCode) {
  updateEditorTargetLanguageFlow(render, nextCode, {
    applyChapterMetadataToState,
    applyEditorSelectionsToProjectState,
  });
}

export function updateEditorFontSize(nextValue) {
  const fontSizePx = coerceEditorFontSizePx(nextValue);
  state.editorChapter = {
    ...state.editorChapter,
    fontSizePx,
  };
  saveStoredEditorFontSizePx(fontSizePx);
}

export async function restoreEditorFieldHistory(render, commitSha) {
  await restoreEditorFieldHistoryFlow(render, commitSha, {
    updateEditorChapterRow,
    reconcileDirtyTrackedEditorRows,
    applyEditorSelectionsToProjectState,
  });
}

export async function confirmEditorReplaceUndo(render) {
  await confirmEditorReplaceUndoFlow(render, {
    markEditorRowsPersisted,
  });
}

export function openTargetLanguageManager() {
  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    isOpen: true,
    status: "idle",
    error: "",
  };
}

export function closeTargetLanguageManager() {
  state.targetLanguageManager = createTargetLanguageManagerState();
}

export function openInsertEditorRowModal(rowId) {
  openInsertEditorRowModalFlow(rowId);
}

export function cancelInsertEditorRowModal() {
  cancelInsertEditorRowModalFlow();
}

export function openEditorRowPermanentDeletionModal(rowId) {
  openEditorRowPermanentDeletionModalFlow(rowId);
}

export function cancelEditorRowPermanentDeletionModal() {
  cancelEditorRowPermanentDeletionModalFlow();
}

export function toggleDeletedEditorRowGroup(render, groupId, anchorSnapshot = null) {
  toggleDeletedEditorRowGroupFlow(render, groupId, anchorSnapshot, editorRowStructureOperations());
}

export async function confirmInsertEditorRow(render, position) {
  await confirmInsertEditorRowFlow(render, position, editorRowStructureOperations());
}

export async function softDeleteEditorRow(render, rowId, triggerAnchorSnapshot = null) {
  await softDeleteEditorRowFlow(render, rowId, triggerAnchorSnapshot, editorRowStructureOperations());
}

export async function restoreEditorRow(render, rowId) {
  await restoreEditorRowFlow(render, rowId, editorRowStructureOperations());
}

export async function confirmEditorRowPermanentDeletion(render) {
  await confirmEditorRowPermanentDeletionFlow(render, editorRowStructureOperations());
}

export function openEditorUnreviewAllModal(render) {
  openEditorUnreviewAllModalFlow(render);
}

export function cancelEditorUnreviewAllModal(render) {
  cancelEditorUnreviewAllModalFlow(render);
}

export async function confirmEditorUnreviewAll(render) {
  await confirmEditorUnreviewAllFlow(render, editorPersistenceOperations());
}

export function updateEditorRowFieldValue(rowId, languageCode, nextValue) {
  updateEditorRowFieldValueFlow(rowId, languageCode, nextValue, {
    updateEditorChapterRow,
  });
}

export async function updateEditorRowTextStyle(render, rowId, nextTextStyle) {
  await updateEditorRowTextStyleFlow(render, rowId, nextTextStyle, {
    updateEditorChapterRow,
    applyEditorSelectionsToProjectState,
  });
}

export function updateEditorSearchFilterQuery(render, nextValue) {
  updateEditorSearchFilterQueryFlow(render, nextValue);
}

export function updateEditorRowFilterMode(render, nextValue) {
  updateEditorRowFilterModeFlow(render, nextValue);
}

export async function showEditorRowInContext(render, rowId) {
  await showEditorRowInContextFlow(render, rowId);
}

export function toggleEditorSearchFilterCaseSensitive(render, enabled) {
  toggleEditorSearchFilterCaseSensitiveFlow(render, enabled);
}

export function toggleEditorReplaceEnabled(render, enabled, anchorTarget = null) {
  toggleEditorReplaceEnabledFlow(render, enabled, anchorTarget);
}

export function updateEditorReplaceQuery(render, nextValue) {
  updateEditorReplaceQueryFlow(render, nextValue);
}

export function toggleEditorReplaceRowSelected(render, rowId, selected, anchorTarget = null) {
  toggleEditorReplaceRowSelectedFlow(render, rowId, selected, anchorTarget);
}

export function selectAllEditorReplaceRows(render) {
  selectAllEditorReplaceRowsFlow(render);
}

export async function replaceSelectedEditorRows(render) {
  await replaceSelectedEditorRowsFlow(render, {
    markEditorRowsPersisted,
    loadActiveEditorFieldHistory,
  });
}

export async function toggleEditorRowFieldMarker(render, rowId, languageCode, kind) {
  await toggleEditorRowFieldMarkerFlow(render, rowId, languageCode, kind, editorPersistenceOperations());
}

export function toggleEditorLanguageCollapsed(languageCode) {
  if (!languageCode) {
    return;
  }

  const collapsedLanguageCodes =
    state.editorChapter?.collapsedLanguageCodes instanceof Set
      ? new Set(state.editorChapter.collapsedLanguageCodes)
      : new Set();

  if (collapsedLanguageCodes.has(languageCode)) {
    collapsedLanguageCodes.delete(languageCode);
  } else {
    collapsedLanguageCodes.add(languageCode);
  }

  state.editorChapter = {
    ...state.editorChapter,
    collapsedLanguageCodes,
  };
}

export async function persistEditorRowOnBlur(render, rowId, options = {}) {
  await persistEditorRowOnBlurFlow(render, rowId, editorPersistenceOperations(), options);
}

export async function resolveEditorRowConflict(render, rowId, resolution) {
  await resolveEditorRowConflictFlow(render, rowId, resolution, editorPersistenceOperations());
}
