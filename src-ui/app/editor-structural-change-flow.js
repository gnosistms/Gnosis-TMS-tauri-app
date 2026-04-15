import { loadActiveEditorFieldHistory } from "./editor-history-flow.js";
import { hasActiveEditorField } from "./editor-utils.js";
import { waitForNextPaint } from "./runtime.js";
import {
  captureTranslateAnchorForRow,
  captureVisibleTranslateLocation,
  queueTranslateRowAnchor,
} from "./scroll-state.js";
import { state } from "./state.js";
import {
  refreshEditorVirtualizationLayout,
} from "./editor-virtualization.js";

function anchorLanguageCode(anchor) {
  return anchor?.type === "field" || anchor?.type === "language-toggle"
    ? anchor.languageCode ?? null
    : null;
}

function translateAnchorIsAligned(anchor, tolerancePx = 1) {
  if (!anchor?.rowId) {
    return true;
  }

  const currentAnchor = captureTranslateAnchorForRow(
    anchor.rowId,
    anchorLanguageCode(anchor),
  );
  if (!currentAnchor?.rowId) {
    return false;
  }

  return Math.abs(
    Number(currentAnchor.offsetTop ?? 0) - Number(anchor.offsetTop ?? 0),
  ) <= tolerancePx;
}

function scheduleStructuralEditorScrollRestore(anchor, remainingAttempts = 2) {
  if (!anchor?.rowId || remainingAttempts <= 0) {
    return;
  }

  void waitForNextPaint().then(() => {
    if (translateAnchorIsAligned(anchor)) {
      return;
    }

    queueTranslateRowAnchor(anchor);
    refreshEditorVirtualizationLayout(anchor);
    scheduleStructuralEditorScrollRestore(anchor, remainingAttempts - 1);
  });
}

export function applyStructuralEditorChange(render, updateState, options = {}) {
  const anchor = options.anchorSnapshot ?? captureVisibleTranslateLocation();
  updateState();
  if (anchor) {
    queueTranslateRowAnchor(anchor);
  }
  render?.();
  scheduleStructuralEditorScrollRestore(anchor);
  if (options.reloadHistory === true && hasActiveEditorField(state.editorChapter)) {
    loadActiveEditorFieldHistory(render);
  }
}
