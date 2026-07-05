import {
  captureVisibleTranslateLocation,
  queueTranslateRowAnchor,
  readTranslateMainScrollTop,
  restoreTranslateRowAnchor,
} from "./scroll-state.js";
import { readSessionAnchor, updateSessionAnchor } from "./editor-scroll-session.js";
import { EDITOR_MODE_PREVIEW, EDITOR_MODE_TRANSLATE, normalizeEditorMode } from "./editor-preview.js";
import {
  clearStoredEditorLocation,
  loadStoredEditorLocation,
  loadStoredEditorPreviewScrollTop,
  saveStoredEditorLocation,
  saveStoredEditorPreviewScrollTop,
} from "./editor-preferences.js";

const EDITOR_LOCATION_SAVE_DEBOUNCE_MS = 180;

let restoredChapterId = null;
let restoredPreviewChapterId = null;
let pendingRestoreSnapshot = null;
let saveTimerId = null;
let skippedRestoreChapterId = null;

function loadedEditorChapterId(appState) {
  if (
    appState?.editorChapter?.status !== "ready"
    || typeof appState.editorChapter?.chapterId !== "string"
    || !appState.editorChapter.chapterId
    || !Array.isArray(appState.editorChapter.rows)
    || appState.editorChapter.rows.length === 0
  ) {
    return null;
  }

  return appState.editorChapter.chapterId;
}

function currentEditorChapterId(appState) {
  if (
    appState?.screen !== "translate"
    || normalizeEditorMode(appState?.editorChapter?.mode) !== EDITOR_MODE_TRANSLATE
  ) {
    return null;
  }

  return loadedEditorChapterId(appState);
}

function currentPreviewChapterId(appState) {
  if (
    appState?.screen !== "translate"
    || normalizeEditorMode(appState?.editorChapter?.mode) !== EDITOR_MODE_PREVIEW
  ) {
    return null;
  }

  return loadedEditorChapterId(appState);
}

function canRestoreEditorLocation(appState) {
  return appState?.screen === "translate" && appState?.editorChapter?.status === "ready";
}

function clearEditorLocationSaveTimer() {
  if (saveTimerId === null) {
    return;
  }

  window.clearTimeout(saveTimerId);
  saveTimerId = null;
}

function persistEditorLocationForChapter(chapterId, { requireRestored = true } = {}) {
  if (!chapterId) {
    return;
  }

  if (requireRestored && restoredChapterId !== chapterId) {
    return;
  }

  // The scroll session continuously tracks the viewport in model space
  // (scroll redesign P4); the DOM scan remains only as a fallback for the
  // moment before the first scroll/render updates the session.
  const location = readSessionAnchor(chapterId) ?? captureVisibleTranslateLocation();
  if (!location?.rowId) {
    return;
  }

  const scrollTop = readTranslateMainScrollTop();
  saveStoredEditorLocation(chapterId, {
    ...location,
    ...(Number.isFinite(scrollTop) ? { scrollTop } : {}),
  });
}

function persistPreviewScrollForChapter(chapterId) {
  if (!chapterId) {
    return;
  }

  const scrollTop = readTranslateMainScrollTop();
  if (!Number.isFinite(scrollTop)) {
    return;
  }

  saveStoredEditorPreviewScrollTop(chapterId, scrollTop);
}

function isHtmlElement(value) {
  return typeof HTMLElement === "function" && value instanceof HTMLElement;
}

function restoreEditorLocationSnapshot(snapshot) {
  let restoredScrollTop = false;
  const scrollTop = Number(snapshot?.scrollTop);
  if (Number.isFinite(scrollTop)) {
    const container = document.querySelector(".translate-main-scroll");
    if (isHtmlElement(container)) {
      container.scrollTop = scrollTop;
      restoredScrollTop = true;
    }
  }

  const restoredAnchor = restoreTranslateRowAnchor(snapshot);
  return restoredScrollTop || restoredAnchor;
}

function updatePendingEditorLocationRestore(appState) {
  if (!canRestoreEditorLocation(appState)) {
    pendingRestoreSnapshot = null;
    if (appState?.screen !== "translate") {
      restoredChapterId = null;
      restoredPreviewChapterId = null;
    }
    return;
  }

  const previewChapterId = currentPreviewChapterId(appState);
  if (previewChapterId) {
    if (restoredPreviewChapterId === previewChapterId) {
      pendingRestoreSnapshot = null;
      return;
    }

    const scrollTop = Number(loadStoredEditorPreviewScrollTop(previewChapterId));
    if (Number.isFinite(scrollTop)) {
      pendingRestoreSnapshot = {
        chapterId: previewChapterId,
        type: "preview-scroll",
        rowId: "__preview_scroll__",
        offsetTop: 0,
        scrollTop,
      };
    } else {
      restoredPreviewChapterId = previewChapterId;
      pendingRestoreSnapshot = null;
    }
    return;
  }
  restoredPreviewChapterId = null;

  const chapterId = currentEditorChapterId(appState);
  if (!chapterId) {
    pendingRestoreSnapshot = null;
    if (appState?.screen !== "translate") {
      restoredChapterId = null;
      restoredPreviewChapterId = null;
    }
    return;
  }

  if (
    skippedRestoreChapterId
    && (skippedRestoreChapterId === chapterId || skippedRestoreChapterId === "*")
  ) {
    skippedRestoreChapterId = null;
    restoredChapterId = chapterId;
    pendingRestoreSnapshot = null;
    return;
  }

  if (restoredChapterId === chapterId) {
    pendingRestoreSnapshot = null;
    return;
  }

  const savedLocation = loadStoredEditorLocation(chapterId);
  if (!savedLocation?.rowId) {
    restoredChapterId = chapterId;
    pendingRestoreSnapshot = null;
    return;
  }

  pendingRestoreSnapshot = {
    chapterId,
    ...savedLocation,
  };
}

export function prepareEditorLocationBeforeRender(previousScreen, appState, options = {}) {
  clearEditorLocationSaveTimer();

  if (previousScreen === "translate") {
    // Persist based on the mode that was actually on screen (the old DOM), not the
    // new state mode. On a mode switch the state mode is already updated while the
    // old DOM — and therefore its scroll position — still belongs to the old mode.
    // Reading the wrong container clobbers the saved scroll for the other mode.
    if (options.wasPreviewMode) {
      persistPreviewScrollForChapter(loadedEditorChapterId(appState));
    } else {
      persistEditorLocationForChapter(loadedEditorChapterId(appState), {
        requireRestored: appState?.screen === "translate",
      });
    }
  }
}

export function skipNextEditorLocationRestore(chapterId = null) {
  skippedRestoreChapterId =
    typeof chapterId === "string" && chapterId.trim()
      ? chapterId.trim()
      : "*";
}

export function replaceCurrentEditorLocation(appState, snapshot) {
  const chapterId = loadedEditorChapterId(appState);
  const rowId = typeof snapshot?.rowId === "string" ? snapshot.rowId.trim() : "";
  if (!chapterId || !rowId) {
    return false;
  }

  const type =
    snapshot.type === "field"
    || snapshot.type === "row"
    || snapshot.type === "deleted-group"
    || snapshot.type === "language-panel"
    || snapshot.type === "language-toggle"
      ? snapshot.type
      : "row";
  const languageCode =
    typeof snapshot.languageCode === "string" && snapshot.languageCode.trim()
      ? snapshot.languageCode.trim()
      : null;
  const offsetTop = Number(snapshot.offsetTop);
  saveStoredEditorLocation(chapterId, {
    type,
    rowId,
    languageCode,
    offsetTop: Number.isFinite(offsetTop) ? offsetTop : 0,
  });
  restoredChapterId = chapterId;
  if (pendingRestoreSnapshot?.chapterId === chapterId) {
    pendingRestoreSnapshot = null;
  }
  return true;
}

export function queuePendingEditorLocationRestore(appState) {
  updatePendingEditorLocationRestore(appState);

  if (
    pendingRestoreSnapshot?.chapterId === currentEditorChapterId(appState)
    && pendingRestoreSnapshot?.type !== "preview-scroll"
  ) {
    queueTranslateRowAnchor(pendingRestoreSnapshot);
  }
}

export function restorePendingEditorLocation(appState) {
  const expectedChapterId = currentPreviewChapterId(appState) ?? currentEditorChapterId(appState);
  if (pendingRestoreSnapshot?.chapterId !== expectedChapterId) {
    return false;
  }

  const restored = restoreEditorLocationSnapshot(pendingRestoreSnapshot);
  if (!restored && pendingRestoreSnapshot?.type !== "preview-scroll") {
    clearStoredEditorLocation(pendingRestoreSnapshot.chapterId);
  }

  if (pendingRestoreSnapshot.type === "preview-scroll") {
    restoredPreviewChapterId = pendingRestoreSnapshot.chapterId;
  } else {
    restoredChapterId = pendingRestoreSnapshot.chapterId;
    if (restored) {
      // Seed the scroll session so default-safe renders anchor to the
      // restored location before the first scroll event updates it.
      updateSessionAnchor(pendingRestoreSnapshot, pendingRestoreSnapshot.chapterId);
    }
  }
  pendingRestoreSnapshot = null;
  return restored;
}

export function scheduleEditorLocationSave(appState) {
  const previewChapterId = currentPreviewChapterId(appState);
  if (previewChapterId) {
    clearEditorLocationSaveTimer();
    saveTimerId = window.setTimeout(() => {
      saveTimerId = null;
      if (currentPreviewChapterId(appState) !== previewChapterId) {
        return;
      }

      persistPreviewScrollForChapter(previewChapterId);
    }, EDITOR_LOCATION_SAVE_DEBOUNCE_MS);
    return;
  }

  const scheduledChapterId = currentEditorChapterId(appState);
  if (!scheduledChapterId || restoredChapterId !== scheduledChapterId) {
    return;
  }

  clearEditorLocationSaveTimer();
  saveTimerId = window.setTimeout(() => {
    saveTimerId = null;
    if (currentEditorChapterId(appState) !== scheduledChapterId) {
      return;
    }

    persistEditorLocationForChapter(scheduledChapterId);
  }, EDITOR_LOCATION_SAVE_DEBOUNCE_MS);
}

export function persistCurrentEditorLocation(appState) {
  const previewChapterId = currentPreviewChapterId(appState);
  if (previewChapterId) {
    persistPreviewScrollForChapter(previewChapterId);
    return;
  }

  persistEditorLocationForChapter(currentEditorChapterId(appState), {
    requireRestored: false,
  });
}

export function persistCurrentPreviewScroll(appState) {
  persistPreviewScrollForChapter(currentPreviewChapterId(appState));
}
