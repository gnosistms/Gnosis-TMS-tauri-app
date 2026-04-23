import { loadSelectedChapterEditorData as loadSelectedChapterEditorDataFlow } from "./editor-chapter-load-flow.js";
import { loadActiveEditorFieldHistory as loadActiveEditorFieldHistoryFlow } from "./editor-history-flow.js";
import {
  applyChapterMetadataToState,
  applyEditorUiState,
  normalizeEditorRows,
} from "./editor-state-flow.js";

function editorChapterReloadOperations() {
  return {
    applyEditorUiState,
    normalizeEditorRows,
    applyChapterMetadataToState,
    loadActiveEditorFieldHistory: loadActiveEditorFieldHistoryFlow,
  };
}

export async function reloadSelectedChapterEditorData(render, options = {}) {
  await loadSelectedChapterEditorDataFlow(render, options, editorChapterReloadOperations());
}
