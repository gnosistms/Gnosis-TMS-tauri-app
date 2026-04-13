import { loadActiveEditorFieldHistory } from "./editor-history-flow.js";
import { hasActiveEditorField } from "./editor-utils.js";
import { waitForNextPaint } from "./runtime.js";
import {
  captureVisibleTranslateLocation,
  queueTranslateRowAnchor,
  restoreTranslateRowAnchor,
} from "./scroll-state.js";
import { state } from "./state.js";
import {
  invalidateEditorVirtualizationLayout,
  refreshEditorVirtualizationLayout,
} from "./editor-virtualization.js";

function scheduleStructuralEditorScrollRestore(anchor) {
  if (!anchor?.rowId) {
    return;
  }

  const restorePass = () => {
    queueTranslateRowAnchor(anchor);
    refreshEditorVirtualizationLayout();
    restoreTranslateRowAnchor(anchor);
  };

  void waitForNextPaint().then(() => {
    restorePass();
    void waitForNextPaint().then(() => {
      restorePass();
    });
  });
}

export function applyStructuralEditorChange(render, updateState, options = {}) {
  const anchor = options.anchorSnapshot ?? captureVisibleTranslateLocation();
  updateState();
  if (anchor) {
    queueTranslateRowAnchor(anchor);
  }
  invalidateEditorVirtualizationLayout(state.editorChapter?.chapterId);
  render?.();
  scheduleStructuralEditorScrollRestore(anchor);
  if (options.reloadHistory === true && hasActiveEditorField(state.editorChapter)) {
    loadActiveEditorFieldHistory(render);
  }
}
