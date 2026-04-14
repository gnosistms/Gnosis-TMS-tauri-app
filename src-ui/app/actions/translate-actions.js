import { actionSuffix } from "../action-helpers.js";
import { waitForNextPaint } from "../runtime.js";
import { captureTranslateRowAnchor, restoreTranslateRowAnchor } from "../scroll-state.js";
import {
  cancelEditorConflictResolutionModal,
  cancelEditorReplaceUndoModal,
  cancelEditorRowPermanentDeletionModal,
  cancelInsertEditorRowModal,
  confirmEditorReplaceUndo,
  confirmEditorRowPermanentDeletion,
  confirmInsertEditorRow,
  closeTargetLanguageManager,
  copyEditorConflictResolutionVersion,
  deleteActiveEditorRowComment,
  openEditorConflictResolutionModal,
  openEditorReplaceUndoModal,
  openEditorRowComments,
  openEditorRowPermanentDeletionModal,
  openInsertEditorRowModal,
  replaceSelectedEditorRows,
  saveEditorConflictResolution,
  resolveEditorRowConflict,
  restoreEditorFieldHistory,
  restoreEditorRow,
  saveActiveEditorRowComment,
  selectAllEditorReplaceRows,
  showEditorRowInContext,
  softDeleteEditorRow,
  switchEditorSidebarTab,
  toggleEditorSearchFilterCaseSensitive,
  toggleDeletedEditorRowGroup,
  toggleEditorRowFieldMarker,
  toggleEditorHistoryGroupExpanded,
  toggleEditorReviewSectionExpanded,
  toggleEditorLanguageCollapsed,
} from "../translate-flow.js";

export function createTranslateActions(render) {
  return async function handleTranslateAction(action, event) {
    if (action === "close-target-language-manager") {
      closeTargetLanguageManager();
      render();
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
      await toggleEditorRowFieldMarker(render, rowId, languageCode, kind);
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
    if (languageCode === null) {
      return false;
    }

    const scrollAnchor = captureTranslateRowAnchor(event?.target ?? null);
    toggleEditorLanguageCollapsed(languageCode);
    render();
    if (scrollAnchor) {
      void waitForNextPaint().then(() => restoreTranslateRowAnchor(scrollAnchor));
    }
    return true;
  };
}
