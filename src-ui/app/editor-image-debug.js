import {
  clearEditorScrollDebugEntries,
  editorScrollDebugPathHint,
  logEditorScrollDebug,
  readEditorScrollDebugEntries,
} from "./editor-scroll-debug.js";

function roundDebugNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function parseIntegerOrNull(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function imageDebugStateKey(entry) {
  if (!entry?.rowId || !entry?.languageCode) {
    return "";
  }

  return `${entry.rowId}:${entry.languageCode}`;
}

function imageDebugStateSignature(entry) {
  if (!entry) {
    return "";
  }

  return JSON.stringify({
    currentSrc: entry.currentSrc,
    loading: entry.loading,
    complete: entry.complete,
    naturalWidth: entry.naturalWidth,
    naturalHeight: entry.naturalHeight,
    clientWidth: entry.clientWidth,
    clientHeight: entry.clientHeight,
    previewWidth: entry.previewWidth,
    previewHeight: entry.previewHeight,
    rowHeight: entry.rowHeight,
    cachedRowHeight: entry.cachedRowHeight,
    imgDisplay: entry.imgDisplay,
    imgVisibility: entry.imgVisibility,
    imgOpacity: entry.imgOpacity,
  });
}

function flattenEditorImageDebugDetail(entry, previousEntry = null) {
  return {
    rowId: entry?.rowId ?? "",
    rowIndex: entry?.rowIndex ?? null,
    languageCode: entry?.languageCode ?? "",
    currentSrc: entry?.currentSrc ?? "",
    loading: entry?.loading ?? "",
    complete: entry?.complete === true,
    naturalWidth: entry?.naturalWidth ?? 0,
    naturalHeight: entry?.naturalHeight ?? 0,
    clientWidth: entry?.clientWidth ?? 0,
    clientHeight: entry?.clientHeight ?? 0,
    previewWidth: entry?.previewWidth ?? 0,
    previewHeight: entry?.previewHeight ?? 0,
    rowHeight: entry?.rowHeight ?? null,
    cachedRowHeight: entry?.cachedRowHeight ?? null,
    imgDisplay: entry?.imgDisplay ?? "",
    imgVisibility: entry?.imgVisibility ?? "",
    imgOpacity: entry?.imgOpacity ?? "",
    previousComplete: previousEntry?.complete ?? null,
    previousNaturalWidth: previousEntry?.naturalWidth ?? null,
    previousNaturalHeight: previousEntry?.naturalHeight ?? null,
    previousClientWidth: previousEntry?.clientWidth ?? null,
    previousClientHeight: previousEntry?.clientHeight ?? null,
    previousPreviewWidth: previousEntry?.previewWidth ?? null,
    previousPreviewHeight: previousEntry?.previewHeight ?? null,
    previousRowHeight: previousEntry?.rowHeight ?? null,
    previousCachedRowHeight: previousEntry?.cachedRowHeight ?? null,
    previousImgDisplay: previousEntry?.imgDisplay ?? null,
    previousImgVisibility: previousEntry?.imgVisibility ?? null,
    previousImgOpacity: previousEntry?.imgOpacity ?? null,
  };
}

export function captureEditorImageDebugState(image, rowHeightCache = null) {
  if (!(image instanceof HTMLImageElement)) {
    return null;
  }

  const preview = image.closest(".translation-language-panel__image-preview");
  const rowCard = image.closest("[data-editor-row-card]");
  const rowId =
    image.dataset.rowId
    ?? preview?.dataset.rowId
    ?? rowCard?.dataset.rowId
    ?? "";
  const languageCode =
    image.dataset.languageCode
    ?? preview?.dataset.languageCode
    ?? "";
  const computedStyle = window.getComputedStyle(image);

  return {
    rowId,
    rowIndex: parseIntegerOrNull(rowCard?.dataset.rowIndex),
    languageCode,
    currentSrc: image.currentSrc || image.src || "",
    loading: image.loading || "",
    complete: image.complete === true,
    naturalWidth: image.naturalWidth || 0,
    naturalHeight: image.naturalHeight || 0,
    clientWidth: image.clientWidth || 0,
    clientHeight: image.clientHeight || 0,
    previewWidth: preview instanceof HTMLElement ? preview.clientWidth || 0 : 0,
    previewHeight: preview instanceof HTMLElement ? preview.clientHeight || 0 : 0,
    rowHeight:
      rowCard instanceof HTMLElement
        ? roundDebugNumber(rowCard.getBoundingClientRect().height)
        : null,
    cachedRowHeight:
      rowId && rowHeightCache instanceof Map
        ? rowHeightCache.get(rowId) ?? null
        : null,
    imgDisplay: computedStyle.display,
    imgVisibility: computedStyle.visibility,
    imgOpacity: computedStyle.opacity,
  };
}

export function captureRenderedEditorImageDebugState(itemsContainer, rowHeightCache = null) {
  if (!(itemsContainer instanceof HTMLElement)) {
    return [];
  }

  return [...itemsContainer.querySelectorAll("[data-editor-language-image-preview-img]")]
    .map((image) => captureEditorImageDebugState(image, rowHeightCache))
    .filter((entry) => Boolean(entry?.rowId) && Boolean(entry?.languageCode));
}

export function diffCapturedEditorImageDebugState(previousEntries = [], nextEntries = []) {
  const previousByKey = new Map(previousEntries.map((entry) => [imageDebugStateKey(entry), entry]));
  const nextByKey = new Map(nextEntries.map((entry) => [imageDebugStateKey(entry), entry]));
  const mounted = [];
  const unmounted = [];
  const changed = [];

  for (const [key, nextEntry] of nextByKey.entries()) {
    const previousEntry = previousByKey.get(key);
    if (!previousEntry) {
      mounted.push(nextEntry);
      continue;
    }

    if (imageDebugStateSignature(previousEntry) !== imageDebugStateSignature(nextEntry)) {
      changed.push({ previous: previousEntry, next: nextEntry });
    }
  }

  for (const [key, previousEntry] of previousByKey.entries()) {
    if (!nextByKey.has(key)) {
      unmounted.push(previousEntry);
    }
  }

  return { mounted, unmounted, changed };
}

export function logEditorImageDebugDiff(
  previousEntries,
  nextEntries,
  context = {},
) {
  const diff = diffCapturedEditorImageDebugState(previousEntries, nextEntries);

  for (const entry of diff.mounted) {
    logEditorScrollDebug("editor-image-mounted", {
      ...context,
      ...flattenEditorImageDebugDetail(entry),
    });
  }

  for (const { previous, next } of diff.changed) {
    logEditorScrollDebug("editor-image-state-changed", {
      ...context,
      ...flattenEditorImageDebugDetail(next, previous),
    });
  }

  for (const entry of diff.unmounted) {
    logEditorScrollDebug("editor-image-unmounted", {
      ...context,
      ...flattenEditorImageDebugDetail(entry),
    });
  }

  return diff;
}

export function logEditorImageLifecycleEvent(eventName, image, rowHeightCache, context = {}) {
  const entry = captureEditorImageDebugState(image, rowHeightCache);
  if (!entry) {
    return;
  }

  logEditorScrollDebug(eventName, {
    ...context,
    ...flattenEditorImageDebugDetail(entry),
  });
}

export function logEditorImageRowHeightChange(
  rowCard,
  previousHeight,
  nextHeight,
  rowHeightCache,
  context = {},
) {
  if (!(rowCard instanceof HTMLElement)) {
    return;
  }

  const image = rowCard.querySelector("[data-editor-language-image-preview-img]");
  if (!(image instanceof HTMLImageElement)) {
    return;
  }

  const entry = captureEditorImageDebugState(image, rowHeightCache);
  if (!entry) {
    return;
  }

  logEditorScrollDebug("editor-image-row-height-change", {
    ...context,
    previousMeasuredHeight: previousHeight ?? null,
    nextMeasuredHeight: nextHeight ?? null,
    ...flattenEditorImageDebugDetail(entry),
  });
}

export function installEditorImageDebugWindowApi(getSnapshot) {
  if (typeof window !== "object") {
    return () => {};
  }

  const api = {
    pathHint: editorScrollDebugPathHint(),
    readEntries: () => readEditorScrollDebugEntries(),
    clearEntries: () => clearEditorScrollDebugEntries(),
    snapshot: () => (typeof getSnapshot === "function" ? getSnapshot() : null),
  };

  window.__gnosisEditorImageDebug = api;
  return () => {
    if (window.__gnosisEditorImageDebug === api) {
      delete window.__gnosisEditorImageDebug;
    }
  };
}
