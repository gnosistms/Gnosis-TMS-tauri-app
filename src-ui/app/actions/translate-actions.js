import { actionSuffix } from "../action-helpers.js";
import { waitForNextPaint } from "../runtime.js";
import { state } from "../state.js";
import {
  captureLanguageToggleVisibilityAnchor,
  captureTranslateRowAnchor,
  restoreTranslateRowAnchor,
} from "../scroll-state.js";
import {
  cancelEditorConflictResolutionModal,
  cancelEditorClearTranslationsModal,
  cancelEditorDeriveGlossariesModal,
  cancelEditorAiReviewAllModal,
  cancelEditorAiTranslateAllModal,
  cancelEditorUnreviewAllModal,
  cancelEditorReplaceUndoModal,
  cancelEditorRowPermanentDeletionModal,
  cancelInsertEditorRowModal,
  closeTargetLanguageManagerPicker,
  confirmEditorUnreviewAll,
  confirmEditorAiTranslateAll,
  confirmEditorClearTranslations,
  confirmEditorDeriveGlossaries,
  confirmEditorAiReviewAll,
  confirmEditorReplaceUndo,
  confirmEditorRowPermanentDeletion,
  confirmInsertEditorRow,
  addTargetLanguageManagerLanguage,
  moveTargetLanguageManagerLanguageToIndex,
  openEditorFootnote,
  openEditorImageCaption,
  closeTargetLanguageManager,
  openTargetLanguageManagerPicker,
  closeEditorImageUrl,
  closeEditorImageInvalidFileModal,
  closeEditorImagePreview,
  copyEditorPreviewHtml,
  copyEditorConflictResolutionVersion,
  deleteActiveEditorRowComment,
  moveEditorPreviewSearch,
  openEditorImagePreview,
  openEditorImageUpload,
  openEditorImageUploadPicker,
  openEditorImageUrl,
  openEditorConflictResolutionModal,
  openEditorClearTranslationsModal,
  openEditorDeriveGlossariesModal,
  openEditorAiReviewAllModal,
  openEditorAiTranslateAllModal,
  openEditorUnreviewAllModal,
  openEditorReplaceUndoModal,
  openEditorRowComments,
  openEditorRowPermanentDeletionModal,
  openInsertEditorRowModal,
  applyEditorAiReview,
  continueEditorAiReviewAllPreflight,
  dismissEditorAiReviewAllFilterModal,
  applyEditorAssistantDraft,
  replaceSelectedEditorRows,
  reviewEditorClearTranslations,
  removeEditorLanguageImage,
  runEditorAiTranslate,
  runEditorAiAssistant,
  runEditorAiReview,
  saveEditorConflictResolution,
  resolveEditorRowConflict,
  restoreEditorFieldHistory,
  restoreEditorRow,
  saveActiveEditorRowComment,
  selectTargetLanguageManagerPickerLanguage,
  selectAllEditorReplaceRows,
  setEditorMode,
  showEditorRowInContext,
  softDeleteEditorRow,
  submitTargetLanguageManager,
  switchEditorSidebarTab,
  toggleEditorSearchFilterCaseSensitive,
  toggleDeletedEditorRowGroup,
  toggleEditorInlineStyle,
  toggleEditorAssistantDraftDiff,
  toggleEditorRowFieldMarker,
  toggleEditorHistoryGroupExpanded,
  toggleEditorReviewSectionExpanded,
  updateEditorRowTextStyle,
  toggleEditorLanguageCollapsed,
  dismissActiveIdleEditorImageUpload,
  removeTargetLanguageManagerLanguage,
} from "../translate-flow.js";

export function createTranslateActions(render) {
  return async function handleTranslateAction(action, event) {
    const moveTargetLanguageMatch = /^move-target-language-manager-language:(\d+):(\d+)$/.exec(action);
    if (moveTargetLanguageMatch) {
      moveTargetLanguageManagerLanguageToIndex(
        Number.parseInt(moveTargetLanguageMatch[1], 10),
        Number.parseInt(moveTargetLanguageMatch[2], 10),
      );
      render();
      return true;
    }

    const removeTargetLanguageMatch = /^remove-target-language-manager-language:(\d+)$/.exec(action);
    if (removeTargetLanguageMatch) {
      removeTargetLanguageManagerLanguage(Number.parseInt(removeTargetLanguageMatch[1], 10));
      render();
      return true;
    }

    const selectTargetLanguageMatch = /^select-target-language-manager-picker-language:([a-z]{2})$/.exec(action);
    if (selectTargetLanguageMatch) {
      selectTargetLanguageManagerPickerLanguage(selectTargetLanguageMatch[1]);
      render();
      return true;
    }

    if (action === "add-target-language-manager-language") {
      addTargetLanguageManagerLanguage();
      render();
      return true;
    }

    if (action === "close-target-language-manager") {
      closeTargetLanguageManager();
      render();
      return true;
    }

    if (action === "open-target-language-manager-picker") {
      openTargetLanguageManagerPicker();
      render();
      return true;
    }

    if (action === "close-target-language-manager-picker") {
      closeTargetLanguageManagerPicker();
      render();
      return true;
    }

    if (action === "submit-target-language-manager") {
      await submitTargetLanguageManager(render);
      return true;
    }

    if (action === "cancel-insert-editor-row") {
      cancelInsertEditorRowModal();
      render();
      return true;
    }

    if (action === "cancel-editor-row-permanent-delete") {
      cancelEditorRowPermanentDeletionModal();
      render();
      return true;
    }

    if (action === "cancel-editor-replace-undo") {
      cancelEditorReplaceUndoModal();
      render();
      return true;
    }

    if (action === "cancel-editor-unreview-all") {
      cancelEditorUnreviewAllModal(render);
      return true;
    }

    if (action === "cancel-editor-ai-translate-all") {
      cancelEditorAiTranslateAllModal(render);
      return true;
    }

    if (action === "cancel-editor-ai-review-all") {
      cancelEditorAiReviewAllModal(render);
      return true;
    }

    if (action === "cancel-editor-clear-translations") {
      cancelEditorClearTranslationsModal(render);
      return true;
    }

    if (action === "cancel-editor-derive-glossaries") {
      cancelEditorDeriveGlossariesModal(render);
      return true;
    }

    if (action === "cancel-editor-conflict-resolution") {
      cancelEditorConflictResolutionModal(render);
      return true;
    }

    if (action === "confirm-insert-editor-row-before") {
      await confirmInsertEditorRow(render, "before");
      return true;
    }

    if (action === "confirm-insert-editor-row-after") {
      await confirmInsertEditorRow(render, "after");
      return true;
    }

    if (action === "confirm-editor-row-permanent-delete") {
      await confirmEditorRowPermanentDeletion(render);
      return true;
    }

    if (action === "confirm-editor-replace-undo") {
      await confirmEditorReplaceUndo(render);
      return true;
    }

    if (action === "confirm-editor-unreview-all") {
      await confirmEditorUnreviewAll(render);
      return true;
    }

    if (action === "confirm-editor-ai-translate-all") {
      await confirmEditorAiTranslateAll(render);
      return true;
    }

    if (action === "continue-editor-ai-review-all") {
      continueEditorAiReviewAllPreflight(render);
      return true;
    }

    if (action === "confirm-editor-ai-review-all") {
      await confirmEditorAiReviewAll(render);
      return true;
    }

    if (action === "dismiss-editor-ai-review-all-filter") {
      dismissEditorAiReviewAllFilterModal(render);
      return true;
    }

    if (action === "review-editor-clear-translations") {
      reviewEditorClearTranslations(render);
      return true;
    }

    if (action === "confirm-editor-clear-translations") {
      await confirmEditorClearTranslations(render);
      return true;
    }

    if (action === "confirm-editor-derive-glossaries") {
      await confirmEditorDeriveGlossaries(render);
      return true;
    }

    if (action === "save-editor-conflict-resolution") {
      await saveEditorConflictResolution(render);
      return true;
    }

    if (action === "select-all-editor-replace-rows") {
      selectAllEditorReplaceRows(render);
      return true;
    }

    if (action === "replace-selected-editor-rows") {
      await replaceSelectedEditorRows(render);
      return true;
    }

    if (action === "save-editor-comment") {
      await saveActiveEditorRowComment(render);
      return true;
    }

    if (action === "review-editor-text-now") {
      await runEditorAiReview(render);
      return true;
    }

    if (action === "run-editor-ai-translate:translate1") {
      await runEditorAiTranslate(render, "translate1");
      return true;
    }

    if (action === "run-editor-ai-translate:translate2") {
      await runEditorAiTranslate(render, "translate2");
      return true;
    }

    if (action === "run-editor-ai-assistant") {
      await runEditorAiAssistant(render);
      return true;
    }

    if (action === "apply-editor-ai-review") {
      await applyEditorAiReview(render);
      return true;
    }

    if (action === "toggle-editor-search-case-sensitive") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-editor-search-case-toggle]")
        : null;
      const nextPressed = button?.getAttribute("aria-pressed") !== "true";
      toggleEditorSearchFilterCaseSensitive(render, nextPressed);
      return true;
    }

    if (action === "toggle-editor-reviewed" || action === "toggle-editor-please-check") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      const rowId = button?.dataset.rowId ?? null;
      const languageCode = button?.dataset.languageCode ?? null;
      const kind = action === "toggle-editor-reviewed" ? "reviewed" : "please-check";
      await toggleEditorRowFieldMarker(render, rowId, languageCode, kind, {
        target: event?.target ?? null,
      });
      return true;
    }

    if (action === "open-editor-comments") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      const rowId = button?.dataset.rowId ?? null;
      const languageCode = button?.dataset.languageCode ?? null;
      openEditorRowComments(render, rowId, languageCode);
      return true;
    }

    if (action === "open-editor-unreview-all") {
      openEditorUnreviewAllModal(render);
      return true;
    }

    if (action === "open-editor-ai-translate-all") {
      openEditorAiTranslateAllModal(render);
      return true;
    }

    if (action === "open-editor-ai-review-all") {
      openEditorAiReviewAllModal(render);
      return true;
    }

    if (action === "open-editor-clear-translations") {
      openEditorClearTranslationsModal(render);
      return true;
    }

    if (action === "open-editor-derive-glossaries") {
      openEditorDeriveGlossariesModal(render);
      return true;
    }

    if (action === "set-editor-row-text-style") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-text-style]")
        : null;
      const rowId = button?.dataset.rowId ?? null;
      const textStyle = button?.dataset.textStyle ?? null;
      await updateEditorRowTextStyle(render, rowId, textStyle);
      return true;
    }

    if (action === "toggle-editor-inline-style") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-editor-inline-style-button]")
        : null;
      toggleEditorInlineStyle(render, button);
      return true;
    }

    if (action === "open-editor-footnote") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      dismissActiveIdleEditorImageUpload(render);
      const rowId = button?.dataset.rowId ?? null;
      const languageCode = button?.dataset.languageCode ?? null;
      openEditorFootnote(render, rowId, languageCode, { target: event?.target ?? null });
      return true;
    }

    if (action === "open-editor-image-caption") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      dismissActiveIdleEditorImageUpload(render);
      const rowId = button?.dataset.rowId ?? null;
      const languageCode = button?.dataset.languageCode ?? null;
      openEditorImageCaption(render, rowId, languageCode, { target: event?.target ?? null });
      return true;
    }

    if (action === "open-editor-image-url") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      openEditorImageUrl(render, button?.dataset.rowId ?? null, button?.dataset.languageCode ?? null);
      return true;
    }

    if (action === "close-editor-image-url") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      closeEditorImageUrl(render, button?.dataset.rowId ?? null, button?.dataset.languageCode ?? null);
      return true;
    }

    if (action === "open-editor-image-upload") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      openEditorImageUpload(render, button?.dataset.rowId ?? null, button?.dataset.languageCode ?? null);
      return true;
    }

    if (action === "open-editor-image-upload-picker") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      await openEditorImageUploadPicker(render, button?.dataset.rowId ?? null, button?.dataset.languageCode ?? null);
      return true;
    }

    if (action === "close-editor-image-upload") {
      dismissActiveIdleEditorImageUpload(render);
      return true;
    }

    if (action === "remove-editor-language-image") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      await removeEditorLanguageImage(render, button?.dataset.rowId ?? null, button?.dataset.languageCode ?? null);
      return true;
    }

    if (action === "open-editor-image-preview") {
      const button = event?.target instanceof Element
        ? event.target.closest("[data-row-id][data-language-code]")
        : null;
      openEditorImagePreview(render, button?.dataset.rowId ?? null, button?.dataset.languageCode ?? null);
      return true;
    }

    if (action === "close-editor-image-preview") {
      closeEditorImagePreview(render);
      return true;
    }

    if (action === "close-editor-image-invalid-file-modal") {
      closeEditorImageInvalidFileModal(render);
      return true;
    }

    if (action === "copy-editor-preview-html") {
      await copyEditorPreviewHtml(render);
      return true;
    }

    if (action === "step-editor-preview-search:previous") {
      moveEditorPreviewSearch(render, "previous");
      return true;
    }

    if (action === "step-editor-preview-search:next") {
      moveEditorPreviewSearch(render, "next");
      return true;
    }

    const historyCommitSha = actionSuffix(action, "restore-editor-history:");
    if (historyCommitSha !== null) {
      await restoreEditorFieldHistory(render, historyCommitSha);
      return true;
    }

    const undoReplaceCommitSha = actionSuffix(action, "open-editor-replace-undo:");
    if (undoReplaceCommitSha !== null) {
      openEditorReplaceUndoModal(undoReplaceCommitSha);
      render();
      return true;
    }

    const historyGroupKey = actionSuffix(action, "toggle-editor-history-group:");
    if (historyGroupKey !== null) {
      toggleEditorHistoryGroupExpanded(historyGroupKey);
      render();
      return true;
    }

    const reviewSectionKey = actionSuffix(action, "toggle-editor-review-section:");
    if (reviewSectionKey !== null) {
      toggleEditorReviewSectionExpanded(reviewSectionKey);
      render();
      return true;
    }

    const deletedRowGroupKey = actionSuffix(action, "toggle-editor-deleted-row-group:");
    if (deletedRowGroupKey !== null) {
      const scrollAnchor = captureTranslateRowAnchor(event?.target ?? null);
      toggleDeletedEditorRowGroup(render, deletedRowGroupKey, scrollAnchor);
      return true;
    }

    const sidebarTab = actionSuffix(action, "switch-editor-sidebar-tab:");
    if (sidebarTab !== null) {
      switchEditorSidebarTab(render, sidebarTab);
      return true;
    }

    const commentId = actionSuffix(action, "delete-editor-comment:");
    if (commentId !== null) {
      await deleteActiveEditorRowComment(render, commentId);
      return true;
    }

    const assistantDraftId = actionSuffix(action, "apply-editor-assistant-draft:");
    if (assistantDraftId !== null) {
      await applyEditorAssistantDraft(render, assistantDraftId);
      return true;
    }

    const assistantDraftDiffId = actionSuffix(action, "toggle-editor-assistant-draft-diff:");
    if (assistantDraftDiffId !== null) {
      toggleEditorAssistantDraftDiff(render, assistantDraftDiffId);
      return true;
    }

    const copyConflictSide = actionSuffix(action, "copy-editor-conflict-version:");
    if (copyConflictSide !== null) {
      await copyEditorConflictResolutionVersion(render, copyConflictSide);
      return true;
    }

    const insertRowId = actionSuffix(action, "open-insert-editor-row:");
    if (insertRowId !== null) {
      openInsertEditorRowModal(insertRowId);
      render();
      return true;
    }

    const softDeleteRowId = actionSuffix(action, "soft-delete-editor-row:");
    if (softDeleteRowId !== null) {
      const scrollAnchor = captureTranslateRowAnchor(event?.target ?? null);
      await softDeleteEditorRow(render, softDeleteRowId, scrollAnchor);
      return true;
    }

    const restoreRowId = actionSuffix(action, "restore-editor-row:");
    if (restoreRowId !== null) {
      await restoreEditorRow(render, restoreRowId);
      return true;
    }

    const showInContextRowId = actionSuffix(action, "show-editor-row-in-context:");
    if (showInContextRowId !== null) {
      await showEditorRowInContext(render, showInContextRowId);
      return true;
    }

    const permanentDeleteRowId = actionSuffix(action, "open-editor-row-permanent-delete:");
    if (permanentDeleteRowId !== null) {
      openEditorRowPermanentDeletionModal(permanentDeleteRowId);
      render();
      return true;
    }

    const conflictAction = actionSuffix(action, "resolve-editor-row-conflict:");
    if (conflictAction !== null) {
      const [rowId, resolution] = conflictAction.split(":");
      await resolveEditorRowConflict(render, rowId, resolution);
      return true;
    }

    const conflictModalAction = actionSuffix(action, "open-editor-conflict-resolution:");
    if (conflictModalAction !== null) {
      const [rowId, languageCode] = conflictModalAction.split(":");
      openEditorConflictResolutionModal(render, rowId, languageCode);
      return true;
    }

    const languageCode = actionSuffix(action, "toggle-editor-language:");
    if (languageCode !== null) {
      const scrollAnchor = captureLanguageToggleVisibilityAnchor(
        event?.target ?? null,
        state.editorChapter?.collapsedLanguageCodes,
        state.editorChapter?.languages,
      );
      toggleEditorLanguageCollapsed(languageCode);
      render();
      if (scrollAnchor) {
        void waitForNextPaint().then(() => restoreTranslateRowAnchor(scrollAnchor));
      }
      return true;
    }

    const editorMode = actionSuffix(action, "set-editor-mode:");
    if (editorMode !== null) {
      setEditorMode(render, editorMode);
      return true;
    }

    return false;
  };
}
