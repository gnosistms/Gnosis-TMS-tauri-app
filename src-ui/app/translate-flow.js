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
import { toggleEditorInlineStyle as toggleEditorInlineStyleFlow } from "./editor-inline-markup-flow.js";
import {
  applyEditorAssistantDraft as applyEditorAssistantDraftFlow,
  runEditorAiAssistant as runEditorAiAssistantFlow,
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
  normalizeLanguageSelections,
  persistEditorChapterSelections as persistEditorChapterSelectionsFlow,
  updateEditorSourceLanguage as updateEditorSourceLanguageFlow,
  updateEditorTargetLanguage as updateEditorTargetLanguageFlow,
} from "./editor-selection-flow.js";
import { requireBrokerSession } from "./auth-flow.js";
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
import { invoke, waitForNextPaint } from "./runtime.js";
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
  buildEditorPreviewDocument,
  countEditorPreviewSearchMatches,
  EDITOR_MODE_PREVIEW,
  EDITOR_MODE_TRANSLATE,
  normalizeEditorMode,
  normalizeEditorPreviewSearchState,
  serializeEditorPreviewHtml,
  stepEditorPreviewSearchState,
} from "./editor-preview.js";
import {
  hideNavigationLoadingModal,
  showNavigationLoadingModal,
} from "./navigation-loading.js";
import {
  captureRenderScrollSnapshot,
  captureTranslateAnchorForRow,
  lockScreenScrollSnapshot,
  unlockScreenScrollSnapshot,
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
  createTargetLanguageManagerState,
  state,
} from "./state.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { findIsoLanguageOption } from "../lib/language-options.js";
import { showNoticeBadge } from "./status-feedback.js";

export const MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE = "__manage_target_languages__";
export const MANAGE_TARGET_LANGUAGES_OPTION_VALUE = MANAGE_CHAPTER_LANGUAGES_OPTION_VALUE;
export { resolveChapterSourceWordCount };

let previewModeTranslateScrollSnapshot = null;

function cloneManagedChapterLanguage(language) {
  const code = String(language?.code ?? "").trim().toLowerCase();
  if (!code) {
    return null;
  }

  const isoOption = findIsoLanguageOption(code);
  const name = String(language?.name ?? "").trim() || isoOption?.name || code;
  const role = String(language?.role ?? "").trim().toLowerCase() === "source"
    ? "source"
    : "target";
  return {
    code,
    name,
    role,
  };
}

function managedChapterLanguagesFromEditorState() {
  return (Array.isArray(state.editorChapter?.languages) ? state.editorChapter.languages : [])
    .map(cloneManagedChapterLanguage)
    .filter(Boolean);
}

function currentEditorMode() {
  return normalizeEditorMode(state.editorChapter?.mode);
}

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

function currentPreviewBlocks(chapterState = state.editorChapter) {
  return buildEditorPreviewDocument(
    chapterState?.rows,
    chapterState?.selectedTargetLanguageCode,
  );
}

function normalizedPreviewSearchState(chapterState = state.editorChapter) {
  return normalizeEditorPreviewSearchState(chapterState?.previewSearch);
}

function previewSearchStateWithTotal(chapterState = state.editorChapter, overrides = {}) {
  const nextState = {
    ...normalizedPreviewSearchState(chapterState),
    ...overrides,
  };
  return {
    ...nextState,
    totalMatchCount: countEditorPreviewSearchMatches(currentPreviewBlocks(chapterState), nextState.query),
  };
}

function renderPreviewMode(render, options = {}) {
  if (options.header !== false) {
    render?.({ scope: "translate-header" });
  }
  if (options.body !== false) {
    render?.({ scope: "translate-body" });
  }
}

function currentPreviewSearchInputValue() {
  const input = document.querySelector("[data-preview-search-input]");
  return input instanceof HTMLInputElement ? input.value : null;
}

function currentPreviewSearchMatchIndex() {
  const activeMatch = document.querySelector(
    ".translate-preview__search-match.is-active[data-preview-search-match-index]",
  );
  if (!(activeMatch instanceof HTMLElement)) {
    return null;
  }

  const index = Number.parseInt(activeMatch.dataset.previewSearchMatchIndex ?? "", 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function focusPreviewSearchInput(selection = null, value = null) {
  requestAnimationFrame(() => {
    const input = document.querySelector("[data-preview-search-input]");
    if (!(input instanceof HTMLInputElement) || input.disabled) {
      return;
    }

    if (typeof value === "string" && input.value !== value) {
      input.value = value;
    }
    input.focus({ preventScroll: true });
    if (
      selection
      && typeof selection.selectionStart === "number"
      && typeof selection.selectionEnd === "number"
    ) {
      input.setSelectionRange(
        selection.selectionStart,
        selection.selectionEnd,
        selection.selectionDirection ?? "none",
      );
    }
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

export async function runEditorAiAssistant(render) {
  await runEditorAiAssistantFlow(render);
}

export async function applyEditorAssistantDraft(render, itemId) {
  await applyEditorAssistantDraftFlow(render, itemId, {
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
  });
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
  previewModeTranslateScrollSnapshot = null;
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

  if (currentEditorMode() !== EDITOR_MODE_PREVIEW) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    previewSearch: previewSearchStateWithTotal(),
  };
  renderPreviewMode(render);
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
  const normalizedMode = normalizeEditorMode(nextMode);
  const previousMode = currentEditorMode();
  if (normalizedMode === previousMode) {
    return;
  }

  if (previousMode === EDITOR_MODE_TRANSLATE) {
    previewModeTranslateScrollSnapshot = captureRenderScrollSnapshot("translate");
  }

  state.editorChapter = {
    ...state.editorChapter,
    mode: normalizedMode,
    previewSearch:
      normalizedMode === EDITOR_MODE_PREVIEW
        ? previewSearchStateWithTotal()
        : normalizedPreviewSearchState(state.editorChapter.previewSearch),
  };

  if (previousMode === EDITOR_MODE_PREVIEW && normalizedMode === EDITOR_MODE_TRANSLATE && previewModeTranslateScrollSnapshot) {
    lockScreenScrollSnapshot("translate", previewModeTranslateScrollSnapshot);
    render?.();
    void waitForNextPaint().then(() => unlockScreenScrollSnapshot("translate"));
    return;
  }

  render?.();
}

export function updateEditorPreviewSearchQuery(render, nextValue) {
  if (currentEditorMode() !== EDITOR_MODE_PREVIEW) {
    return;
  }

  const query = typeof nextValue === "string" ? nextValue : String(nextValue ?? "");
  state.editorChapter = {
    ...state.editorChapter,
    previewSearch: previewSearchStateWithTotal(state.editorChapter, {
      query,
      activeMatchIndex: 0,
    }),
  };
  renderPreviewMode(render);
}

export function moveEditorPreviewSearch(render, direction = "next") {
  if (currentEditorMode() !== EDITOR_MODE_PREVIEW) {
    return;
  }

  const activePreviewSearchInput = document.activeElement instanceof HTMLInputElement
    && document.activeElement.matches("[data-preview-search-input]")
    ? document.activeElement
    : null;
  const selection = activePreviewSearchInput
    ? {
      selectionStart: activePreviewSearchInput.selectionStart,
      selectionEnd: activePreviewSearchInput.selectionEnd,
      selectionDirection: activePreviewSearchInput.selectionDirection,
    }
    : null;
  const liveQuery = currentPreviewSearchInputValue();
  const liveMatchIndex = currentPreviewSearchMatchIndex();
  const currentSearchState = normalizedPreviewSearchState(state.editorChapter.previewSearch);
  const nextSearchBaseState =
    (typeof liveQuery === "string" && liveQuery !== currentSearchState.query)
    || (typeof liveMatchIndex === "number" && liveMatchIndex !== currentSearchState.activeMatchIndex)
      ? previewSearchStateWithTotal(state.editorChapter, {
        ...currentSearchState,
        ...(typeof liveQuery === "string" ? { query: liveQuery } : {}),
        ...(typeof liveMatchIndex === "number" ? { activeMatchIndex: liveMatchIndex } : {}),
      })
      : currentSearchState;
  const nextPreviewSearch = stepEditorPreviewSearchState(
    currentPreviewBlocks(),
    nextSearchBaseState,
    direction,
  );
  state.editorChapter = {
    ...state.editorChapter,
    previewSearch: nextPreviewSearch,
  };
  renderPreviewMode(render);
  focusPreviewSearchInput(selection, nextPreviewSearch.query);
}

export async function copyEditorPreviewHtml(render) {
  if (currentEditorMode() !== EDITOR_MODE_PREVIEW) {
    return;
  }

  const html = serializeEditorPreviewHtml(currentPreviewBlocks());
  if (!html) {
    showNoticeBadge("Nothing to copy.", render);
    return;
  }

  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    showNoticeBadge("Clipboard access is not available.", render, 1800);
    return;
  }

  try {
    await navigator.clipboard.writeText(html);
    showNoticeBadge("Copied HTML.", render, 1400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNoticeBadge(message || "The HTML could not be copied.", render, 2200);
  }
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
    ...createTargetLanguageManagerState(),
    isOpen: true,
    chapterId: state.editorChapter?.chapterId ?? null,
    languages: managedChapterLanguagesFromEditorState(),
  };
}

export function closeTargetLanguageManager() {
  state.targetLanguageManager = createTargetLanguageManagerState();
}

export function openTargetLanguageManagerPicker() {
  if (!state.targetLanguageManager?.isOpen) {
    return;
  }

  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    isPickerOpen: true,
    error: "",
  };
}

export function closeTargetLanguageManagerPicker() {
  if (!state.targetLanguageManager?.isOpen) {
    return;
  }

  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    isPickerOpen: false,
  };
}

export function addTargetLanguageManagerLanguage(languageCode) {
  if (!state.targetLanguageManager?.isOpen) {
    return;
  }

  const code = String(languageCode ?? "").trim().toLowerCase();
  if (!code || state.targetLanguageManager.languages.some((language) => language.code === code)) {
    return;
  }

  const option = findIsoLanguageOption(code);
  if (!option) {
    return;
  }

  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    languages: [
      ...(Array.isArray(state.targetLanguageManager.languages) ? state.targetLanguageManager.languages : []),
      {
        code: option.code,
        name: option.name,
        role: "target",
      },
    ],
    isPickerOpen: false,
    error: "",
  };
}

export function removeTargetLanguageManagerLanguage(index) {
  if (
    !state.targetLanguageManager?.isOpen
    || !Number.isInteger(index)
    || index < 0
  ) {
    return;
  }

  const languages = Array.isArray(state.targetLanguageManager.languages)
    ? state.targetLanguageManager.languages
    : [];
  if (languages.length <= 1 || index >= languages.length) {
    return;
  }

  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    languages: languages.filter((_, languageIndex) => languageIndex !== index),
    error: "",
  };
}

export function moveTargetLanguageManagerLanguageToIndex(fromIndex, toIndex) {
  if (
    !state.targetLanguageManager?.isOpen
    || !Number.isInteger(fromIndex)
    || fromIndex < 0
    || !Number.isInteger(toIndex)
    || toIndex < 0
  ) {
    return;
  }

  const languages = Array.isArray(state.targetLanguageManager.languages)
    ? [...state.targetLanguageManager.languages]
    : [];
  if (fromIndex >= languages.length) {
    return;
  }

  const boundedIndex = Math.min(toIndex, languages.length);
  const adjustedIndex = boundedIndex > fromIndex ? boundedIndex - 1 : boundedIndex;
  if (adjustedIndex === fromIndex) {
    return;
  }

  const [language] = languages.splice(fromIndex, 1);
  languages.splice(adjustedIndex, 0, language);
  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    languages,
    error: "",
  };
}

export async function submitTargetLanguageManager(render) {
  const modal = state.targetLanguageManager;
  if (!modal?.isOpen || modal.status === "loading") {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(modal.chapterId);
  if (
    !Number.isFinite(team?.installationId)
    || !context?.project?.name
    || !context?.project?.fullName
    || !modal.chapterId
  ) {
    state.targetLanguageManager = {
      ...modal,
      status: "idle",
      error: "Could not determine which file to update.",
    };
    render?.();
    return;
  }

  const draftLanguages = (Array.isArray(modal.languages) ? modal.languages : [])
    .map(cloneManagedChapterLanguage)
    .filter(Boolean);
  if (draftLanguages.length === 0) {
    state.targetLanguageManager = {
      ...modal,
      status: "idle",
      error: "A file must contain at least one language.",
    };
    render?.();
    return;
  }

  state.targetLanguageManager = {
    ...modal,
    status: "loading",
    error: "",
  };
  render?.();

  try {
    const sessionToken = requireBrokerSession();
    if (!(await flushDirtyEditorRows(render))) {
      state.targetLanguageManager = {
        ...state.targetLanguageManager,
        status: "idle",
        error: "Resolve pending editor saves before changing chapter languages.",
      };
      render?.();
      return;
    }

    const payload = await invoke("update_gtms_chapter_languages", {
      sessionToken,
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        fullName: context.project.fullName,
        repoId: Number.isFinite(context.project.repoId) ? context.project.repoId : null,
        defaultBranchName: context.project.defaultBranchName ?? "main",
        defaultBranchHeadOid: context.project.defaultBranchHeadOid ?? null,
        chapterId: modal.chapterId,
        languages: draftLanguages,
      },
    });
    const nextSelections = normalizeLanguageSelections(
      payload.languages,
      payload.selectedSourceLanguageCode,
      payload.selectedTargetLanguageCode,
    );
    applyChapterMetadataToState(modal.chapterId, {
      languages: Array.isArray(payload.languages) ? payload.languages : [],
      selectedSourceLanguageCode: nextSelections.selectedSourceLanguageCode,
      selectedTargetLanguageCode: nextSelections.selectedTargetLanguageCode,
    });

    closeTargetLanguageManager();
    render?.();
    await reloadSelectedChapterEditorData(render, { preserveVisibleRows: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.targetLanguageManager = {
      ...state.targetLanguageManager,
      status: "idle",
      error: message || "The chapter languages could not be updated.",
    };
    render?.();
  }
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
