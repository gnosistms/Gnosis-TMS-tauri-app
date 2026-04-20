import { waitForNextPaint } from "./runtime.js";
import {
  consumePrimedTranslateInteractionAnchor,
  consumePrimedTranslateMainScrollTop,
  queueTranslateRowAnchor,
  resolveTranslateRowAnchor,
  restoreTranslateRowAnchor,
} from "./scroll-state.js";

function isHtmlElement(value) {
  return typeof HTMLElement === "function" && value instanceof HTMLElement;
}

export function readTranslateMainScrollTop() {
  const container = document.querySelector(".translate-main-scroll");
  return isHtmlElement(container) ? container.scrollTop : null;
}

export function captureTranslateViewport(target = null, options = {}) {
  const preferPrimed = options?.preferPrimed === true;
  const expectedRowId =
    typeof options?.expectedRowId === "string" && options.expectedRowId.trim()
      ? options.expectedRowId.trim()
      : "";
  const fallbackAnchor =
    options?.fallbackAnchor?.rowId
      ? { ...options.fallbackAnchor }
      : null;
  const resolvedAnchor =
    typeof Element === "function"
      ? resolveTranslateRowAnchor(target)
      : null;
  const primedAnchor = preferPrimed
    ? consumePrimedTranslateInteractionAnchor(expectedRowId)
    : null;
  const primedScrollTop = preferPrimed ? consumePrimedTranslateMainScrollTop() : null;

  return {
    anchor:
      primedAnchor?.rowId
        ? primedAnchor
        : resolvedAnchor ?? fallbackAnchor,
    scrollTop:
      Number.isFinite(primedScrollTop)
        ? primedScrollTop
        : readTranslateMainScrollTop(),
  };
}

export function restoreTranslateViewport(viewportSnapshot) {
  if (!viewportSnapshot) {
    return;
  }

  const container = document.querySelector(".translate-main-scroll");
  if (isHtmlElement(container) && Number.isFinite(viewportSnapshot.scrollTop)) {
    container.scrollTop = viewportSnapshot.scrollTop;
  }

  if (viewportSnapshot.anchor?.rowId) {
    restoreTranslateRowAnchor(viewportSnapshot.anchor);
  }
}

export function restoreTranslateViewportAfterPaints(viewportSnapshot, extraPaints = 2) {
  restoreTranslateViewport(viewportSnapshot);
  void (async () => {
    const paintCount = Number.isInteger(extraPaints) && extraPaints > 0 ? extraPaints : 0;
    for (let index = 0; index < paintCount; index += 1) {
      await waitForNextPaint();
      restoreTranslateViewport(viewportSnapshot);
    }
  })();
}

export function renderTranslateBodyPreservingViewport(render, viewportSnapshot, options = {}) {
  if (viewportSnapshot?.anchor?.rowId) {
    queueTranslateRowAnchor(viewportSnapshot.anchor);
  }

  render?.({ scope: options.scope ?? "translate-body" });
  restoreTranslateViewportAfterPaints(viewportSnapshot, options.extraPaints);
}
