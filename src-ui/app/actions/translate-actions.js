import { actionSuffix } from "../action-helpers.js";
import { waitForNextPaint } from "../runtime.js";
import { captureTranslateRowAnchor, restoreTranslateRowAnchor } from "../scroll-state.js";
import {
  closeTargetLanguageManager,
  restoreEditorFieldHistory,
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
