import { syncEditorRowTextareaHeights } from "./autosize.js";
import { logEditorScrollDebug } from "./editor-scroll-debug.js";
import {
  captureVisibleTranslateLocation,
  pendingTranslateAnchorRowId,
  queueTranslateRowAnchor,
  resolveTranslateRowAnchor,
  restoreTranslateRowAnchor,
} from "./scroll-state.js";
import { createEditorVisibleGlossarySync } from "./editor-visible-glossary-sync.js";
import {
  buildEditorRowHeights,
  calculateEditorVirtualWindow,
  EDITOR_VIRTUALIZATION_SCROLL_REASON,
  EDITOR_VIRTUALIZATION_MIN_ROWS,
  nextScheduledEditorRenderReason,
  shouldDeferMeasuredWindowReconcile,
} from "./editor-virtualization-shared.js";
import { buildEditorScreenViewModel } from "./editor-screen-model.js";
import { renderTranslationContentRowsRange } from "./editor-row-render.js";

let activeController = null;

const rowHeightCacheByLayoutKey = new Map();

function captureFocusedEditorField(root) {
  const activeElement = root.ownerDocument?.activeElement;
  if (!(activeElement instanceof HTMLTextAreaElement) || !activeElement.matches("[data-editor-row-field]")) {
    return null;
  }

  return {
    rowId: activeElement.dataset.rowId ?? "",
    languageCode: activeElement.dataset.languageCode ?? "",
    selectionStart: activeElement.selectionStart,
    selectionEnd: activeElement.selectionEnd,
    selectionDirection: activeElement.selectionDirection ?? "none",
  };
}

function restoreFocusedEditorField(root, snapshot) {
  if (!snapshot?.rowId || !snapshot.languageCode) {
    return;
  }

  const selector =
    `[data-editor-row-field][data-row-id="${CSS.escape(snapshot.rowId)}"][data-language-code="${CSS.escape(snapshot.languageCode)}"]`;
  const nextField = root.querySelector(selector);
  if (!(nextField instanceof HTMLTextAreaElement)) {
    return;
  }

  nextField.focus({ preventScroll: true });
  if (typeof snapshot.selectionStart === "number" && typeof snapshot.selectionEnd === "number") {
    nextField.setSelectionRange(
      snapshot.selectionStart,
      snapshot.selectionEnd,
      snapshot.selectionDirection,
    );
  }
}

function layoutCacheKey(chapterId, collapsedLanguageCodes, fontSizePx) {
  const collapsedKey = [...collapsedLanguageCodes].sort().join(",");
  return `${chapterId || "unknown"}::${fontSizePx}::${collapsedKey}`;
}

function getRowHeightCache(chapterId, collapsedLanguageCodes, fontSizePx) {
  const cacheKey = layoutCacheKey(chapterId, collapsedLanguageCodes, fontSizePx);
  if (!cacheKey) {
    return new Map();
  }

  if (!rowHeightCacheByLayoutKey.has(cacheKey)) {
    rowHeightCacheByLayoutKey.set(cacheKey, new Map());
  }

  return rowHeightCacheByLayoutKey.get(cacheKey);
}

function measureRowCardHeight(rowCard, rowHeightCache) {
  if (!(rowCard instanceof HTMLElement) || !(rowHeightCache instanceof Map)) {
    return false;
  }

  const rowId = rowCard.dataset.rowId ?? "";
  if (!rowId) {
    return false;
  }

  const nextHeight = Math.ceil(rowCard.getBoundingClientRect().height);
  if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
    return false;
  }

  if (rowHeightCache.get(rowId) === nextHeight) {
    return false;
  }

  rowHeightCache.set(rowId, nextHeight);
  return true;
}

function measureVisibleRowHeights(itemsContainer, rowHeightCache) {
  let changed = false;
  itemsContainer.querySelectorAll("[data-editor-row-card]").forEach((element) => {
    if (measureRowCardHeight(element, rowHeightCache)) {
      changed = true;
    }
  });

  return changed;
}

function pinnedFocusedRowId(root, scrollContainer) {
  const activeElement = root.ownerDocument?.activeElement;
  if (!(activeElement instanceof HTMLTextAreaElement) || !activeElement.matches("[data-editor-row-field]")) {
    return "";
  }

  const rowCard = activeElement.closest("[data-editor-row-card]");
  if (!(rowCard instanceof HTMLElement)) {
    return "";
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const rowRect = rowCard.getBoundingClientRect();
  const pinMargin = Math.max(scrollContainer.clientHeight, 200);
  const isNearViewport =
    rowRect.bottom > containerRect.top - pinMargin
    && rowRect.top < containerRect.bottom + pinMargin;

  return isNearViewport ? (rowCard.dataset.rowId ?? "") : "";
}

function captureEditorLayoutAnchor(root) {
  const activeAnchor = resolveTranslateRowAnchor(root.ownerDocument?.activeElement ?? null);
  if (activeAnchor?.rowId) {
    return activeAnchor;
  }

  return captureVisibleTranslateLocation();
}

export function syncEditorVirtualizationRowLayout(source) {
  activeController?.syncRowLayout?.(source);
}

export function refreshEditorVirtualizationLayout() {
  activeController?.refreshLayout?.();
}

export function invalidateEditorVirtualizationLayout(chapterId = "") {
  const normalizedChapterId = typeof chapterId === "string" ? chapterId : "";
  for (const cacheKey of [...rowHeightCacheByLayoutKey.keys()]) {
    if (!normalizedChapterId || cacheKey.startsWith(`${normalizedChapterId}::`)) {
      rowHeightCacheByLayoutKey.get(cacheKey)?.clear();
    }
  }
}

function updateSpacerHeight(spacer, height) {
  if (!(spacer instanceof HTMLElement)) {
    return;
  }

  spacer.style.height = `${Math.max(0, Math.round(height))}px`;
}

function renderWindowRange(
  itemsContainer,
  rows,
  collapsedLanguageCodes,
  startIndex,
  endIndex,
  editorReplace,
) {
  itemsContainer.innerHTML = renderTranslationContentRowsRange(
    rows,
    collapsedLanguageCodes,
    startIndex,
    endIndex,
    editorReplace,
  );
  syncEditorRowTextareaHeights(itemsContainer);
}

export function initializeEditorVirtualization(root, appState) {
  activeController?.destroy?.();
  activeController = null;

  if (appState?.screen !== "translate") {
    return;
  }

  const scrollContainer = root.querySelector(".translate-main-scroll");
  const list = root.querySelector("[data-editor-virtual-list]");
  const itemsContainer = root.querySelector("[data-editor-virtual-items]");
  const topSpacer = root.querySelector('[data-editor-virtual-spacer="top"]');
  const bottomSpacer = root.querySelector('[data-editor-virtual-spacer="bottom"]');
  if (!(scrollContainer instanceof HTMLElement)) {
    return;
  }

  const initialModel = buildEditorScreenViewModel(appState);
  const shouldVirtualize =
    Array.isArray(initialModel.contentRows)
    && initialModel.contentRows.length >= EDITOR_VIRTUALIZATION_MIN_ROWS
    && list instanceof HTMLElement
    && itemsContainer instanceof HTMLElement
    && topSpacer instanceof HTMLElement
    && bottomSpacer instanceof HTMLElement;
  const rowHeightCache = shouldVirtualize
    ? getRowHeightCache(
      initialModel.editorChapter?.chapterId ?? initialModel.chapter?.id ?? "",
      initialModel.collapsedLanguageCodes,
      initialModel.editorFontSizePx,
    )
    : null;
  let currentRangeKey = "";
  let animationFrameId = 0;
  let scheduledRenderReason = "";
  let suppressNextScrollRender = false;
  const restoreAnchorSnapshot = (anchorSnapshot, reason) => {
    if (!anchorSnapshot?.rowId) {
      return false;
    }

    const restored = restoreTranslateRowAnchor(anchorSnapshot);
    if (restored) {
      suppressNextScrollRender = true;
    }
    logEditorScrollDebug("virtualization-anchor-restored", {
      reason,
      rowAnchorId: anchorSnapshot.rowId ?? "",
      scrollTop: scrollContainer.scrollTop,
      rangeKey: currentRangeKey,
    });
    return restored;
  };
  const renderWindow = (force = false, options = {}) => {
    if (!shouldVirtualize || !(itemsContainer instanceof HTMLElement)) {
      return;
    }

    const anchorSnapshot = options?.anchorSnapshot?.rowId
      ? options.anchorSnapshot
      : null;
    const reason =
      typeof options?.reason === "string" && options.reason.trim()
        ? options.reason.trim()
        : "render";
    if (anchorSnapshot) {
      queueTranslateRowAnchor(anchorSnapshot);
    }

    const model = buildEditorScreenViewModel(appState);
    const rowHeights = buildEditorRowHeights(
      model.contentRows,
      rowHeightCache,
      model.collapsedLanguageCodes,
      model.editorFontSizePx,
    );
    const activeRowId =
      pendingTranslateAnchorRowId()
      || pinnedFocusedRowId(root, scrollContainer)
      || "";
    const pinnedRowIndex = activeRowId
      ? model.contentRows.findIndex((row) => row.id === activeRowId)
      : -1;
    const windowState = calculateEditorVirtualWindow(
      rowHeights,
      scrollContainer.scrollTop,
      scrollContainer.clientHeight,
      pinnedRowIndex,
    );
    const nextRangeKey = `${windowState.startIndex}:${windowState.endIndex}`;

    updateSpacerHeight(topSpacer, windowState.topSpacerHeight);
    updateSpacerHeight(bottomSpacer, windowState.bottomSpacerHeight);

    if (!force && nextRangeKey === currentRangeKey) {
      if (anchorSnapshot) {
        restoreAnchorSnapshot(anchorSnapshot, reason);
      }
      return;
    }

    currentRangeKey = nextRangeKey;
    const focusSnapshot = captureFocusedEditorField(root);
    renderWindowRange(
      itemsContainer,
      model.contentRows,
      model.collapsedLanguageCodes,
      windowState.startIndex,
      windowState.endIndex,
      model.editorReplace,
    );
    restoreFocusedEditorField(root, focusSnapshot);
    glossarySync.restoreMounted(itemsContainer, model.editorChapter);

    const heightsChanged = measureVisibleRowHeights(itemsContainer, rowHeightCache);
    if (heightsChanged) {
      logEditorScrollDebug("virtualization-visible-height-change", {
        reason,
        rangeKey: currentRangeKey,
        scrollTop: scrollContainer.scrollTop,
      });
      if (shouldDeferMeasuredWindowReconcile(reason, anchorSnapshot)) {
        logEditorScrollDebug("virtualization-height-change-deferred", {
          reason,
          rangeKey: currentRangeKey,
          scrollTop: scrollContainer.scrollTop,
        });
      } else {
        const measuredHeights = buildEditorRowHeights(
          model.contentRows,
          rowHeightCache,
          model.collapsedLanguageCodes,
          model.editorFontSizePx,
        );
        const measuredWindow = calculateEditorVirtualWindow(
          measuredHeights,
          scrollContainer.scrollTop,
          scrollContainer.clientHeight,
          pinnedRowIndex,
        );
        const measuredRangeKey = `${measuredWindow.startIndex}:${measuredWindow.endIndex}`;
        updateSpacerHeight(topSpacer, measuredWindow.topSpacerHeight);
        updateSpacerHeight(bottomSpacer, measuredWindow.bottomSpacerHeight);
        if (measuredRangeKey !== currentRangeKey) {
          currentRangeKey = measuredRangeKey;
          logEditorScrollDebug("virtualization-range-adjusted", {
            reason,
            rangeKey: measuredRangeKey,
            scrollTop: scrollContainer.scrollTop,
            topSpacerHeight: measuredWindow.topSpacerHeight,
            bottomSpacerHeight: measuredWindow.bottomSpacerHeight,
          });
          renderWindowRange(
            itemsContainer,
            model.contentRows,
            model.collapsedLanguageCodes,
            measuredWindow.startIndex,
            measuredWindow.endIndex,
            model.editorReplace,
          );
          restoreFocusedEditorField(root, focusSnapshot);
          glossarySync.restoreMounted(itemsContainer, model.editorChapter);
          measureVisibleRowHeights(itemsContainer, rowHeightCache);
        }
      }
    }

    if (anchorSnapshot) {
      restoreAnchorSnapshot(anchorSnapshot, reason);
    }
  };

  const reconcileVisibleLayoutChanges = (reason) => {
    if (!shouldVirtualize || !(itemsContainer instanceof HTMLElement) || !(rowHeightCache instanceof Map)) {
      return;
    }

    const anchorSnapshot = captureEditorLayoutAnchor(root);
    const heightsChanged = measureVisibleRowHeights(itemsContainer, rowHeightCache);
    if (!heightsChanged) {
      return;
    }

    logEditorScrollDebug("virtualization-external-height-change", {
      reason,
      rowAnchorId: anchorSnapshot?.rowId ?? "",
      scrollTop: scrollContainer.scrollTop,
      rangeKey: currentRangeKey,
    });
    renderWindow(false, {
      anchorSnapshot,
      reason,
    });
  };

  const glossarySync = createEditorVisibleGlossarySync(root, scrollContainer, appState, {
    afterVisibleSync() {
      reconcileVisibleLayoutChanges("glossary-visible-sync");
    },
  });

  const scheduleRender = (reason = "render") => {
    scheduledRenderReason = nextScheduledEditorRenderReason(scheduledRenderReason, reason);
    if (animationFrameId) {
      return;
    }

    animationFrameId = window.requestAnimationFrame(() => {
      const nextReason = scheduledRenderReason || "render";
      scheduledRenderReason = "";
      animationFrameId = 0;
      renderWindow(false, { reason: nextReason });
    });
  };

  const syncRowLayout = (source) => {
    if (!shouldVirtualize || !(source instanceof Element)) {
      return;
    }

    const rowCard = source.closest("[data-editor-row-card]");
    if (!measureRowCardHeight(rowCard, rowHeightCache)) {
      return;
    }

    scheduleRender("row-layout");
  };

  const refreshLayout = () => {
    if (!shouldVirtualize) {
      return;
    }

    if (animationFrameId) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }

    currentRangeKey = "";
    renderWindow(true, {
      anchorSnapshot: captureEditorLayoutAnchor(root),
      reason: "refresh-layout",
    });
  };

  const handleResize = () => {
    if (shouldVirtualize) {
      renderWindow(true, {
        anchorSnapshot: captureEditorLayoutAnchor(root),
        reason: "resize",
      });
    }
    glossarySync.schedule();
  };

  const handleScroll = () => {
    if (suppressNextScrollRender) {
      suppressNextScrollRender = false;
      glossarySync.schedule();
      return;
    }

    if (shouldVirtualize) {
      scheduleRender(EDITOR_VIRTUALIZATION_SCROLL_REASON);
    }
    glossarySync.schedule();
  };

  scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
  window.addEventListener("resize", handleResize);

  activeController = {
    syncRowLayout,
    refreshLayout,
    destroy() {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
      glossarySync.destroy();
      scrollContainer.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    },
  };

  if (shouldVirtualize) {
    renderWindow(true, { reason: "initial-render" });
  }
  glossarySync.schedule();
}
