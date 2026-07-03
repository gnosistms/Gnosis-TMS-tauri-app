import { waitForNextPaint } from "./runtime.js";
import { logEditorScrollDebug } from "./editor-scroll-debug.js";
import {
  isUserScrollBasisCurrent,
  readUserScrollGeneration,
} from "./editor-scroll-session.js";
import {
  consumePrimedTranslateInteractionAnchor,
  consumePrimedTranslateMainScrollTop,
  findTranslateAnchorElement,
  queueTranslateRowAnchor,
  resolveTranslateRowAnchor,
  restoreTranslateRowAnchor,
} from "./scroll-state.js";

let translateViewportRestoreGeneration = 0;

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
    // Arbitration basis: restores from this snapshot are refused once the
    // user scrolls again (see editor-scroll-session.js), unless the restore
    // is itself the user's current intent.
    userScrollGeneration: readUserScrollGeneration(),
  };
}

function viewportRestoreBasisIsStale(viewportSnapshot, options = {}) {
  if (options?.userIntent === true) {
    return false;
  }

  return !isUserScrollBasisCurrent(viewportSnapshot?.userScrollGeneration);
}

export function restoreTranslateViewport(viewportSnapshot, options = {}) {
  if (!viewportSnapshot) {
    return;
  }

  if (viewportRestoreBasisIsStale(viewportSnapshot, options)) {
    logEditorScrollDebug("translate-viewport-restore-refused", {
      reason: "stale-user-scroll-basis",
      basisGeneration: viewportSnapshot.userScrollGeneration ?? null,
      currentGeneration: readUserScrollGeneration(),
      anchorRowId: viewportSnapshot.anchor?.rowId ?? "",
    });
    return;
  }

  const container = document.querySelector(".translate-main-scroll");
  if (!isHtmlElement(container)) {
    return;
  }

  // Anchor-first: when the anchor element is mounted, aligning it is the
  // whole restore — re-applying the raw scrollTop afterwards would undo the
  // anchor correction whenever content height changed above the viewport.
  // The raw offset is only the fallback for an unmounted anchor (the
  // after-paint retries re-anchor once the virtualizer mounts it).
  const anchor =
    options?.skipAnchorRestore !== true && viewportSnapshot.anchor?.rowId
      ? viewportSnapshot.anchor
      : null;
  if (anchor && findTranslateAnchorElement(anchor)) {
    restoreTranslateRowAnchor(anchor);
    return;
  }

  if (Number.isFinite(viewportSnapshot.scrollTop)) {
    container.scrollTop = viewportSnapshot.scrollTop;
  }
}

export function cancelPendingTranslateViewportRestores() {
  translateViewportRestoreGeneration += 1;
}

export function restoreTranslateViewportAfterPaints(viewportSnapshot, extraPaints = 2, options = {}) {
  const restoreGeneration = translateViewportRestoreGeneration;
  restoreTranslateViewport(viewportSnapshot, options);
  void (async () => {
    const paintCount = Number.isInteger(extraPaints) && extraPaints > 0 ? extraPaints : 0;
    for (let index = 0; index < paintCount; index += 1) {
      await waitForNextPaint();
      if (restoreGeneration !== translateViewportRestoreGeneration) {
        return;
      }
      restoreTranslateViewport(viewportSnapshot, options);
    }
  })();
}

export function renderTranslateBodyPreservingViewport(render, viewportSnapshot, options = {}) {
  const skipAnchorRestore = options?.skipAnchorRestore === true;
  const staleBasis = viewportRestoreBasisIsStale(viewportSnapshot, options);
  if (!skipAnchorRestore && !staleBasis && viewportSnapshot?.anchor?.rowId) {
    queueTranslateRowAnchor(viewportSnapshot.anchor);
  }

  render?.({
    scope: options.scope ?? "translate-body",
    ...(skipAnchorRestore ? { skipTranslateAnchorRestore: true } : {}),
  });
  if (staleBasis) {
    // The user scrolled since this snapshot was captured; the render above
    // anchors to the current DOM instead of rewinding to the stale basis.
    logEditorScrollDebug("translate-viewport-restore-refused", {
      reason: "stale-user-scroll-basis-render",
      basisGeneration: viewportSnapshot?.userScrollGeneration ?? null,
      currentGeneration: readUserScrollGeneration(),
      anchorRowId: viewportSnapshot?.anchor?.rowId ?? "",
    });
    return;
  }
  restoreTranslateViewportAfterPaints(viewportSnapshot, options.extraPaints, {
    skipAnchorRestore,
    ...(options.userIntent === true ? { userIntent: true } : {}),
  });
}
