import { actionSuffix } from "../action-helpers.js";
import { waitForNextPaint } from "../runtime.js";
import { captureTranslateRowAnchor, restoreTranslateRowAnchor } from "../scroll-state.js";
import {
  closeTargetLanguageManager,
  restoreEditorFieldHistory,
  toggleEditorHistoryGroupExpanded,
  toggleEditorLanguageCollapsed,
} from "../translate-flow.js";

export function createTranslateActions(render) {
  return async function handleTranslateAction(action) {
    if (action === "close-target-language-manager") {
      closeTargetLanguageManager();
      render();
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
