import { syncEditorRowTextareaHeights } from "./autosize.js";
import { pendingTranslateAnchorRowId } from "./scroll-state.js";
import {
  buildEditorRowHeights,
  calculateEditorVirtualWindow,
  EDITOR_VIRTUALIZATION_MIN_ROWS,
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

function measureVisibleRowHeights(itemsContainer, rowHeightCache) {
  let changed = false;
  itemsContainer.querySelectorAll("[data-editor-row-card]").forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const rowId = element.dataset.rowId ?? "";
    if (!rowId) {
      return;
    }

    const nextHeight = Math.ceil(element.getBoundingClientRect().height);
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
      return;
    }

    if (rowHeightCache.get(rowId) !== nextHeight) {
      rowHeightCache.set(rowId, nextHeight);
      changed = true;
    }
  });

  return changed;
}

function updateSpacerHeight(spacer, height) {
  if (!(spacer instanceof HTMLElement)) {
    return;
  }

  spacer.style.height = `${Math.max(0, Math.round(height))}px`;
}

function renderWindowRange(itemsContainer, rows, collapsedLanguageCodes, startIndex, endIndex) {
  itemsContainer.innerHTML = renderTranslationContentRowsRange(
    rows,
    collapsedLanguageCodes,
    startIndex,
    endIndex,
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
  if (
    !(scrollContainer instanceof HTMLElement)
    || !(list instanceof HTMLElement)
    || !(itemsContainer instanceof HTMLElement)
  ) {
    return;
  }

  const initialModel = buildEditorScreenViewModel(appState);
  if (!Array.isArray(initialModel.contentRows) || initialModel.contentRows.length < EDITOR_VIRTUALIZATION_MIN_ROWS) {
    return;
  }

  const rowHeightCache = getRowHeightCache(
    initialModel.editorChapter?.chapterId ?? initialModel.chapter?.id ?? "",
    initialModel.collapsedLanguageCodes,
    initialModel.editorFontSizePx,
  );
  let currentRangeKey = "";
  let animationFrameId = 0;

  const renderWindow = (force = false) => {
    const model = buildEditorScreenViewModel(appState);
    const rowHeights = buildEditorRowHeights(
      model.contentRows,
      rowHeightCache,
      model.collapsedLanguageCodes,
      model.editorFontSizePx,
    );
    const activeRowId =
      pendingTranslateAnchorRowId()
      || root.ownerDocument?.activeElement?.closest?.("[data-editor-row-card]")?.dataset?.rowId
      || model.editorChapter?.activeRowId
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
    );
    restoreFocusedEditorField(root, focusSnapshot);

    const heightsChanged = measureVisibleRowHeights(itemsContainer, rowHeightCache);
    if (heightsChanged) {
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
        renderWindowRange(
          itemsContainer,
          model.contentRows,
          model.collapsedLanguageCodes,
          measuredWindow.startIndex,
          measuredWindow.endIndex,
        );
        restoreFocusedEditorField(root, focusSnapshot);
        measureVisibleRowHeights(itemsContainer, rowHeightCache);
      }
    }
  };

  const scheduleRender = () => {
    if (animationFrameId) {
      return;
    }

    animationFrameId = window.requestAnimationFrame(() => {
      animationFrameId = 0;
      renderWindow();
    });
  };

  const handleResize = () => {
    renderWindow(true);
  };

  scrollContainer.addEventListener("scroll", scheduleRender, { passive: true });
  window.addEventListener("resize", handleResize);

  activeController = {
    destroy() {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
      scrollContainer.removeEventListener("scroll", scheduleRender);
      window.removeEventListener("resize", handleResize);
    },
  };

  renderWindow(true);
}
