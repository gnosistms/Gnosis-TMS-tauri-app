import { buildEditorScreenViewModel } from "./editor-screen-model.js";
import {
  restoreMountedEditorGlossaryHighlightsFromCache,
  syncVisibleEditorGlossaryHighlightRows,
} from "./translate-flow.js";

const EDITOR_GLOSSARY_SCROLL_DEBOUNCE_MS = 100;

export function createEditorVisibleGlossarySync(root, scrollContainer, appState) {
  let glossaryHighlightTimeoutId = 0;
  let glossaryHighlightFrameId = 0;

  const schedule = () => {
    if (glossaryHighlightTimeoutId) {
      window.clearTimeout(glossaryHighlightTimeoutId);
    }
    if (glossaryHighlightFrameId) {
      window.cancelAnimationFrame(glossaryHighlightFrameId);
      glossaryHighlightFrameId = 0;
    }

    glossaryHighlightTimeoutId = window.setTimeout(() => {
      glossaryHighlightTimeoutId = 0;
      glossaryHighlightFrameId = window.requestAnimationFrame(() => {
        glossaryHighlightFrameId = 0;
        const model = buildEditorScreenViewModel(appState);
        syncVisibleEditorGlossaryHighlightRows(root, scrollContainer, model.editorChapter);
      });
    }, EDITOR_GLOSSARY_SCROLL_DEBOUNCE_MS);
  };

  const restoreMounted = (itemsContainer, editorChapter) => {
    restoreMountedEditorGlossaryHighlightsFromCache(itemsContainer, editorChapter);
  };

  const destroy = () => {
    if (glossaryHighlightTimeoutId) {
      window.clearTimeout(glossaryHighlightTimeoutId);
    }
    if (glossaryHighlightFrameId) {
      window.cancelAnimationFrame(glossaryHighlightFrameId);
    }
  };

  return {
    schedule,
    restoreMounted,
    destroy,
  };
}
