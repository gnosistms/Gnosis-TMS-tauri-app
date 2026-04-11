import { syncEditorRowTextareaHeights } from "./autosize.js";
import { pendingTranslateAnchorRowId } from "./scroll-state.js";
import { findEditorChapterRowIndex } from "./editor-row-model.js";
import {
  buildEditorRowHeights,
  calculateEditorVirtualWindow,
  EDITOR_VIRTUALIZATION_MIN_ROWS,
} from "./editor-virtualization-shared.js";
import { buildEditorScreenViewModel } from "./editor-screen-model.js";
import { renderTranslationContentRowsRange } from "./editor-row-render.js";
import {
  restoreMountedEditorGlossaryHighlightsFromCache,
  syncVisibleEditorGlossaryHighlightRows,
} from "./translate-flow.js";

let activeController = null;

const rowHeightCacheByLayoutKey = new Map();
const EDITOR_GLOSSARY_SCROLL_DEBOUNCE_MS = 100;

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

function renderWindowRange(
  itemsContainer,
  rows,
  languages,
  collapsedLanguageCodes,
  startIndex,
  endIndex,
) {
  itemsContainer.innerHTML = renderTranslationContentRowsRange(
    rows,
    languages,
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
  if (!(scrollContainer instanceof HTMLElement)) {
    return;
  }

  const initialModel = buildEditorScreenViewModel(appState);
  const shouldVirtualize =
    Array.isArray(initialModel.editorRows)
    && initialModel.rowCount >= EDITOR_VIRTUALIZATION_MIN_ROWS
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
  let glossaryHighlightTimeoutId = 0;
  let glossaryHighlightFrameId = 0;

  const scheduleVisibleGlossaryHighlights = () => {
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
        syncVisibleEditorGlossaryHighlightRows(root, scrollContainer, model.editorChapter);
      });
    }, EDITOR_GLOSSARY_SCROLL_DEBOUNCE_MS);
  };

  const renderWindow = (force = false) => {
    if (!shouldVirtualize || !(itemsContainer instanceof HTMLElement)) {
      return;
    }

    const model = buildEditorScreenViewModel(appState);
    const rowHeights = buildEditorRowHeights(
      model.editorRows,
      rowHeightCache,
      model.collapsedLanguageCodes,
      model.editorFontSizePx,
      model.languages,
    );
    const activeRowId =
      pendingTranslateAnchorRowId()
      || root.ownerDocument?.activeElement?.closest?.("[data-editor-row-card]")?.dataset?.rowId
      || model.editorChapter?.activeRowId
      || "";
    const pinnedRowIndex = activeRowId
      ? findEditorChapterRowIndex(model.editorChapter, activeRowId)
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
      model.editorRows,
      model.languages,
      model.collapsedLanguageCodes,
      windowState.startIndex,
      windowState.endIndex,
    );
    restoreFocusedEditorField(root, focusSnapshot);
    restoreMountedEditorGlossaryHighlightsFromCache(itemsContainer, model.editorChapter);

    const heightsChanged = measureVisibleRowHeights(itemsContainer, rowHeightCache);
    if (heightsChanged) {
      const measuredHeights = buildEditorRowHeights(
        model.editorRows,
        rowHeightCache,
        model.collapsedLanguageCodes,
        model.editorFontSizePx,
        model.languages,
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
          model.editorRows,
          model.languages,
          model.collapsedLanguageCodes,
          measuredWindow.startIndex,
          measuredWindow.endIndex,
        );
        restoreFocusedEditorField(root, focusSnapshot);
        restoreMountedEditorGlossaryHighlightsFromCache(itemsContainer, model.editorChapter);
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
    if (shouldVirtualize) {
      renderWindow(true);
    }
    scheduleVisibleGlossaryHighlights();
  };

  const handleScroll = () => {
    if (shouldVirtualize) {
      scheduleRender();
    }
    scheduleVisibleGlossaryHighlights();
  };

  scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
  window.addEventListener("resize", handleResize);

  activeController = {
    destroy() {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
      if (glossaryHighlightTimeoutId) {
        window.clearTimeout(glossaryHighlightTimeoutId);
      }
      if (glossaryHighlightFrameId) {
        window.cancelAnimationFrame(glossaryHighlightFrameId);
      }
      scrollContainer.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    },
  };

  if (shouldVirtualize) {
    renderWindow(true);
  }
  scheduleVisibleGlossaryHighlights();
}
