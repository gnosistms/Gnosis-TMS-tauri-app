import { buildEditorScreenViewModel } from "./editor-screen-model.js";
import { EDITOR_GLOSSARY_SCROLL_DEBOUNCE_MS } from "./editor-scroll-policy.js";
import { logEditorScrollDebug } from "./editor-scroll-debug.js";
import {
  restoreMountedEditorGlossaryHighlightsFromCache,
  syncVisibleEditorGlossaryHighlightRows,
} from "./translate-flow.js";

export function createEditorVisibleGlossarySync(root, scrollContainer, appState, options = {}) {
  let glossaryHighlightTimeoutId = 0;
  let glossaryHighlightFrameId = 0;
  const afterVisibleSync =
    typeof options.afterVisibleSync === "function" ? options.afterVisibleSync : null;

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
        logEditorScrollDebug("visible-glossary-sync", {
          scrollTop: scrollContainer.scrollTop,
          chapterId: model.editorChapter?.chapterId ?? "",
        });
        syncVisibleEditorGlossaryHighlightRows(root, scrollContainer, model.editorChapter);
        afterVisibleSync?.(model.editorChapter);
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
