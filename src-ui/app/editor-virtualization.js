import { syncEditorRowTextareaHeights } from "./autosize.js";
import { logEditorScrollDebug } from "./editor-scroll-debug.js";
import {
  captureRenderedEditorImageDebugState,
  installEditorImageDebugWindowApi,
  logEditorImageDebugDiff,
  logEditorImageLifecycleEvent,
  logEditorImageRowHeightChange,
} from "./editor-image-debug.js";
import {
  EDITOR_RECONCILES_GLOSSARY_VISIBLE_LAYOUT,
  EDITOR_USES_TANSTACK_VIRTUALIZER,
  EDITOR_USES_DEFERRED_SCROLL_RECONCILE,
} from "./editor-scroll-policy.js";
import {
  captureVisibleTranslateRowLocation,
  pendingTranslateAnchorRowId,
  queueTranslateRowAnchor,
  resolveTranslateRowAnchor,
  restoreTranslateRowAnchor,
} from "./scroll-state.js";
import { createEditorVisibleGlossarySync } from "./editor-visible-glossary-sync.js";
import { buildEditorFieldSelector } from "./editor-utils.js";
import {
  buildEditorRowHeights,
  calculateEditorVirtualWindow,
  EDITOR_VIRTUALIZATION_SCROLL_REASON,
  EDITOR_VIRTUALIZATION_MIN_ROWS,
  hasEditorVirtualWindowCoverageGap,
  nextScheduledEditorRenderReason,
  shouldDeferMeasuredWindowReconcile,
} from "./editor-virtualization-shared.js";
import { buildEditorScreenViewModel } from "./editor-screen-model.js";
import { renderTranslationContentRowsRange } from "./editor-row-render.js";
import { createEditorVirtualListController } from "./editor-virtual-list.js";

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

function measureRowCardHeight(rowCard, rowHeightCache, stagedRowHeights = null) {
  if (
    !(rowCard instanceof HTMLElement)
    || !(rowHeightCache instanceof Map)
    || (stagedRowHeights !== null && !(stagedRowHeights instanceof Map))
  ) {
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

  const currentHeight =
    stagedRowHeights?.get(rowId)
    ?? rowHeightCache.get(rowId);
  if (currentHeight === nextHeight) {
    return false;
  }

  logEditorImageRowHeightChange(rowCard, currentHeight, nextHeight, rowHeightCache, {
    staged: stagedRowHeights instanceof Map,
  });

  if (stagedRowHeights instanceof Map) {
    stagedRowHeights.set(rowId, nextHeight);
    return true;
  }

  rowHeightCache.set(rowId, nextHeight);
  return true;
}

function measureRowCards(rowCards, rowHeightCache, stagedRowHeights = null) {
  let changed = false;
  rowCards.forEach((rowCard) => {
    if (measureRowCardHeight(rowCard, rowHeightCache, stagedRowHeights)) {
      changed = true;
    }
  });

  return changed;
}

function measureVisibleRowHeights(itemsContainer, rowHeightCache, stagedRowHeights = null) {
  return measureRowCards(
    itemsContainer.querySelectorAll("[data-editor-row-card]"),
    rowHeightCache,
    stagedRowHeights,
  );
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

function commitStagedRowHeights(rowHeightCache, stagedRowHeights) {
  if (!(rowHeightCache instanceof Map) || !(stagedRowHeights instanceof Map) || stagedRowHeights.size === 0) {
    return false;
  }

  let changed = false;
  for (const [rowId, nextHeight] of stagedRowHeights.entries()) {
    if (rowHeightCache.get(rowId) === nextHeight) {
      continue;
    }

    rowHeightCache.set(rowId, nextHeight);
    changed = true;
  }

  stagedRowHeights.clear();
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

  return captureVisibleTranslateRowLocation();
}

export function notifyEditorRowsChanged(rowIds, options = {}) {
  return activeController?.notifyRowsChanged?.(rowIds, options) ?? false;
}

export function notifyEditorRowHeightMayHaveChanged(rowId, source = null, options = {}) {
  return activeController?.notifyRowHeightMayHaveChanged?.(rowId, source, options) ?? false;
}

export function syncEditorVirtualizationRowLayout(source) {
  const rowCard = resolveMountedEditorRowCard(null, "", source);
  const rowId = rowCard?.dataset?.rowId ?? "";
  return notifyEditorRowHeightMayHaveChanged(rowId, source, {
    reason: "row-layout",
  });
}

export function refreshEditorVirtualizationLayout(anchorSnapshot = null) {
  activeController?.refreshLayout?.(anchorSnapshot ?? null);
}

function updateSpacerHeight(spacer, height) {
  if (!(spacer instanceof HTMLElement)) {
    return;
  }

  spacer.style.height = `${Math.max(0, Math.round(height))}px`;
}

function renderedWindowHasCoverageGap(itemsContainer, scrollContainer, windowState, rowCount) {
  if (!(itemsContainer instanceof HTMLElement) || !(scrollContainer instanceof HTMLElement)) {
    return false;
  }

  const rowCards = itemsContainer.querySelectorAll("[data-editor-row-card]");
  const firstRowCard = rowCards[0] ?? null;
  const lastRowCard = rowCards[rowCards.length - 1] ?? null;
  const scrollRect = scrollContainer.getBoundingClientRect();
  const firstRect = firstRowCard?.getBoundingClientRect?.() ?? null;
  const lastRect = lastRowCard?.getBoundingClientRect?.() ?? null;

  return hasEditorVirtualWindowCoverageGap({
    rowCount,
    startIndex: windowState?.startIndex,
    endIndex: windowState?.endIndex,
    viewportTop: scrollRect.top,
    viewportBottom: scrollRect.bottom,
    firstRowTop: firstRect?.top,
    lastRowBottom: lastRect?.bottom,
  });
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
  const shouldDeferScrollReconcile = EDITOR_USES_DEFERRED_SCROLL_RECONCILE;
  const shouldReconcileGlossaryVisibleLayout = EDITOR_RECONCILES_GLOSSARY_VISIBLE_LAYOUT;
  if (EDITOR_USES_TANSTACK_VIRTUALIZER && shouldVirtualize) {
    const tanstackController = createEditorVirtualListController({
      root,
      appState,
      scrollContainer,
      itemsContainer,
      topSpacer,
      bottomSpacer,
      rowHeightCache,
    });
    if (tanstackController) {
      activeController = tanstackController;
      return;
    }
  }

  let currentRangeKey = "";
  let animationFrameId = 0;
  const deferredRowHeightCache = new Map();
  let suppressedScrollResetFrameId = 0;
  let suppressedScrollEvents = 0;
  let scheduledRenderReason = "";
  let scheduledRenderAnchorSnapshot = null;
  let suppressNextScrollRender = false;
  let hasDeferredMeasuredWindowReconcile = false;
  let renderedImageDebugEntries = [];
  const visibleImageDebugSnapshot = () => ({
    rangeKey: currentRangeKey,
    scrollTop: scrollContainer.scrollTop,
    visibleImages: captureRenderedEditorImageDebugState(itemsContainer, rowHeightCache),
  });
  const uninstallImageDebugWindowApi = installEditorImageDebugWindowApi(visibleImageDebugSnapshot);
  const armSuppressedScrollEvent = () => {
    suppressedScrollEvents = Math.max(suppressedScrollEvents, 1);
    if (suppressedScrollResetFrameId) {
      window.cancelAnimationFrame(suppressedScrollResetFrameId);
    }
    suppressedScrollResetFrameId = window.requestAnimationFrame(() => {
      suppressedScrollResetFrameId = 0;
      suppressedScrollEvents = 0;
    });
  };
  const commitDeferredRowHeights = (reason = "deferred-scroll-layout") => {
    const deferredHeightCount = deferredRowHeightCache.size;
    const committedDeferredHeights = commitStagedRowHeights(rowHeightCache, deferredRowHeightCache);
    logEditorScrollDebug("virtualization-deferred-heights-committed", {
      committedDeferredHeights,
      deferredHeightCount,
      reason,
      scrollTop: scrollContainer.scrollTop,
      rangeKey: currentRangeKey,
    });
    return committedDeferredHeights;
  };
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
  const syncRenderedImageDebugEntries = (reason) => {
    const nextEntries = captureRenderedEditorImageDebugState(itemsContainer, rowHeightCache);
    logEditorImageDebugDiff(renderedImageDebugEntries, nextEntries, {
      reason,
      rangeKey: currentRangeKey,
      scrollTop: scrollContainer.scrollTop,
    });
    renderedImageDebugEntries = nextEntries;
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

    if (reason === "deferred-scroll-layout") {
      armSuppressedScrollEvent();
      commitDeferredRowHeights(reason);
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
      const hasCoverageGap = renderedWindowHasCoverageGap(
        itemsContainer,
        scrollContainer,
        windowState,
        model.contentRows.length,
      );
      if (hasCoverageGap) {
        commitDeferredRowHeights("same-range-coverage-gap");
        measureVisibleRowHeights(itemsContainer, rowHeightCache);
        const measuredHeights = buildEditorRowHeights(
          model.contentRows,
          rowHeightCache,
          model.collapsedLanguageCodes,
          model.editorFontSizePx,
        );
        const measuredWindow = calculateEditorVirtualWindow(
          measuredHeights,
          scrollContainer.scrollTop,
          scrollContainer.clientHeight + Math.max(scrollContainer.clientHeight, 600),
          pinnedRowIndex,
        );
        const measuredRangeKey = `${measuredWindow.startIndex}:${measuredWindow.endIndex}`;
        updateSpacerHeight(topSpacer, measuredWindow.topSpacerHeight);
        updateSpacerHeight(bottomSpacer, measuredWindow.bottomSpacerHeight);
        logEditorScrollDebug("virtualization-same-range-coverage-gap", {
          reason,
          previousRangeKey: currentRangeKey,
          measuredRangeKey,
          scrollTop: scrollContainer.scrollTop,
          startIndex: windowState.startIndex,
          endIndex: windowState.endIndex,
          measuredStartIndex: measuredWindow.startIndex,
          measuredEndIndex: measuredWindow.endIndex,
        });
        if (measuredRangeKey !== currentRangeKey) {
          currentRangeKey = measuredRangeKey;
          const focusSnapshot = captureFocusedEditorField(root);
          renderWindowRange(
            itemsContainer,
            model.contentRows,
            model.collapsedLanguageCodes,
            measuredWindow.startIndex,
            measuredWindow.endIndex,
            model.editorReplace,
            model.editorChapter,
          );
          restoreFocusedEditorField(root, focusSnapshot);
          glossarySync.restoreMounted(itemsContainer, model.editorChapter);
          syncRenderedImageDebugEntries(`${reason}:same-range-coverage-gap`);
          measureVisibleRowHeights(itemsContainer, rowHeightCache);
        }
      }
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
      model.editorChapter,
    );
    restoreFocusedEditorField(root, focusSnapshot);
    glossarySync.restoreMounted(itemsContainer, model.editorChapter);
    syncRenderedImageDebugEntries(reason);

    const shouldStageMeasuredWindowReconcile = shouldDeferMeasuredWindowReconcile(
      reason,
      anchorSnapshot,
      shouldDeferScrollReconcile,
    );
    const hasCoverageGap = renderedWindowHasCoverageGap(
      itemsContainer,
      scrollContainer,
      windowState,
      model.contentRows.length,
    );
    if (hasCoverageGap) {
      commitDeferredRowHeights("coverage-gap");
      logEditorScrollDebug("virtualization-coverage-gap", {
        reason,
        rangeKey: currentRangeKey,
        scrollTop: scrollContainer.scrollTop,
        startIndex: windowState.startIndex,
        endIndex: windowState.endIndex,
      });
    }
    const heightsChanged = measureVisibleRowHeights(
      itemsContainer,
      rowHeightCache,
    );
    if (heightsChanged || hasCoverageGap) {
      logEditorScrollDebug("virtualization-visible-height-change", {
        reason,
        rangeKey: currentRangeKey,
        scrollTop: scrollContainer.scrollTop,
        staged: false,
        coverageGap: hasCoverageGap,
        deferredWindowReconcile: shouldStageMeasuredWindowReconcile && !hasCoverageGap,
      });
      if (shouldStageMeasuredWindowReconcile && !hasCoverageGap) {
        hasDeferredMeasuredWindowReconcile = false;
        logEditorScrollDebug("virtualization-height-change-cached", {
          reason,
          rangeKey: currentRangeKey,
          scrollTop: scrollContainer.scrollTop,
        });
      } else {
        hasDeferredMeasuredWindowReconcile = false;
        const measuredHeights = buildEditorRowHeights(
          model.contentRows,
          rowHeightCache,
          model.collapsedLanguageCodes,
          model.editorFontSizePx,
        );
        const measuredWindow = calculateEditorVirtualWindow(
          measuredHeights,
          scrollContainer.scrollTop,
          scrollContainer.clientHeight
            + (hasCoverageGap ? Math.max(scrollContainer.clientHeight, 600) : 0),
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
            model.editorChapter,
          );
          restoreFocusedEditorField(root, focusSnapshot);
          glossarySync.restoreMounted(itemsContainer, model.editorChapter);
          syncRenderedImageDebugEntries(`${reason}:measured-range-adjusted`);
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
      if (hasDeferredMeasuredWindowReconcile) {
        hasDeferredMeasuredWindowReconcile = false;
        logEditorScrollDebug("virtualization-height-change-reconciled", {
          reason: "deferred-scroll-layout",
          scrollTop: scrollContainer.scrollTop,
          rangeKey: currentRangeKey,
        });
        renderWindow(false, {
          anchorSnapshot: captureEditorLayoutAnchor(root),
          reason: "deferred-scroll-layout",
        });
        return;
      }

      if (!shouldReconcileGlossaryVisibleLayout) {
        logEditorScrollDebug("glossary-visible-sync-layout-skipped", {
          scrollTop: scrollContainer.scrollTop,
          rangeKey: currentRangeKey,
        });
        return;
      }

      reconcileVisibleLayoutChanges("glossary-visible-sync");
    },
  });

  const scheduleRender = (reason = "render", options = {}) => {
    const nextReason = nextScheduledEditorRenderReason(scheduledRenderReason, reason);
    if (options?.anchorSnapshot?.rowId) {
      scheduledRenderAnchorSnapshot = options.anchorSnapshot;
    }
    logEditorScrollDebug("virtualization-render-scheduled", {
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
  };

  const notifyRowHeightMayHaveChanged = (rowId, source = null, options = {}) => {
    if (!shouldVirtualize) {
      return false;
    }

    const normalizedRowId =
      typeof rowId === "string" && rowId.trim()
        ? rowId.trim()
        : "";
    const rowCard = resolveMountedEditorRowCard(itemsContainer, normalizedRowId, source);
    const resolvedRowId = rowCard?.dataset?.rowId ?? normalizedRowId;
    if (resolvedRowId) {
      clearCachedRowHeights([resolvedRowId], deferredRowHeightCache);
    }

    if (isMountedEditorElement(rowCard)) {
      if (!measureRowCardHeight(rowCard, rowHeightCache)) {
        return false;
      }
    } else if (!resolvedRowId || !clearCachedRowHeights([resolvedRowId], rowHeightCache)) {
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
    if (!shouldVirtualize) {
      return false;
    }

    const normalizedRowIds = normalizeEditorRowIds(rowIds);
    if (normalizedRowIds.length === 0) {
      return false;
    }

    clearCachedRowHeights(
      normalizedRowIds,
      rowHeightCache,
      deferredRowHeightCache,
    );
    const mountedRowCards = resolveMountedEditorRowCards(
      itemsContainer,
      normalizedRowIds,
      options?.source ?? null,
    );
    measureRowCards(mountedRowCards, rowHeightCache);

    const reason =
      typeof options?.reason === "string" && options.reason.trim()
        ? options.reason.trim()
        : "row-change";
    scheduleRender(reason, {
      anchorSnapshot: captureEditorLayoutAnchor(root),
    });
    return true;
  };

  const syncRowLayout = (source) => {
    const rowCard = resolveMountedEditorRowCard(itemsContainer, "", source);
    const rowId = rowCard?.dataset?.rowId ?? "";
    notifyRowHeightMayHaveChanged(rowId, source, {
      reason: "row-layout",
    });
  };

  const refreshLayout = (anchorSnapshot = null) => {
    if (!shouldVirtualize) {
      return;
    }

    if (animationFrameId) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }

    scheduledRenderReason = "";
    scheduledRenderAnchorSnapshot = null;
    currentRangeKey = "";
    renderWindow(true, {
      anchorSnapshot:
        anchorSnapshot?.rowId
          ? anchorSnapshot
          : captureEditorLayoutAnchor(root),
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
    logEditorScrollDebug("virtualization-scroll-event", {
      scrollTop: scrollContainer.scrollTop,
      rangeKey: currentRangeKey,
      suppressNextScrollRender,
      suppressedScrollEvents,
      pendingAnchorRowId: pendingTranslateAnchorRowId(),
    });
    if (suppressNextScrollRender) {
      suppressNextScrollRender = false;
      glossarySync.schedule();
      return;
    }
    if (suppressedScrollEvents > 0) {
      suppressedScrollEvents -= 1;
      glossarySync.schedule();
      return;
    }

    if (shouldVirtualize) {
      scheduleRender(EDITOR_VIRTUALIZATION_SCROLL_REASON);
    }
    glossarySync.schedule();
  };
  const handleImageLoad = (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.matches("[data-editor-language-image-preview-img]")) {
      return;
    }

    logEditorImageLifecycleEvent("editor-image-load", image, rowHeightCache, {
      rangeKey: currentRangeKey,
      scrollTop: scrollContainer.scrollTop,
    });
  };
  const handleImageError = (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.matches("[data-editor-language-image-preview-img]")) {
      return;
    }

    logEditorImageLifecycleEvent("editor-image-error", image, rowHeightCache, {
      rangeKey: currentRangeKey,
      scrollTop: scrollContainer.scrollTop,
    });
  };

  scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
  root.addEventListener("load", handleImageLoad, true);
  root.addEventListener("error", handleImageError, true);
  window.addEventListener("resize", handleResize);

  activeController = {
    notifyRowsChanged,
    notifyRowHeightMayHaveChanged,
    syncRowLayout,
    refreshLayout,
    destroy() {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
      if (suppressedScrollResetFrameId) {
        window.cancelAnimationFrame(suppressedScrollResetFrameId);
      }
      scheduledRenderReason = "";
      scheduledRenderAnchorSnapshot = null;
      deferredRowHeightCache.clear();
      renderedImageDebugEntries = [];
      uninstallImageDebugWindowApi();
      glossarySync.destroy();
      scrollContainer.removeEventListener("scroll", handleScroll);
      root.removeEventListener("load", handleImageLoad, true);
      root.removeEventListener("error", handleImageError, true);
      window.removeEventListener("resize", handleResize);
    },
  };

  if (shouldVirtualize) {
    renderWindow(true, { reason: "initial-render" });
  }
  glossarySync.schedule();
}
