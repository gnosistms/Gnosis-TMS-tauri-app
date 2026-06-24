import { waitForNextPaint } from "./runtime.js";
import {
  buildEditorPreviewDocument,
  countEditorPreviewSearchMatches,
  EDITOR_MODE_PREVIEW,
  EDITOR_MODE_TRANSLATE,
  normalizeEditorMode,
  normalizeEditorPreviewSearchState,
  selectedEditorPreviewLanguageCode,
  stepEditorPreviewSearchState,
} from "./editor-preview.js";
import {
  captureRenderScrollSnapshot,
  lockScreenScrollSnapshot,
  queueTranslateRowAnchor,
  unlockScreenScrollSnapshot,
} from "./scroll-state.js";
import { buildEditorShowRowInContextChapterState } from "./editor-show-context.js";
import {
  persistCurrentPreviewScroll,
  replaceCurrentEditorLocation,
} from "./editor-location.js";
import {
  clearStoredEditorPreviewLanguageCode,
  saveStoredEditorPreviewLanguageCode,
} from "./editor-preferences.js";
import { state } from "./state.js";

let previewModeTranslateScrollSnapshot = null;

function currentEditorMode() {
  return normalizeEditorMode(state.editorChapter?.mode);
}

function currentPreviewBlocks(chapterState = state.editorChapter) {
  return buildEditorPreviewDocument(
    chapterState?.rows,
    selectedEditorPreviewLanguageCode(chapterState),
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

function isHtmlElement(value) {
  return typeof HTMLElement === "function" && value instanceof HTMLElement;
}

function previewBlockOffsetTop(previewBlock) {
  if (!isHtmlElement(previewBlock)) {
    return 0;
  }

  const scrollContainer = previewBlock.closest(".translate-main-scroll");
  if (!isHtmlElement(scrollContainer)) {
    return 0;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const blockRect = previewBlock.getBoundingClientRect();
  const offsetTop = blockRect.top - containerRect.top;
  return Number.isFinite(offsetTop) ? offsetTop : 0;
}

function previewBlockLanguageCode(previewBlock) {
  if (!isHtmlElement(previewBlock)) {
    return "";
  }

  const explicitCode = String(previewBlock.getAttribute("lang") ?? "").trim();
  return explicitCode || String(selectedEditorPreviewLanguageCode(state.editorChapter) ?? "").trim();
}

export function buildTranslateAnchorForPreviewBlock(previewBlock, chapterState = state.editorChapter) {
  if (!isHtmlElement(previewBlock)) {
    return null;
  }

  const rowId = String(previewBlock.dataset.rowId ?? "").trim();
  if (!rowId) {
    return null;
  }

  const languageCode = previewBlockLanguageCode(previewBlock);
  const languages = Array.isArray(chapterState?.languages) ? chapterState.languages : [];
  const languageCodes = new Set(languages.map((language) => language?.code).filter(Boolean));
  const canAnchorLanguage = Boolean(languageCode) && (languageCodes.size === 0 || languageCodes.has(languageCode));
  return {
    rowId,
    type: canAnchorLanguage ? "language-panel" : "row",
    languageCode: canAnchorLanguage ? languageCode : null,
    offsetTop: previewBlockOffsetTop(previewBlock),
  };
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

export function updateEditorPreviewLanguage(render, nextCode) {
  if (currentEditorMode() !== EDITOR_MODE_PREVIEW) {
    return;
  }

  const languages = Array.isArray(state.editorChapter?.languages) ? state.editorChapter.languages : [];
  const languageCode = String(nextCode ?? "").trim();
  if (!languageCode || !languages.some((language) => language?.code === languageCode)) {
    return;
  }

  const chapterId =
    typeof state.editorChapter?.chapterId === "string"
      ? state.editorChapter.chapterId.trim()
      : "";
  const defaultLanguageCode = selectedEditorPreviewLanguageCode({
    ...state.editorChapter,
    previewLanguageCode: null,
  });
  if (languageCode === defaultLanguageCode) {
    clearStoredEditorPreviewLanguageCode(chapterId);
  } else {
    saveStoredEditorPreviewLanguageCode(chapterId, languageCode);
  }

  const nextEditorChapter = {
    ...state.editorChapter,
    previewLanguageCode: languageCode,
  };
  state.editorChapter = {
    ...nextEditorChapter,
    previewSearch: previewSearchStateWithTotal(nextEditorChapter),
  };
  renderPreviewMode(render);
}

export function setEditorMode(render, nextMode, options = {}) {
  const normalizedMode = normalizeEditorMode(nextMode);
  const previousMode = currentEditorMode();
  if (normalizedMode === previousMode) {
    return;
  }

  const translateAnchor =
    previousMode === EDITOR_MODE_PREVIEW
    && normalizedMode === EDITOR_MODE_TRANSLATE
    && options?.translateAnchor?.rowId
      ? options.translateAnchor
      : null;

  if (previousMode === EDITOR_MODE_TRANSLATE) {
    previewModeTranslateScrollSnapshot = captureRenderScrollSnapshot("translate");
  } else if (previousMode === EDITOR_MODE_PREVIEW && normalizedMode === EDITOR_MODE_TRANSLATE) {
    persistCurrentPreviewScroll(state);
  }

  const nextEditorChapter = {
    ...state.editorChapter,
    mode: normalizedMode,
    previewLanguageCode:
      normalizedMode === EDITOR_MODE_PREVIEW
        ? selectedEditorPreviewLanguageCode(state.editorChapter)
        : state.editorChapter.previewLanguageCode ?? null,
    previewSearch:
      normalizedMode === EDITOR_MODE_PREVIEW
        ? previewSearchStateWithTotal()
        : normalizedPreviewSearchState(state.editorChapter.previewSearch),
  };

  state.editorChapter = translateAnchor
    ? buildEditorShowRowInContextChapterState(nextEditorChapter)
    : nextEditorChapter;

  if (translateAnchor) {
    previewModeTranslateScrollSnapshot = null;
    queueTranslateRowAnchor(translateAnchor);
    replaceCurrentEditorLocation(state, translateAnchor);
    render?.();
    return;
  }

  if (previousMode === EDITOR_MODE_PREVIEW && normalizedMode === EDITOR_MODE_TRANSLATE && previewModeTranslateScrollSnapshot) {
    lockScreenScrollSnapshot("translate", previewModeTranslateScrollSnapshot);
    render?.();
    void waitForNextPaint().then(() => unlockScreenScrollSnapshot("translate"));
    return;
  }

  render?.();
}

export function jumpFromPreviewBlockToTranslateMode(render, previewBlock) {
  if (currentEditorMode() !== EDITOR_MODE_PREVIEW) {
    return false;
  }

  const translateAnchor = buildTranslateAnchorForPreviewBlock(previewBlock);
  if (!translateAnchor?.rowId) {
    return false;
  }

  setEditorMode(render, EDITOR_MODE_TRANSLATE, { translateAnchor });
  return true;
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
