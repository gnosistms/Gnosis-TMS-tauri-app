import {
  closeEditorImageInvalidFileModal as closeEditorImageInvalidFileModalFlow,
  closeEditorImagePreview as closeEditorImagePreviewFlow,
  collapseEmptyEditorImageEditor as collapseEmptyEditorImageEditorFlow,
  dismissActiveIdleEditorImageUpload as dismissActiveIdleEditorImageUploadFlow,
  handleDroppedEditorImageFile as handleDroppedEditorImageFileFlow,
  handleDroppedEditorImagePath as handleDroppedEditorImagePathFlow,
  openEditorImagePreview as openEditorImagePreviewFlow,
  openEditorImageUpload as openEditorImageUploadFlow,
  openEditorImageUploadPicker as openEditorImageUploadPickerFlow,
  openEditorImageUrl as openEditorImageUrlFlow,
  closeEditorImageUrl as closeEditorImageUrlFlow,
  persistEditorImageUrlOnBlur as persistEditorImageUrlOnBlurFlow,
  removeEditorLanguageImage as removeEditorLanguageImageFlow,
  submitEditorImageUrl as submitEditorImageUrlFlow,
  updateEditorImageUrlDraft as updateEditorImageUrlDraftFlow,
} from "./editor-image-flow.js";
import {
  cancelEditorConflictResolutionModal as cancelEditorConflictResolutionModalFlow,
  copyEditorConflictResolutionVersion as copyEditorConflictResolutionVersionFlow,
  openEditorConflictResolutionModal as openEditorConflictResolutionModalFlow,
  saveEditorConflictResolution as saveEditorConflictResolutionFlow,
  updateEditorConflictResolutionFinalFootnote as updateEditorConflictResolutionFinalFootnoteFlow,
  updateEditorConflictResolutionFinalImageCaption as updateEditorConflictResolutionFinalImageCaptionFlow,
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
  openTranslateChapter as openTranslateChapterFlow,
} from "./editor-chapter-load-flow.js";
import { reloadSelectedChapterEditorData } from "./editor-chapter-reload.js";
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
  cancelEditorAiTranslateAllModal as cancelEditorAiTranslateAllModalFlow,
  confirmEditorAiTranslateAll as confirmEditorAiTranslateAllFlow,
  openEditorAiTranslateAllModal as openEditorAiTranslateAllModalFlow,
  updateEditorAiTranslateAllLanguageSelection as updateEditorAiTranslateAllLanguageSelectionFlow,
} from "./editor-ai-translate-all-flow.js";
import {
  cancelEditorDeriveGlossariesModal as cancelEditorDeriveGlossariesModalFlow,
  confirmEditorDeriveGlossaries as confirmEditorDeriveGlossariesFlow,
  openEditorDeriveGlossariesModal as openEditorDeriveGlossariesModalFlow,
} from "./editor-derive-glossaries-flow.js";
import { toggleEditorInlineStyle as toggleEditorInlineStyleFlow } from "./editor-inline-markup-flow.js";
import {
  applyEditorAssistantDraft as applyEditorAssistantDraftFlow,
  runEditorAiAssistant as runEditorAiAssistantFlow,
  scheduleAssistantTranscriptScrollToBottom,
  toggleEditorAssistantDraftDiff as toggleEditorAssistantDraftDiffFlow,
  updateEditorAssistantComposerDraft as updateEditorAssistantComposerDraftFlow,
} from "./editor-ai-assistant-flow.js";
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
  collapseEmptyEditorFootnote as collapseEmptyEditorFootnoteFlow,
  collapseEditorImageCaption as collapseEditorImageCaptionFlow,
  cancelEditorUnreviewAllModal as cancelEditorUnreviewAllModalFlow,
  confirmEditorUnreviewAll as confirmEditorUnreviewAllFlow,
  flushDirtyEditorRows as flushDirtyEditorRowsFlow,
  openEditorFootnote as openEditorFootnoteFlow,
  openEditorImageCaption as openEditorImageCaptionFlow,
  openEditorUnreviewAllModal as openEditorUnreviewAllModalFlow,
  persistEditorRowOnBlur as persistEditorRowOnBlurFlow,
  resolveEditorRowConflict as resolveEditorRowConflictFlow,
  scheduleDirtyEditorRowScan as scheduleDirtyEditorRowScanFlow,
  toggleEditorRowFieldMarker as toggleEditorRowFieldMarkerFlow,
  updateEditorRowFieldValueForContentKind as updateEditorRowFieldValueFlow,
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
import { syncEditorRowTextareaHeight } from "./autosize.js";
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
  EDITOR_MODE_TRANSLATE,
} from "./editor-preview.js";
import {
  copyEditorPreviewHtml as copyEditorPreviewHtmlFlow,
  moveEditorPreviewSearch as moveEditorPreviewSearchFlow,
  refreshEditorPreviewAfterTargetLanguageChange,
  resetEditorPreviewModeScrollSnapshot,
  setEditorMode as setEditorModeFlow,
  updateEditorPreviewSearchQuery as updateEditorPreviewSearchQueryFlow,
} from "./editor-preview-flow.js";
import {
  hideNavigationLoadingModal,
  showNavigationLoadingModal,
} from "./navigation-loading.js";
import {
  captureTranslateAnchorForRow,
} from "./scroll-state.js";
import { syncEditorVirtualizationRowLayout } from "./editor-virtualization.js";
import {
  captureTranslateViewport,
  renderTranslateBodyPreservingViewport,
} from "./translate-viewport.js";
import {
  coerceEditorFontSizePx,
  createEditorMainFieldEditorState,
  createEditorPendingSelectionState,
  createEditorPreviewSearchState,
  state,
} from "./state.js";
import {
  addTargetLanguageManagerLanguage as addTargetLanguageManagerLanguageFlow,
  closeTargetLanguageManager as closeTargetLanguageManagerFlow,
  closeTargetLanguageManagerPicker as closeTargetLanguageManagerPickerFlow,
  MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE,
  MANAGE_TARGET_LANGUAGES_OPTION_VALUE,
  moveTargetLanguageManagerLanguageToIndex as moveTargetLanguageManagerLanguageToIndexFlow,
  openTargetLanguageManager as openTargetLanguageManagerFlow,
  openTargetLanguageManagerPicker as openTargetLanguageManagerPickerFlow,
  removeTargetLanguageManagerLanguage as removeTargetLanguageManagerLanguageFlow,
  selectTargetLanguageManagerPickerLanguage as selectTargetLanguageManagerPickerLanguageFlow,
  submitTargetLanguageManager as submitTargetLanguageManagerFlow,
} from "./editor-target-language-manager-flow.js";

export { MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE, MANAGE_TARGET_LANGUAGES_OPTION_VALUE };
export { resolveChapterSourceWordCount };

function editorMainFieldMatches(rowId, languageCode, chapterState = state.editorChapter) {
  return (
    chapterState?.mainFieldEditor?.rowId === rowId
    && chapterState?.mainFieldEditor?.languageCode === languageCode
  );
}

function textareaOpensMainField(input) {
  return (
    input instanceof HTMLTextAreaElement
    && (input.dataset.contentKind ?? "") === ""
  );
}

function buildEditorPendingSelection(rowId, languageCode, offset) {
  return {
    rowId,
    languageCode,
    offset,
  };
}

function resolveEditorMainFieldViewportSnapshot(rowId, languageCode, options = {}) {
  return options.viewportSnapshot ?? captureTranslateViewport(options.target ?? null, {
    preferPrimed: true,
    expectedRowId: rowId,
    fallbackAnchor: captureTranslateAnchorForRow(rowId, languageCode),
  });
}

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

export function collapseEditorMainField(render, rowId, languageCode, options = {}) {
  if (!rowId || !languageCode || !editorMainFieldMatches(rowId, languageCode)) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    mainFieldEditor: createEditorMainFieldEditorState(),
    pendingSelection: createEditorPendingSelectionState(),
  };

  renderTranslateBodyPreservingViewport(
    render,
    resolveEditorMainFieldViewportSnapshot(rowId, languageCode, options),
  );
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
  const shouldOpenEditor = options.openEditor === true || textareaOpensMainField(options.input);
  const pendingSelectionOffset =
    Number.isInteger(options.pendingSelectionOffset) && options.pendingSelectionOffset >= 0
      ? options.pendingSelectionOffset
      : null;
  const wasEditorOpen = editorMainFieldMatches(rowId, languageCode);
  const isSameSelection =
    state.editorChapter.activeRowId === rowId
    && state.editorChapter.activeLanguageCode === languageCode;
  const isSameEditorState = !shouldOpenEditor || editorMainFieldMatches(rowId, languageCode);
  if (
    isSameSelection
    && previousSidebarTab === nextSidebarTab
    && isSameEditorState
    && pendingSelectionOffset === null
  ) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: rowId,
    activeLanguageCode: languageCode,
    sidebarTab: nextSidebarTab,
    mainFieldEditor:
      shouldOpenEditor
        ? {
          rowId,
          languageCode,
        }
        : state.editorChapter.mainFieldEditor,
    pendingSelection:
      shouldOpenEditor && pendingSelectionOffset !== null
        ? buildEditorPendingSelection(rowId, languageCode, pendingSelectionOffset)
        : createEditorPendingSelectionState(),
  };
  const shouldRenderBody =
    shouldOpenEditor
    && (!wasEditorOpen || !isSameSelection || pendingSelectionOffset !== null);
  if (shouldRenderBody) {
    renderTranslateBodyPreservingViewport(
      render,
      resolveEditorMainFieldViewportSnapshot(rowId, languageCode, options),
    );
  }
  if (state.editorChapter.sidebarTab === "comments") {
    openEditorRowCommentsFlow(render, rowId, languageCode);
    return;
  }
  if (state.editorChapter.sidebarTab === "assistant") {
    if (previousSidebarTab === "comments" && !shouldRenderBody) {
      render?.({ scope: "translate-body" });
    }
    render?.({ scope: "translate-sidebar" });
    return;
  }

  if (previousSidebarTab === "comments" && !shouldRenderBody) {
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

export function openEditorAiTranslateAllModal(render) {
  openEditorAiTranslateAllModalFlow(render);
}

export function cancelEditorAiTranslateAllModal(render) {
  cancelEditorAiTranslateAllModalFlow(render);
}

export function updateEditorAiTranslateAllLanguageSelection(render, languageCode, selected) {
  updateEditorAiTranslateAllLanguageSelectionFlow(render, languageCode, selected);
}

export async function confirmEditorAiTranslateAll(render) {
  await confirmEditorAiTranslateAllFlow(render, {
    updateEditorRowFieldValue,
    persistEditorRowOnBlur,
  });
}

export function openEditorDeriveGlossariesModal(render) {
  openEditorDeriveGlossariesModalFlow(render);
}

export function cancelEditorDeriveGlossariesModal(render) {
  cancelEditorDeriveGlossariesModalFlow(render);
}

export async function confirmEditorDeriveGlossaries(render) {
  await confirmEditorDeriveGlossariesFlow(render, {
    updateEditorRowFieldValue,
    persistEditorRowOnBlur,
  });
}

export async function runEditorAiAssistant(render) {
  await runEditorAiAssistantFlow(render);
}

export async function applyEditorAssistantDraft(render, itemId) {
  await applyEditorAssistantDraftFlow(render, itemId, {
    updateEditorRowFieldValue,
    persistEditorRowOnBlur,
  });
}

export function toggleEditorAssistantDraftDiff(render, itemId) {
  toggleEditorAssistantDraftDiffFlow(render, itemId);
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

export function updateEditorConflictResolutionFinalFootnote(nextValue) {
  updateEditorConflictResolutionFinalFootnoteFlow(nextValue);
}

export function updateEditorConflictResolutionFinalImageCaption(nextValue) {
  updateEditorConflictResolutionFinalImageCaptionFlow(nextValue);
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
    scheduleAssistantTranscriptScrollToBottom,
  });
}

export function scheduleEditorAssistantTranscriptScrollToBottom() {
  scheduleAssistantTranscriptScrollToBottom();
}

export function updateEditorCommentDraft(nextValue) {
  updateEditorCommentDraftFlow(nextValue);
}

export function updateEditorAssistantComposerDraft(nextValue) {
  updateEditorAssistantComposerDraftFlow(nextValue);
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
  await reloadSelectedChapterEditorData(render, options);
}

export async function openTranslateChapter(render, chapterId) {
  resetEditorPreviewModeScrollSnapshot();
  state.editorChapter = {
    ...state.editorChapter,
    mode: EDITOR_MODE_TRANSLATE,
    previewSearch: createEditorPreviewSearchState(),
  };
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

  refreshEditorPreviewAfterTargetLanguageChange(render);
}

export function updateEditorFontSize(nextValue) {
  const fontSizePx = coerceEditorFontSizePx(nextValue);
  state.editorChapter = {
    ...state.editorChapter,
    fontSizePx,
  };
  saveStoredEditorFontSizePx(fontSizePx);
}

export function setEditorMode(render, nextMode) {
  setEditorModeFlow(render, nextMode);
}

export function updateEditorPreviewSearchQuery(render, nextValue) {
  updateEditorPreviewSearchQueryFlow(render, nextValue);
}

export function moveEditorPreviewSearch(render, direction = "next") {
  moveEditorPreviewSearchFlow(render, direction);
}

export async function copyEditorPreviewHtml(render) {
  await copyEditorPreviewHtmlFlow(render);
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

export function openTargetLanguageManager(render = null) {
  return openTargetLanguageManagerFlow(render);
}

export function closeTargetLanguageManager() {
  closeTargetLanguageManagerFlow();
}

export function openTargetLanguageManagerPicker() {
  openTargetLanguageManagerPickerFlow();
}

export function closeTargetLanguageManagerPicker() {
  closeTargetLanguageManagerPickerFlow();
}

export function selectTargetLanguageManagerPickerLanguage(languageCode) {
  selectTargetLanguageManagerPickerLanguageFlow(languageCode);
}

export function addTargetLanguageManagerLanguage() {
  addTargetLanguageManagerLanguageFlow();
}

export function removeTargetLanguageManagerLanguage(index) {
  removeTargetLanguageManagerLanguageFlow(index);
}

export function moveTargetLanguageManagerLanguageToIndex(fromIndex, toIndex) {
  moveTargetLanguageManagerLanguageToIndexFlow(fromIndex, toIndex);
}

export async function submitTargetLanguageManager(render) {
  await submitTargetLanguageManagerFlow(render, {
    applyChapterMetadataToState,
    flushDirtyEditorRows,
    reloadSelectedChapterEditorData,
  });
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

export function updateEditorRowFieldValue(rowId, languageCode, nextValue, contentKind = "field") {
  updateEditorRowFieldValueFlow(rowId, languageCode, nextValue, contentKind, {
    updateEditorChapterRow,
  });
}

export function toggleEditorInlineStyle(render, button) {
  toggleEditorInlineStyleFlow(render, button, {
    updateEditorRowFieldValueForContentKind: updateEditorRowFieldValue,
    syncEditorRowTextareaHeight,
    syncEditorVirtualizationRowLayout,
    syncEditorGlossaryHighlightRowDom,
  });
}

export function openEditorFootnote(render, rowId, languageCode) {
  openEditorFootnoteFlow(render, rowId, languageCode);
}

export function openEditorImageCaption(render, rowId, languageCode) {
  openEditorImageCaptionFlow(render, rowId, languageCode);
}

export function collapseEmptyEditorFootnote(render, rowId, languageCode) {
  collapseEmptyEditorFootnoteFlow(render, rowId, languageCode);
}

export function collapseEditorImageCaption(render, rowId, languageCode) {
  collapseEditorImageCaptionFlow(render, rowId, languageCode);
}

export function openEditorImageUrl(render, rowId, languageCode) {
  openEditorImageUrlFlow(render, rowId, languageCode);
}

export function closeEditorImageUrl(render, rowId, languageCode) {
  closeEditorImageUrlFlow(render, rowId, languageCode);
}

export function updateEditorImageUrlDraft(nextValue) {
  updateEditorImageUrlDraftFlow(nextValue);
}

export async function persistEditorImageUrlOnBlur(render, rowId, languageCode) {
  await persistEditorImageUrlOnBlurFlow(render, rowId, languageCode, {
    updateEditorChapterRow,
    loadActiveEditorFieldHistory,
  });
}

export async function submitEditorImageUrl(render, rowId, languageCode) {
  await submitEditorImageUrlFlow(render, rowId, languageCode, {
    updateEditorChapterRow,
    loadActiveEditorFieldHistory,
  });
}

export function openEditorImageUpload(render, rowId, languageCode) {
  openEditorImageUploadFlow(render, rowId, languageCode);
}

export async function openEditorImageUploadPicker(render, rowId, languageCode) {
  await openEditorImageUploadPickerFlow(render, rowId, languageCode, {
    updateEditorChapterRow,
    loadActiveEditorFieldHistory,
  });
}

export async function handleDroppedEditorImageFile(render, rowId, languageCode, file) {
  await handleDroppedEditorImageFileFlow(render, rowId, languageCode, file, {
    updateEditorChapterRow,
    loadActiveEditorFieldHistory,
  });
}

export async function handleDroppedEditorImagePath(render, path) {
  await handleDroppedEditorImagePathFlow(render, path, {
    updateEditorChapterRow,
    loadActiveEditorFieldHistory,
  });
}

export function collapseEmptyEditorImageEditor(render, rowId, languageCode) {
  collapseEmptyEditorImageEditorFlow(render, rowId, languageCode);
}

export function dismissActiveIdleEditorImageUpload(render) {
  return dismissActiveIdleEditorImageUploadFlow(render);
}

export async function removeEditorLanguageImage(render, rowId, languageCode) {
  await removeEditorLanguageImageFlow(render, rowId, languageCode, {
    updateEditorChapterRow,
    loadActiveEditorFieldHistory,
  });
}

export function openEditorImagePreview(render, rowId, languageCode) {
  openEditorImagePreviewFlow(render, rowId, languageCode);
}

export function closeEditorImagePreview(render) {
  closeEditorImagePreviewFlow(render);
}

export function closeEditorImageInvalidFileModal(render) {
  closeEditorImageInvalidFileModalFlow(render);
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
