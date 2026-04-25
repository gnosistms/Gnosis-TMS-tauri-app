import {
  Virtualizer,
  defaultRangeExtractor,
  elementScroll,
  observeElementOffset,
  observeElementRect,
} from "@tanstack/virtual-core";
import { syncEditorRowTextareaHeights } from "./autosize.js";
import {
  captureRenderedEditorImageDebugState,
  installEditorImageDebugWindowApi,
  logEditorImageDebugDiff,
  logEditorImageLifecycleEvent,
  logEditorImageRowHeightChange,
} from "./editor-image-debug.js";
import {
  EDITOR_RECONCILES_GLOSSARY_VISIBLE_LAYOUT,
} from "./editor-scroll-policy.js";
import {
  EDITOR_ROW_GAP_PX,
  EDITOR_VIRTUALIZATION_INITIAL_VIEWPORT_PX,
  EDITOR_VIRTUALIZATION_SCROLL_REASON,
  estimateEditorRowHeight,
  nextScheduledEditorRenderReason,
  resolveEditorVirtualRangeState,
} from "./editor-virtualization-shared.js";
import { createEditorVisibleGlossarySync } from "./editor-visible-glossary-sync.js";
import { buildEditorScreenViewModel } from "./editor-screen-model.js";
import { renderTranslationContentRowsRange } from "./editor-row-render.js";
import { buildEditorFieldSelector } from "./editor-utils.js";
import {
  captureVisibleTranslateRowLocation,
  pendingTranslateAnchorRowId,
  queueTranslateRowAnchor,
  resolveTranslateRowAnchor,
  restoreTranslateRowAnchor,
} from "./scroll-state.js";
import { logEditorScrollDebug } from "./editor-scroll-debug.js";

const EDITOR_VIRTUALIZER_OVERSCAN_ROWS = 20;

function captureFocusedEditorField(root) {
  const activeElement = root.ownerDocument?.activeElement;
  if (!(activeElement instanceof HTMLTextAreaElement) || !activeElement.matches("[data-editor-row-field]")) {
    return null;
  }

  return {
    rowId: activeElement.dataset.rowId ?? "",
    languageCode: activeElement.dataset.languageCode ?? "",
    contentKind:
      activeElement.dataset.contentKind === "footnote"
        ? "footnote"
        : activeElement.dataset.contentKind === "image-caption"
          ? "image-caption"
          : "field",
    selectionStart: activeElement.selectionStart,
    selectionEnd: activeElement.selectionEnd,
    selectionDirection: activeElement.selectionDirection ?? "none",
  };
}

function restoreFocusedEditorField(root, snapshot) {
  if (!snapshot?.rowId || !snapshot.languageCode) {
    return;
  }

  const selector = buildEditorFieldSelector(
    snapshot.rowId,
    snapshot.languageCode,
    snapshot.contentKind,
  );
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

function normalizeEditorRowIds(rowIds) {
  if (!Array.isArray(rowIds) || rowIds.length === 0) {
    return [];
  }

  const normalizedRowIds = [];
  const seen = new Set();
  rowIds.forEach((rowId) => {
    const normalizedRowId =
      typeof rowId === "string" && rowId.trim()
        ? rowId.trim()
        : "";
    if (!normalizedRowId || seen.has(normalizedRowId)) {
      return;
    }

    seen.add(normalizedRowId);
    normalizedRowIds.push(normalizedRowId);
  });

  return normalizedRowIds;
}

function clearCachedRowHeights(rowIds, ...caches) {
  const normalizedRowIds = normalizeEditorRowIds(rowIds);
  if (normalizedRowIds.length === 0) {
    return false;
  }

  let changed = false;
  caches.forEach((cache) => {
    if (!(cache instanceof Map)) {
      return;
    }

    normalizedRowIds.forEach((rowId) => {
      changed = cache.delete(rowId) || changed;
    });
  });

  return changed;
}

function isMountedEditorElement(value) {
  return typeof HTMLElement !== "undefined" && value instanceof HTMLElement;
}

function resolveMountedEditorRowCard(itemsContainer, rowId, source = null) {
  const sourceRowCard =
    typeof source?.closest === "function"
      ? source.closest("[data-editor-row-card]")
      : null;
  if (
    isMountedEditorElement(sourceRowCard)
    && (!rowId || (sourceRowCard.dataset.rowId ?? "") === rowId)
  ) {
    return sourceRowCard;
  }

  if (
    !isMountedEditorElement(itemsContainer)
    || typeof rowId !== "string"
    || !rowId
    || typeof CSS === "undefined"
    || typeof CSS.escape !== "function"
  ) {
    return null;
  }

  const rowCard = itemsContainer.querySelector(
    `[data-editor-row-card][data-row-id="${CSS.escape(rowId)}"]`,
  );
  return isMountedEditorElement(rowCard) ? rowCard : null;
}

function resolveMountedEditorRowCards(itemsContainer, rowIds, source = null) {
  const normalizedRowIds = normalizeEditorRowIds(rowIds);
  if (normalizedRowIds.length === 0) {
    const sourceRowCard = resolveMountedEditorRowCard(itemsContainer, "", source);
    return sourceRowCard ? [sourceRowCard] : [];
  }

  const rowCards = [];
  const seen = new Set();
  normalizedRowIds.forEach((rowId) => {
    const rowCard = resolveMountedEditorRowCard(itemsContainer, rowId, source);
    if (!isMountedEditorElement(rowCard) || seen.has(rowId)) {
      return;
    }

    seen.add(rowId);
    rowCards.push(rowCard);
  });

  return rowCards;
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

  return captureVisibleTranslateRowLocation();
}

function updateSpacerHeight(spacer, height) {
  if (!(spacer instanceof HTMLElement)) {
    return;
  }

  spacer.style.height = `${Math.max(0, Math.round(height))}px`;
}

function buildRowIndexById(rows) {
  const rowIndexById = new Map();
  if (!Array.isArray(rows)) {
    return rowIndexById;
  }

  rows.forEach((row, index) => {
    if (typeof row?.id === "string" && row.id) {
      rowIndexById.set(row.id, index);
    }
  });
  return rowIndexById;
}

function safeMeasuredRowHeight(rowCard) {
  if (!(rowCard instanceof HTMLElement)) {
    return 0;
  }

  const measuredHeight = Math.ceil(rowCard.getBoundingClientRect().height);
  return Number.isFinite(measuredHeight) && measuredHeight > 0
    ? measuredHeight
    : 0;
}

function renderWindowRange(
  itemsContainer,
  rows,
  collapsedLanguageCodes,
  startIndex,
  endIndex,
  editorReplace,
  editorChapter,
) {
  itemsContainer.innerHTML = renderTranslationContentRowsRange(
    rows,
    collapsedLanguageCodes,
    startIndex,
    endIndex,
    editorReplace,
    editorChapter,
  );
  syncEditorRowTextareaHeights(itemsContainer);
}

export function createEditorVirtualListController({
  root,
  appState,
  scrollContainer,
  itemsContainer,
  topSpacer,
  bottomSpacer,
  rowHeightCache,
}) {
  if (
    !(root instanceof HTMLElement)
    || !(scrollContainer instanceof HTMLElement)
    || !(itemsContainer instanceof HTMLElement)
    || !(topSpacer instanceof HTMLElement)
    || !(bottomSpacer instanceof HTMLElement)
    || !(rowHeightCache instanceof Map)
  ) {
    return null;
  }

  let currentRangeKey = "";
  let currentModel = buildEditorScreenViewModel(appState);
  let currentRowIndexById = buildRowIndexById(currentModel.contentRows);
  let pinnedRowIndex = -1;
  let animationFrameId = 0;
  let scheduledRenderReason = "";
  let scheduledRenderAnchorSnapshot = null;
  let suppressNextScrollRender = false;
  let renderedImageDebugEntries = [];
  let isRendering = false;
  let needsPostMeasureRender = false;
  let glossarySync = {
    schedule() {},
    restoreMounted() {},
    destroy() {},
  };

  const visibleImageDebugSnapshot = () => ({
    rangeKey: currentRangeKey,
    scrollTop: scrollContainer.scrollTop,
    visibleImages: captureRenderedEditorImageDebugState(itemsContainer, rowHeightCache),
  });
  const uninstallImageDebugWindowApi = installEditorImageDebugWindowApi(visibleImageDebugSnapshot);

  const estimateRowSize = (index) => {
    const row = currentModel.contentRows[index] ?? null;
    if (!row) {
      return estimateEditorRowHeight(null, currentModel.collapsedLanguageCodes, currentModel.editorFontSizePx);
    }

    return rowHeightCache.get(row.id)
      ?? estimateEditorRowHeight(row, currentModel.collapsedLanguageCodes, currentModel.editorFontSizePx);
  };

  const getRowKey = (index) => currentModel.contentRows[index]?.id ?? index;

  const extractRange = (range) => {
    const indexes = defaultRangeExtractor(range);
    if (
      Number.isInteger(pinnedRowIndex)
      && pinnedRowIndex >= 0
      && pinnedRowIndex < range.count
      && !indexes.includes(pinnedRowIndex)
    ) {
      indexes.push(pinnedRowIndex);
      indexes.sort((left, right) => left - right);
    }
    return indexes;
  };

  const buildVirtualizerOptions = () => ({
    count: Array.isArray(currentModel.contentRows) ? currentModel.contentRows.length : 0,
    getScrollElement: () => scrollContainer,
    estimateSize: estimateRowSize,
    getItemKey: getRowKey,
    gap: EDITOR_ROW_GAP_PX,
    overscan: EDITOR_VIRTUALIZER_OVERSCAN_ROWS,
    rangeExtractor: extractRange,
    initialRect: {
      width: scrollContainer.clientWidth || 0,
      height: scrollContainer.clientHeight || EDITOR_VIRTUALIZATION_INITIAL_VIEWPORT_PX,
    },
    initialOffset: () => scrollContainer.scrollTop,
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    useAnimationFrameWithResizeObserver: true,
    onChange: (_instance, sync) => {
      if (isRendering) {
        needsPostMeasureRender = true;
        return;
      }

      if (sync) {
        scheduleRender(EDITOR_VIRTUALIZATION_SCROLL_REASON);
        glossarySync.schedule();
        return;
      }

      scheduleRender("virtualizer-change");
    },
  });

  const virtualizer = new Virtualizer(buildVirtualizerOptions());
  const cleanupVirtualizer = virtualizer._didMount();
  virtualizer._willUpdate();

  const restoreAnchorSnapshot = (anchorSnapshot, reason) => {
    if (!anchorSnapshot?.rowId) {
      return false;
    }

    const restored = restoreTranslateRowAnchor(anchorSnapshot);
    if (restored) {
      suppressNextScrollRender = true;
    }
    logEditorScrollDebug("virtualization-anchor-restored", {
      engine: "tanstack",
      reason,
      rowAnchorId: anchorSnapshot.rowId ?? "",
      scrollTop: scrollContainer.scrollTop,
      rangeKey: currentRangeKey,
    });
    return restored;
  };

  const syncRenderedImageDebugEntries = (reason) => {
    const nextEntries = captureRenderedEditorImageDebugState(itemsContainer, rowHeightCache);
    logEditorImageDebugDiff(renderedImageDebugEntries, nextEntries, {
      reason,
      rangeKey: currentRangeKey,
      scrollTop: scrollContainer.scrollTop,
    });
    renderedImageDebugEntries = nextEntries;
  };

  const updateVirtualizerModel = () => {
    currentModel = buildEditorScreenViewModel(appState);
    currentRowIndexById = buildRowIndexById(currentModel.contentRows);
    const activeRowId =
      pendingTranslateAnchorRowId()
      || pinnedFocusedRowId(root, scrollContainer)
      || "";
    pinnedRowIndex = activeRowId
      ? currentModel.contentRows.findIndex((row) => row.id === activeRowId)
      : -1;
    virtualizer.setOptions(buildVirtualizerOptions());
    virtualizer._willUpdate();
  };

  const measureRowCardHeight = (rowCard) => {
    if (!(rowCard instanceof HTMLElement)) {
      return false;
    }

    const rowId = rowCard.dataset.rowId ?? "";
    if (!rowId) {
      return false;
    }

    const rowIndex = currentRowIndexById.get(rowId);
    if (!Number.isInteger(rowIndex)) {
      return false;
    }

    const nextHeight = safeMeasuredRowHeight(rowCard);
    if (!nextHeight) {
      return false;
    }

    const currentHeight = rowHeightCache.get(rowId);
    if (currentHeight === nextHeight) {
      return false;
    }

    logEditorImageRowHeightChange(rowCard, currentHeight, nextHeight, rowHeightCache, {
      engine: "tanstack",
    });
    rowHeightCache.set(rowId, nextHeight);
    virtualizer.resizeItem(rowIndex, nextHeight);
    return true;
  };

  const measureRowCards = (rowCards) => {
    let changed = false;
    rowCards.forEach((rowCard) => {
      if (measureRowCardHeight(rowCard)) {
        changed = true;
      }
    });
    return changed;
  };

  const measureVisibleRowHeights = () =>
    measureRowCards(itemsContainer.querySelectorAll("[data-editor-row-card]"));

  const updateRowEstimate = (rowId) => {
    const rowIndex = currentRowIndexById.get(rowId);
    if (!Number.isInteger(rowIndex)) {
      return false;
    }

    const row = currentModel.contentRows[rowIndex] ?? null;
    if (!row) {
      return false;
    }

    const estimatedSize = estimateEditorRowHeight(
      row,
      currentModel.collapsedLanguageCodes,
      currentModel.editorFontSizePx,
    );
    virtualizer.resizeItem(rowIndex, estimatedSize);
    return true;
  };

  const readRangeState = () =>
    resolveEditorVirtualRangeState(
      virtualizer.getVirtualItems(),
      virtualizer.getTotalSize(),
    );

  const applyRangeState = (rangeState) => {
    updateSpacerHeight(topSpacer, rangeState.topSpacerHeight);
    updateSpacerHeight(bottomSpacer, rangeState.bottomSpacerHeight);
  };

  const renderRange = (rangeState, reason) => {
    const focusSnapshot = captureFocusedEditorField(root);
    renderWindowRange(
      itemsContainer,
      currentModel.contentRows,
      currentModel.collapsedLanguageCodes,
      rangeState.startIndex,
      rangeState.endIndex,
      currentModel.editorReplace,
      currentModel.editorChapter,
    );
    restoreFocusedEditorField(root, focusSnapshot);
    glossarySync.restoreMounted(itemsContainer, currentModel.editorChapter);
    syncRenderedImageDebugEntries(reason);
  };

  const renderWindow = (force = false, options = {}) => {
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

    updateVirtualizerModel();
    isRendering = true;
    needsPostMeasureRender = false;

    try {
      const rangeState = readRangeState();
      applyRangeState(rangeState);

      if (!force && rangeState.rangeKey === currentRangeKey) {
        if (anchorSnapshot && reason !== EDITOR_VIRTUALIZATION_SCROLL_REASON) {
          restoreAnchorSnapshot(anchorSnapshot, reason);
        }
        return;
      }

      currentRangeKey = rangeState.rangeKey;
      renderRange(rangeState, reason);
      const heightsChanged = measureVisibleRowHeights();
      const measuredRangeState = readRangeState();
      applyRangeState(measuredRangeState);

      if (heightsChanged) {
        logEditorScrollDebug("virtualization-visible-height-change", {
          engine: "tanstack",
          reason,
          rangeKey: currentRangeKey,
          measuredRangeKey: measuredRangeState.rangeKey,
          scrollTop: scrollContainer.scrollTop,
        });
      }

      if (measuredRangeState.rangeKey !== currentRangeKey) {
        currentRangeKey = measuredRangeState.rangeKey;
        renderRange(measuredRangeState, `${reason}:measured-range-adjusted`);
        measureVisibleRowHeights();
        applyRangeState(readRangeState());
      }

      if (anchorSnapshot && reason !== EDITOR_VIRTUALIZATION_SCROLL_REASON) {
        restoreAnchorSnapshot(anchorSnapshot, reason);
      }
    } finally {
      isRendering = false;
    }

    if (needsPostMeasureRender) {
      needsPostMeasureRender = false;
      scheduleRender("post-measure");
    }
  };

  const reconcileVisibleLayoutChanges = (reason) => {
    const anchorSnapshot = captureEditorLayoutAnchor(root);
    const heightsChanged = measureVisibleRowHeights();
    if (!heightsChanged) {
      return;
    }

    logEditorScrollDebug("virtualization-external-height-change", {
      engine: "tanstack",
      reason,
      rowAnchorId: anchorSnapshot?.rowId ?? "",
      scrollTop: scrollContainer.scrollTop,
      rangeKey: currentRangeKey,
    });
    scheduleRender(reason, {
      anchorSnapshot,
    });
  };

  glossarySync = createEditorVisibleGlossarySync(root, scrollContainer, appState, {
    afterVisibleSync() {
      if (!EDITOR_RECONCILES_GLOSSARY_VISIBLE_LAYOUT) {
        logEditorScrollDebug("glossary-visible-sync-layout-skipped", {
          engine: "tanstack",
          scrollTop: scrollContainer.scrollTop,
          rangeKey: currentRangeKey,
        });
        return;
      }

      reconcileVisibleLayoutChanges("glossary-visible-sync");
    },
  });

  function scheduleRender(reason = "render", options = {}) {
    const nextReason = nextScheduledEditorRenderReason(scheduledRenderReason, reason);
    if (options?.anchorSnapshot?.rowId) {
      scheduledRenderAnchorSnapshot = options.anchorSnapshot;
    }
    logEditorScrollDebug("virtualization-render-scheduled", {
      engine: "tanstack",
      requestedReason: reason,
      scheduledReason: nextReason,
      animationFramePending: animationFrameId !== 0,
      rowAnchorId: scheduledRenderAnchorSnapshot?.rowId ?? "",
      scrollTop: scrollContainer.scrollTop,
      rangeKey: currentRangeKey,
    });
    scheduledRenderReason = nextReason;
    if (animationFrameId) {
      return;
    }

    animationFrameId = window.requestAnimationFrame(() => {
      const nextFrameReason = scheduledRenderReason || "render";
      const nextFrameAnchorSnapshot = scheduledRenderAnchorSnapshot?.rowId
        ? scheduledRenderAnchorSnapshot
        : null;
      scheduledRenderReason = "";
      scheduledRenderAnchorSnapshot = null;
      animationFrameId = 0;
      logEditorScrollDebug("virtualization-render-frame", {
        engine: "tanstack",
        reason: nextFrameReason,
        rowAnchorId: nextFrameAnchorSnapshot?.rowId ?? "",
        scrollTop: scrollContainer.scrollTop,
        rangeKey: currentRangeKey,
      });
      renderWindow(false, {
        reason: nextFrameReason,
        anchorSnapshot: nextFrameAnchorSnapshot,
      });
    });
  }

  const notifyRowHeightMayHaveChanged = (rowId, source = null, options = {}) => {
    updateVirtualizerModel();
    const normalizedRowId =
      typeof rowId === "string" && rowId.trim()
        ? rowId.trim()
        : "";
    const rowCard = resolveMountedEditorRowCard(itemsContainer, normalizedRowId, source);
    const resolvedRowId = rowCard?.dataset?.rowId ?? normalizedRowId;
    if (!resolvedRowId) {
      return false;
    }

    clearCachedRowHeights([resolvedRowId], rowHeightCache);
    const changed = isMountedEditorElement(rowCard)
      ? measureRowCardHeight(rowCard)
      : updateRowEstimate(resolvedRowId);
    if (!changed) {
      return false;
    }

    const reason =
      typeof options?.reason === "string" && options.reason.trim()
        ? options.reason.trim()
        : "row-layout";
    scheduleRender(reason, {
      anchorSnapshot: captureEditorLayoutAnchor(root),
    });
    return true;
  };

  const notifyRowsChanged = (rowIds, options = {}) => {
    updateVirtualizerModel();
    const normalizedRowIds = normalizeEditorRowIds(rowIds);
    if (normalizedRowIds.length === 0) {
      return false;
    }

    clearCachedRowHeights(normalizedRowIds, rowHeightCache);
    let changed = false;
    const mountedRowCards = resolveMountedEditorRowCards(
      itemsContainer,
      normalizedRowIds,
      options?.source ?? null,
    );
    const mountedRowIds = new Set();
    mountedRowCards.forEach((rowCard) => {
      const mountedRowId = rowCard.dataset.rowId ?? "";
      if (mountedRowId) {
        mountedRowIds.add(mountedRowId);
      }
    });

    changed = measureRowCards(mountedRowCards) || changed;
    normalizedRowIds.forEach((nextRowId) => {
      if (!mountedRowIds.has(nextRowId) && updateRowEstimate(nextRowId)) {
        changed = true;
      }
    });

    if (!changed) {
      return false;
    }

    const reason =
      typeof options?.reason === "string" && options.reason.trim()
        ? options.reason.trim()
        : "row-change";
    scheduleRender(reason, {
      anchorSnapshot: captureEditorLayoutAnchor(root),
    });
    return true;
  };

  const refreshLayout = (anchorSnapshot = null) => {
    if (animationFrameId) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }

    scheduledRenderReason = "";
    scheduledRenderAnchorSnapshot = null;
    currentRangeKey = "";
    virtualizer.measure();
    renderWindow(true, {
      anchorSnapshot:
        anchorSnapshot?.rowId
          ? anchorSnapshot
          : captureEditorLayoutAnchor(root),
      reason: "refresh-layout",
    });
  };

  const handleResize = () => {
    refreshLayout(captureEditorLayoutAnchor(root));
    glossarySync.schedule();
  };

  const handleScroll = () => {
    logEditorScrollDebug("virtualization-scroll-event", {
      engine: "tanstack",
      scrollTop: scrollContainer.scrollTop,
      rangeKey: currentRangeKey,
      suppressNextScrollRender,
      pendingAnchorRowId: pendingTranslateAnchorRowId(),
    });
    if (suppressNextScrollRender) {
      suppressNextScrollRender = false;
      glossarySync.schedule();
      return;
    }

    glossarySync.schedule();
  };

  const handleImageLoad = (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.matches("[data-editor-language-image-preview-img]")) {
      return;
    }

    logEditorImageLifecycleEvent("editor-image-load", image, rowHeightCache, {
      engine: "tanstack",
      rangeKey: currentRangeKey,
      scrollTop: scrollContainer.scrollTop,
    });
    notifyRowHeightMayHaveChanged("", image, {
      reason: "image-load",
    });
  };

  const handleImageError = (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.matches("[data-editor-language-image-preview-img]")) {
      return;
    }

    logEditorImageLifecycleEvent("editor-image-error", image, rowHeightCache, {
      engine: "tanstack",
      rangeKey: currentRangeKey,
      scrollTop: scrollContainer.scrollTop,
    });
    notifyRowHeightMayHaveChanged("", image, {
      reason: "image-error",
    });
  };

  scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
  root.addEventListener("load", handleImageLoad, true);
  root.addEventListener("error", handleImageError, true);
  window.addEventListener("resize", handleResize);

  renderWindow(true, { reason: "initial-render" });
  glossarySync.schedule();

  return {
    notifyRowsChanged,
    notifyRowHeightMayHaveChanged,
    refreshLayout,
    destroy() {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
      scheduledRenderReason = "";
      scheduledRenderAnchorSnapshot = null;
      renderedImageDebugEntries = [];
      uninstallImageDebugWindowApi();
      glossarySync.destroy();
      cleanupVirtualizer?.();
      scrollContainer.removeEventListener("scroll", handleScroll);
      root.removeEventListener("load", handleImageLoad, true);
      root.removeEventListener("error", handleImageError, true);
      window.removeEventListener("resize", handleResize);
    },
  };
}
