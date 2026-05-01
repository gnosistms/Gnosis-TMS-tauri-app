import { logEditorScrollDebug } from "./editor-scroll-debug.js";
import {
  captureRenderedEditorImageDebugState,
  installEditorImageDebugWindowApi,
  logEditorImageLifecycleEvent,
} from "./editor-image-debug.js";
import {
  EDITOR_USES_TANSTACK_VIRTUALIZER,
} from "./editor-scroll-policy.js";
import {
  restoreTranslateRowAnchor,
} from "./scroll-state.js";
import { createEditorVisibleGlossarySync } from "./editor-visible-glossary-sync.js";
import {
  EDITOR_VIRTUALIZATION_MIN_ROWS,
} from "./editor-virtualization-shared.js";
import { buildEditorScreenViewModel } from "./editor-screen-model.js";
import { createEditorVirtualListController } from "./editor-virtual-list.js";

let activeController = null;

const rowHeightCacheByLayoutKey = new Map();

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

function isMountedEditorElement(value) {
  return typeof HTMLElement !== "undefined" && value instanceof HTMLElement;
}

function resolveMountedEditorRowCard(rowId, source = null) {
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
  return null;
}

export function notifyEditorRowsChanged(rowIds, options = {}) {
  return activeController?.notifyRowsChanged?.(rowIds, options) ?? false;
}

export function notifyEditorRowHeightMayHaveChanged(rowId, source = null, options = {}) {
  return activeController?.notifyRowHeightMayHaveChanged?.(rowId, source, options) ?? false;
}

export function syncEditorVirtualizationRowLayout(source) {
  const rowCard = resolveMountedEditorRowCard("", source);
  const rowId = rowCard?.dataset?.rowId ?? "";
  return notifyEditorRowHeightMayHaveChanged(rowId, source, {
    reason: "row-layout",
  });
}

export function refreshEditorVirtualizationLayout(anchorSnapshot = null) {
  activeController?.refreshLayout?.(anchorSnapshot ?? null);
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

  const rangeKey = shouldVirtualize ? "tanstack-unavailable" : "non-virtualized";
  const visibleImageDebugSnapshot = () => ({
    rangeKey,
    scrollTop: scrollContainer.scrollTop,
    visibleImages: captureRenderedEditorImageDebugState(itemsContainer),
  });
  const uninstallImageDebugWindowApi = installEditorImageDebugWindowApi(visibleImageDebugSnapshot);

  const restoreAnchorSnapshot = (anchorSnapshot, reason = "refresh-layout") => {
    if (!anchorSnapshot?.rowId) {
      return false;
    }

    const restored = restoreTranslateRowAnchor(anchorSnapshot);
    logEditorScrollDebug("virtualization-anchor-restored", {
      reason,
      rowAnchorId: anchorSnapshot.rowId ?? "",
      scrollTop: scrollContainer.scrollTop,
      rangeKey,
    });
    return restored;
  };

  const glossarySync = createEditorVisibleGlossarySync(root, scrollContainer, appState, {
    afterVisibleSync() {
      logEditorScrollDebug("glossary-visible-sync-layout-skipped", {
        scrollTop: scrollContainer.scrollTop,
        rangeKey,
      });
    },
  });

  const scheduleNonVirtualizedSync = (reason) => {
    logEditorScrollDebug("non-virtualized-editor-layout-sync", {
      reason,
      scrollTop: scrollContainer.scrollTop,
      rangeKey,
    });
    glossarySync.schedule();
  };

  const notifyRowsChanged = () => {
    scheduleNonVirtualizedSync("row-change");
    return false;
  };

  const notifyRowHeightMayHaveChanged = () => {
    scheduleNonVirtualizedSync("row-layout");
    return false;
  };

  const refreshLayout = (anchorSnapshot = null) => {
    restoreAnchorSnapshot(anchorSnapshot, "refresh-layout");
    scheduleNonVirtualizedSync("refresh-layout");
  };

  const handleResize = () => {
    scheduleNonVirtualizedSync("resize");
  };

  const handleScroll = () => {
    logEditorScrollDebug("non-virtualized-editor-scroll-event", {
      scrollTop: scrollContainer.scrollTop,
      rangeKey,
    });
    glossarySync.schedule();
  };

  const handleImageLoad = (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.matches("[data-editor-language-image-preview-img]")) {
      return;
    }

    logEditorImageLifecycleEvent("editor-image-load", image, null, {
      rangeKey,
      scrollTop: scrollContainer.scrollTop,
    });
  };

  const handleImageError = (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.matches("[data-editor-language-image-preview-img]")) {
      return;
    }

    logEditorImageLifecycleEvent("editor-image-error", image, null, {
      rangeKey,
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
    syncRowLayout: notifyRowHeightMayHaveChanged,
    refreshLayout,
    destroy() {
      uninstallImageDebugWindowApi();
      glossarySync.destroy();
      scrollContainer.removeEventListener("scroll", handleScroll);
      root.removeEventListener("load", handleImageLoad, true);
      root.removeEventListener("error", handleImageError, true);
      window.removeEventListener("resize", handleResize);
    },
  };

  if (shouldVirtualize) {
    logEditorScrollDebug("tanstack-virtualizer-unavailable", {
      scrollTop: scrollContainer.scrollTop,
      rangeKey,
    });
  }
  glossarySync.schedule();
}
