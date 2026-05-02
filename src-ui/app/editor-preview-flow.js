import { waitForNextPaint } from "./runtime.js";
import {
  buildEditorPreviewDocument,
  countEditorPreviewSearchMatches,
  EDITOR_MODE_PREVIEW,
  EDITOR_MODE_TRANSLATE,
  normalizeEditorMode,
  normalizeEditorPreviewSearchState,
  serializeEditorPreviewHtml,
  stepEditorPreviewSearchState,
} from "./editor-preview.js";
import {
  captureRenderScrollSnapshot,
  lockScreenScrollSnapshot,
  unlockScreenScrollSnapshot,
} from "./scroll-state.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

let previewModeTranslateScrollSnapshot = null;

function currentEditorMode() {
  return normalizeEditorMode(state.editorChapter?.mode);
}

function currentPreviewBlocks(chapterState = state.editorChapter) {
  return buildEditorPreviewDocument(
    chapterState?.rows,
    chapterState?.selectedTargetLanguageCode,
  );
}

function normalizedPreviewSearchState(chapterState = state.editorChapter) {
  return normalizeEditorPreviewSearchState(chapterState?.previewSearch);
}

function previewSearchStateWithTotal(chapterState = state.editorChapter, overrides = {}) {
  const nextState = {
    ...normalizedPreviewSearchState(chapterState),
    ...overrides,
  };
  return {
    ...nextState,
    totalMatchCount: countEditorPreviewSearchMatches(currentPreviewBlocks(chapterState), nextState.query),
  };
}

function renderPreviewMode(render, options = {}) {
  if (options.header !== false) {
    render?.({ scope: "translate-header" });
  }
  if (options.body !== false) {
    render?.({ scope: "translate-body" });
  }
}

function currentPreviewSearchInputValue() {
  const input = document.querySelector("[data-preview-search-input]");
  return input instanceof HTMLInputElement ? input.value : null;
}

function currentPreviewSearchMatchIndex() {
  const activeMatch = document.querySelector(
    ".translate-preview__search-match.is-active[data-preview-search-match-index]",
  );
  if (!(activeMatch instanceof HTMLElement)) {
    return null;
  }

  const index = Number.parseInt(activeMatch.dataset.previewSearchMatchIndex ?? "", 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function focusPreviewSearchInput(selection = null, value = null) {
  requestAnimationFrame(() => {
    const input = document.querySelector("[data-preview-search-input]");
    if (!(input instanceof HTMLInputElement) || input.disabled) {
      return;
    }

    if (typeof value === "string" && input.value !== value) {
      input.value = value;
    }
    input.focus({ preventScroll: true });
    if (
      selection
      && typeof selection.selectionStart === "number"
      && typeof selection.selectionEnd === "number"
    ) {
      input.setSelectionRange(
        selection.selectionStart,
        selection.selectionEnd,
        selection.selectionDirection ?? "none",
      );
    }
  });
}

export function resetEditorPreviewModeScrollSnapshot() {
  previewModeTranslateScrollSnapshot = null;
}

export function refreshEditorPreviewAfterTargetLanguageChange(render) {
  if (currentEditorMode() !== EDITOR_MODE_PREVIEW) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    previewSearch: previewSearchStateWithTotal(),
  };
  renderPreviewMode(render);
}

export function setEditorMode(render, nextMode) {
  const normalizedMode = normalizeEditorMode(nextMode);
  const previousMode = currentEditorMode();
  if (normalizedMode === previousMode) {
    return;
  }

  if (previousMode === EDITOR_MODE_TRANSLATE) {
    previewModeTranslateScrollSnapshot = captureRenderScrollSnapshot("translate");
  }

  state.editorChapter = {
    ...state.editorChapter,
    mode: normalizedMode,
    previewSearch:
      normalizedMode === EDITOR_MODE_PREVIEW
        ? previewSearchStateWithTotal()
        : normalizedPreviewSearchState(state.editorChapter.previewSearch),
  };

  if (previousMode === EDITOR_MODE_PREVIEW && normalizedMode === EDITOR_MODE_TRANSLATE && previewModeTranslateScrollSnapshot) {
    lockScreenScrollSnapshot("translate", previewModeTranslateScrollSnapshot);
    render?.();
    void waitForNextPaint().then(() => unlockScreenScrollSnapshot("translate"));
    return;
  }

  render?.();
}

export function updateEditorPreviewSearchQuery(render, nextValue) {
  if (currentEditorMode() !== EDITOR_MODE_PREVIEW) {
    return;
  }

  const query = typeof nextValue === "string" ? nextValue : String(nextValue ?? "");
  state.editorChapter = {
    ...state.editorChapter,
    previewSearch: previewSearchStateWithTotal(state.editorChapter, {
      query,
      activeMatchIndex: 0,
    }),
  };
  renderPreviewMode(render);
}

export function moveEditorPreviewSearch(render, direction = "next") {
  if (currentEditorMode() !== EDITOR_MODE_PREVIEW) {
    return;
  }

  const activePreviewSearchInput = document.activeElement instanceof HTMLInputElement
    && document.activeElement.matches("[data-preview-search-input]")
    ? document.activeElement
    : null;
  const selection = activePreviewSearchInput
    ? {
      selectionStart: activePreviewSearchInput.selectionStart,
      selectionEnd: activePreviewSearchInput.selectionEnd,
      selectionDirection: activePreviewSearchInput.selectionDirection,
    }
    : null;
  const liveQuery = currentPreviewSearchInputValue();
  const liveMatchIndex = currentPreviewSearchMatchIndex();
  const currentSearchState = normalizedPreviewSearchState(state.editorChapter.previewSearch);
  const nextSearchBaseState =
    (typeof liveQuery === "string" && liveQuery !== currentSearchState.query)
    || (typeof liveMatchIndex === "number" && liveMatchIndex !== currentSearchState.activeMatchIndex)
      ? previewSearchStateWithTotal(state.editorChapter, {
        ...currentSearchState,
        ...(typeof liveQuery === "string" ? { query: liveQuery } : {}),
        ...(typeof liveMatchIndex === "number" ? { activeMatchIndex: liveMatchIndex } : {}),
      })
      : currentSearchState;
  const nextPreviewSearch = stepEditorPreviewSearchState(
    currentPreviewBlocks(),
    nextSearchBaseState,
    direction,
  );
  state.editorChapter = {
    ...state.editorChapter,
    previewSearch: nextPreviewSearch,
  };
  renderPreviewMode(render);
  focusPreviewSearchInput(selection, nextPreviewSearch.query);
}

export async function copyEditorPreviewHtml(render) {
  if (currentEditorMode() !== EDITOR_MODE_PREVIEW) {
    return;
  }

  const html = serializeEditorPreviewHtml(currentPreviewBlocks());
  if (!html) {
    showNoticeBadge("Nothing to copy.", render);
    return;
  }

  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    showNoticeBadge("Clipboard access is not available.", render, 1800);
    return;
  }

  try {
    await navigator.clipboard.writeText(html);
    showNoticeBadge("Copied HTML.", render, 1400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNoticeBadge(message || "The HTML could not be copied.", render, 2200);
  }
}
