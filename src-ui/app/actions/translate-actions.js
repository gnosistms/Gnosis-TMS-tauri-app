import { actionSuffix } from "../action-helpers.js";
import { waitForNextPaint } from "../runtime.js";
import { captureTranslateRowAnchor, restoreTranslateRowAnchor } from "../scroll-state.js";
import {
  cancelEditorRowPermanentDeletionModal,
  cancelInsertEditorRowModal,
  confirmEditorRowPermanentDeletion,
  confirmInsertEditorRow,
  closeTargetLanguageManager,
  openEditorRowPermanentDeletionModal,
  openInsertEditorRowModal,
  replaceSelectedEditorRows,
  restoreEditorFieldHistory,
  restoreEditorRow,
  selectAllEditorReplaceRows,
  softDeleteEditorRow,
  toggleEditorSearchFilterCaseSensitive,
  toggleDeletedEditorRowGroup,
  toggleEditorRowFieldMarker,
  toggleEditorHistoryGroupExpanded,
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

    if (action === "select-all-editor-replace-rows") {
      selectAllEditorReplaceRows(render);
      return true;
    }

    if (action === "replace-selected-editor-rows") {
      await replaceSelectedEditorRows(render);
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

    const historyCommitSha = actionSuffix(action, "restore-editor-history:");
    if (historyCommitSha !== null) {
      await restoreEditorFieldHistory(render, historyCommitSha);
      return true;
    }

    const historyGroupKey = actionSuffix(action, "toggle-editor-history-group:");
    if (historyGroupKey !== null) {
      toggleEditorHistoryGroupExpanded(historyGroupKey);
      render();
      return true;
    }

    const deletedRowGroupKey = actionSuffix(action, "toggle-editor-deleted-row-group:");
    if (deletedRowGroupKey !== null) {
      const scrollAnchor = captureTranslateRowAnchor(event?.target ?? null);
      toggleDeletedEditorRowGroup(render, deletedRowGroupKey, scrollAnchor);
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

    const permanentDeleteRowId = actionSuffix(action, "open-editor-row-permanent-delete:");
    if (permanentDeleteRowId !== null) {
      openEditorRowPermanentDeletionModal(permanentDeleteRowId);
      render();
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
