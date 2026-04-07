import { actionSuffix } from "../action-helpers.js";
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

    toggleEditorLanguageCollapsed(languageCode);
    render();
    return true;
  };
}
