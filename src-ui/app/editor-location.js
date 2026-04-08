import {
  captureVisibleTranslateLocation,
  queueTranslateRowAnchor,
  restoreTranslateRowAnchor,
} from "./scroll-state.js";
import {
  clearStoredEditorLocation,
  loadStoredEditorLocation,
  saveStoredEditorLocation,
} from "./editor-preferences.js";

const EDITOR_LOCATION_SAVE_DEBOUNCE_MS = 180;

let restoredChapterId = null;
let pendingRestoreSnapshot = null;
let saveTimerId = null;

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
  if (appState?.screen !== "translate") {
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

  const location = captureVisibleTranslateLocation();
  if (!location?.rowId) {
    return;
  }

  saveStoredEditorLocation(chapterId, location);
}

function updatePendingEditorLocationRestore(appState) {
  if (!canRestoreEditorLocation(appState)) {
    pendingRestoreSnapshot = null;
    if (appState?.screen !== "translate") {
      restoredChapterId = null;
    }
    return;
  }

  const chapterId = currentEditorChapterId(appState);
  if (!chapterId) {
    pendingRestoreSnapshot = null;
    if (appState?.screen !== "translate") {
      restoredChapterId = null;
    }
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

export function prepareEditorLocationBeforeRender(previousScreen, appState) {
  clearEditorLocationSaveTimer();

  if (previousScreen === "translate") {
    persistEditorLocationForChapter(loadedEditorChapterId(appState));
  }
}

export function queuePendingEditorLocationRestore(appState) {
  updatePendingEditorLocationRestore(appState);

  if (pendingRestoreSnapshot?.chapterId === currentEditorChapterId(appState)) {
    queueTranslateRowAnchor(pendingRestoreSnapshot);
  }
}

export function restorePendingEditorLocation(appState) {
  if (pendingRestoreSnapshot?.chapterId !== currentEditorChapterId(appState)) {
    return;
  }

  const restored = restoreTranslateRowAnchor(pendingRestoreSnapshot);
  if (!restored) {
    clearStoredEditorLocation(pendingRestoreSnapshot.chapterId);
  }

  restoredChapterId = pendingRestoreSnapshot.chapterId;
  pendingRestoreSnapshot = null;
}

export function scheduleEditorLocationSave(appState) {
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
  persistEditorLocationForChapter(currentEditorChapterId(appState));
}
