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
  updateEditorConflictResolutionFinalImageUrl as updateEditorConflictResolutionFinalImageUrlFlow,
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
import {
  cancelEditorAiReviewAllModal as cancelEditorAiReviewAllModalFlow,
  confirmEditorAiReviewAll as confirmEditorAiReviewAllFlow,
  continueEditorAiReviewAllPreflight as continueEditorAiReviewAllPreflightFlow,
  dismissEditorAiReviewAllFilterModal as dismissEditorAiReviewAllFilterModalFlow,
  openEditorAiReviewAllModal as openEditorAiReviewAllModalFlow,
  updateEditorAiReviewAllMode as updateEditorAiReviewAllModeFlow,
} from "./editor-ai-review-all-flow.js";
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
import { insertEditorSeparator as insertEditorSeparatorFlow } from "./editor-separator-flow.js";
import {
  closeEditorInsertLinkModal as closeEditorInsertLinkModalFlow,
  openEditorInsertLink as openEditorInsertLinkFlow,
  submitEditorInsertLink as submitEditorInsertLinkFlow,
} from "./editor-link-flow.js";
export {
  updateEditorInsertLinkUrlDraft,
  validateEditorLinkUrl,
} from "./editor-link-flow.js";
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
  cancelEditorClearTranslationsModal as cancelEditorClearTranslationsModalFlow,
  cancelEditorUnreviewAllModal as cancelEditorUnreviewAllModalFlow,
  confirmEditorClearTranslations as confirmEditorClearTranslationsFlow,
  confirmEditorUnreviewAll as confirmEditorUnreviewAllFlow,
  flushDirtyEditorRows as flushDirtyEditorRowsFlow,
  openEditorClearTranslationsModal as openEditorClearTranslationsModalFlow,
  openEditorFootnote as openEditorFootnoteFlow,
  openEditorFootnoteEntry as openEditorFootnoteEntryFlow,
  openEditorImageCaption as openEditorImageCaptionFlow,
  openEditorUnreviewAllModal as openEditorUnreviewAllModalFlow,
  persistEditorRowOnBlur as persistEditorRowOnBlurFlow,
  reviewEditorClearTranslations as reviewEditorClearTranslationsFlow,
  resolveEditorRowConflict as resolveEditorRowConflictFlow,
  scheduleDirtyEditorRowScan as scheduleDirtyEditorRowScanFlow,
  toggleEditorRowFieldMarker as toggleEditorRowFieldMarkerFlow,
  updateEditorClearTranslationsLanguageSelection as updateEditorClearTranslationsLanguageSelectionFlow,
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
  closeEditorExportOptions as closeEditorExportOptionsFlow,
  openEditorExportOptions as openEditorExportOptionsFlow,
  selectEditorExportOption as selectEditorExportOptionFlow,
  submitEditorExport as submitEditorExportFlow,
  toggleEditorExportCategory as toggleEditorExportCategoryFlow,
} from "./editor-export-flow.js";
import {
  closeWordPressExportSuccessModal as closeWordPressExportSuccessModalFlow,
  connectWordPress as connectWordPressFlow,
  disconnectWordPress as disconnectWordPressFlow,
  searchWordPressPosts as searchWordPressPostsFlow,
  selectWordPressPost as selectWordPressPostFlow,
  setWordPressExportMode as setWordPressExportModeFlow,
} from "./editor-export-wordpress-flow.js";
import {
  moveEditorPreviewSearch as moveEditorPreviewSearchFlow,
  refreshEditorPreviewAfterTargetLanguageChange,
  resetEditorPreviewModeScrollSnapshot,
  setEditorMode as setEditorModeFlow,
  jumpFromPreviewBlockToTranslateMode as jumpFromPreviewBlockToTranslateModeFlow,
  updateEditorPreviewLanguage as updateEditorPreviewLanguageFlow,
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
  captureTargetLanguageManagerPickerScrollTop as captureTargetLanguageManagerPickerScrollTopFlow,
  closeTargetLanguageManager as closeTargetLanguageManagerFlow,
  closeTargetLanguageManagerPicker as closeTargetLanguageManagerPickerFlow,
  MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE,
  MANAGE_TARGET_LANGUAGES_OPTION_VALUE,
  moveTargetLanguageManagerLanguageToIndex as moveTargetLanguageManagerLanguageToIndexFlow,
  openTargetLanguageManager as openTargetLanguageManagerFlow,
  openTargetLanguageManagerPicker as openTargetLanguageManagerPickerFlow,
  removeTargetLanguageManagerLanguage as removeTargetLanguageManagerLanguageFlow,
  restoreTargetLanguageManagerPickerScrollTop as restoreTargetLanguageManagerPickerScrollTopFlow,
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

export function loadActiveEditorFieldHistory(render, options = {}) {
  loadActiveEditorFieldHistoryFlow(render, options);
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

// Logical identity of the focused text control, stable across DOM remounts.
// Empty string when focus is not on a text-editing control (body, buttons).
function describeFocusedTextControl() {
  const activeElement = typeof document !== "undefined" ? document.activeElement : null;
  if (!(activeElement instanceof HTMLElement)) {
    return "";
  }

  const isTextControl =
    activeElement instanceof HTMLTextAreaElement
    || activeElement instanceof HTMLInputElement
    || activeElement.isContentEditable === true;
  if (!isTextControl) {
    return "";
  }

  const cluster = activeElement.closest("[data-editor-language-cluster]");
  if (cluster instanceof HTMLElement) {
    return `cluster:${cluster.dataset.rowId ?? ""}:${cluster.dataset.languageCode ?? ""}`;
  }

  return `control:${activeElement.getAttributeNames().filter((name) => name.startsWith("data-")).join(",")}`;
}

export async function setActiveEditorField(render, rowId, languageCode, options = {}) {
  if (!rowId || !languageCode) {
    return;
  }

  const focusBeforeActivation = describeFocusedTextControl();
  if (!(await ensureEditorRowReadyForActivation(render, rowId, options))) {
    return;
  }

  // A slow row load must not resurrect editing controls after the user moved
  // on: if focus landed on a different text control while we waited (search
  // box, another row), this activation is superseded.
  const focusAfterActivation = describeFocusedTextControl();
  if (
    focusAfterActivation !== focusBeforeActivation
    && focusAfterActivation !== ""
    && focusAfterActivation !== `cluster:${rowId}:${languageCode}`
  ) {
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
      { extraPaints: 0, skipAnchorRestore: true },
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

export async function runEditorAiReview(render, reviewMode) {
  await runEditorAiReviewFlow(render, reviewMode);
}

export function openEditorAiReviewAllModal(render) {
  openEditorAiReviewAllModalFlow(render);
}

export function cancelEditorAiReviewAllModal(render) {
  cancelEditorAiReviewAllModalFlow(render);
}

export function continueEditorAiReviewAllPreflight(render) {
  continueEditorAiReviewAllPreflightFlow(render);
}

export function updateEditorAiReviewAllMode(render, mode) {
  updateEditorAiReviewAllModeFlow(render, mode);
}

export function dismissEditorAiReviewAllFilterModal(render) {
  dismissEditorAiReviewAllFilterModalFlow(render);
}

export async function confirmEditorAiReviewAll(render) {
  await confirmEditorAiReviewAllFlow(render, editorPersistenceOperations());
}

export async function runEditorAiTranslate(render, actionId) {
  await runEditorAiTranslateFlow(render, actionId, {
    updateEditorRowFieldValue,
    persistEditorRowOnBlur,
    syncEditorGlossaryHighlightRowDom,
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

export function openEditorClearTranslationsModal(render) {
  openEditorClearTranslationsModalFlow(render);
}

export function cancelEditorClearTranslationsModal(render) {
  cancelEditorClearTranslationsModalFlow(render);
}

export function updateEditorClearTranslationsLanguageSelection(render, languageCode, selected) {
  updateEditorClearTranslationsLanguageSelectionFlow(render, languageCode, selected);
}

export function reviewEditorClearTranslations(render) {
  reviewEditorClearTranslationsFlow(render);
}

export async function confirmEditorClearTranslations(render) {
  await confirmEditorClearTranslationsFlow(render, editorPersistenceOperations());
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

export function updateEditorConflictResolutionFinalImageUrl(nextValue) {
  updateEditorConflictResolutionFinalImageUrlFlow(nextValue);
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

export function updateEditorPreviewLanguage(render, nextCode) {
  updateEditorPreviewLanguageFlow(render, nextCode);
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

export function jumpFromPreviewBlockToTranslateMode(render, previewBlock) {
  return jumpFromPreviewBlockToTranslateModeFlow(render, previewBlock);
}

export function updateEditorPreviewSearchQuery(render, nextValue) {
  updateEditorPreviewSearchQueryFlow(render, nextValue);
}

export function moveEditorPreviewSearch(render, direction = "next") {
  moveEditorPreviewSearchFlow(render, direction);
}

export function openEditorExportOptions(render) {
  openEditorExportOptionsFlow(render);
}

export function closeEditorExportOptions(render) {
  closeEditorExportOptionsFlow(render);
}

export function toggleEditorExportCategory(render, categoryId) {
  toggleEditorExportCategoryFlow(render, categoryId);
}

export function selectEditorExportOption(render, optionId) {
  selectEditorExportOptionFlow(render, optionId);
}

export async function submitEditorExport(render) {
  await submitEditorExportFlow(render);
}

export function closeWordPressExportSuccessModal(render) {
  closeWordPressExportSuccessModalFlow(render);
}

export async function connectWordPress(render) {
  await connectWordPressFlow(render);
}

export async function disconnectWordPress(render) {
  await disconnectWordPressFlow(render);
}

export async function searchWordPressPosts(render) {
  await searchWordPressPostsFlow(render);
}

export function selectWordPressPost(render, postId) {
  selectWordPressPostFlow(render, postId);
}

export function setWordPressExportMode(render, mode) {
  setWordPressExportModeFlow(render, mode);
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

export function captureTargetLanguageManagerPickerScrollTop() {
  return captureTargetLanguageManagerPickerScrollTopFlow();
}

export function restoreTargetLanguageManagerPickerScrollTop(scrollTop) {
  restoreTargetLanguageManagerPickerScrollTopFlow(scrollTop);
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

export function updateEditorRowFieldValue(rowId, languageCode, nextValue, contentKind = "field", options = {}) {
  updateEditorRowFieldValueFlow(rowId, languageCode, nextValue, contentKind, options, {
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

export function insertEditorSeparator(render, button) {
  insertEditorSeparatorFlow(render, button, {
    updateEditorRowFieldValueForContentKind: updateEditorRowFieldValue,
    syncEditorRowTextareaHeight,
    syncEditorVirtualizationRowLayout,
    syncEditorGlossaryHighlightRowDom,
  });
}

export function openEditorInsertLink(render, button) {
  openEditorInsertLinkFlow(render, button);
}

export function closeEditorInsertLinkModal(render) {
  closeEditorInsertLinkModalFlow(render);
}

export function submitEditorInsertLink(render) {
  submitEditorInsertLinkFlow(render, {
    updateEditorRowFieldValueForContentKind: updateEditorRowFieldValue,
    syncEditorRowTextareaHeight,
    syncEditorVirtualizationRowLayout,
    syncEditorGlossaryHighlightRowDom,
  });
}

export function openEditorFootnote(render, rowId, languageCode, options = {}) {
  openEditorFootnoteFlow(render, rowId, languageCode, {
    viewportSnapshot: resolveEditorMainFieldViewportSnapshot(rowId, languageCode, options),
    updateEditorChapterRow,
  });
}

export function openEditorFootnoteEntry(render, rowId, languageCode, marker, options = {}) {
  openEditorFootnoteEntryFlow(render, rowId, languageCode, marker, {
    viewportSnapshot: resolveEditorMainFieldViewportSnapshot(rowId, languageCode, options),
  });
}

export function openEditorImageCaption(render, rowId, languageCode, options = {}) {
  openEditorImageCaptionFlow(render, rowId, languageCode, {
    viewportSnapshot: resolveEditorMainFieldViewportSnapshot(rowId, languageCode, options),
  });
}

export function collapseEmptyEditorFootnote(render, rowId, languageCode, options = {}) {
  collapseEmptyEditorFootnoteFlow(render, rowId, languageCode, options);
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

export async function toggleEditorRowFieldMarker(render, rowId, languageCode, kind, options = {}) {
  await toggleEditorRowFieldMarkerFlow(
    render,
    rowId,
    languageCode,
    kind,
    editorPersistenceOperations(),
    {
      viewportSnapshot: resolveEditorMainFieldViewportSnapshot(rowId, languageCode, options),
    },
  );
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
