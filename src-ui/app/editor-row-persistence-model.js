import { normalizeEditorTextStyle } from "./editor-text-style.js";

function normalizeFieldState(fieldState) {
  return {
    reviewed: fieldState?.reviewed === true,
    pleaseCheck: fieldState?.pleaseCheck === true,
  };
}

export function cloneDirtyRowIds(dirtyRowIds) {
  return dirtyRowIds instanceof Set
    ? new Set([...dirtyRowIds].filter(Boolean))
    : new Set();
}

export function rowFieldsEqual(left, right) {
  const leftEntries = Object.entries(left && typeof left === "object" ? left : {});
  const rightEntries = Object.entries(right && typeof right === "object" ? right : {});
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([code, value]) => (right?.[code] ?? "") === value);
}

export function rowFieldStatesEqual(left, right) {
  const leftEntries = Object.entries(left && typeof left === "object" ? left : {});
  const rightEntries = Object.entries(right && typeof right === "object" ? right : {});
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([code, value]) => {
    const leftState = normalizeFieldState(value);
    const rightState = normalizeFieldState(right?.[code]);
    return (
      leftState.reviewed === rightState.reviewed
      && leftState.pleaseCheck === rightState.pleaseCheck
    );
  });
}

export function rowTextStylesEqual(left, right) {
  return normalizeEditorTextStyle(left) === normalizeEditorTextStyle(right);
}

export function rowHasFieldChanges(row) {
  return !rowFieldsEqual(row?.fields, row?.persistedFields);
}

export function rowHasTextStyleChanges(row) {
  return !rowTextStylesEqual(row?.textStyle, row?.persistedTextStyle);
}

export function rowHasContentChanges(row) {
  return rowHasFieldChanges(row) || rowHasTextStyleChanges(row);
}

export function rowHasPersistedChanges(row) {
  return rowHasContentChanges(row) || !rowFieldStatesEqual(row?.fieldStates, row?.persistedFieldStates);
}

export function rowNeedsDirtyTracking(row) {
  return rowHasPersistedChanges(row)
    || row?.saveStatus === "saving"
    || row?.markerSaveState?.status === "saving";
}

function normalizedTextValue(value) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

export function reviewTabLanguageToOpenAfterSave(editorChapter, rowId, row, nextFields) {
  if (!editorChapter?.chapterId || editorChapter.activeRowId !== rowId) {
    return null;
  }

  const activeLanguageCode =
    typeof editorChapter.activeLanguageCode === "string" ? editorChapter.activeLanguageCode : "";
  if (!activeLanguageCode || activeLanguageCode === editorChapter.selectedSourceLanguageCode) {
    return null;
  }

  const previousText = normalizedTextValue(row?.persistedFields?.[activeLanguageCode] ?? "");
  const nextText = normalizedTextValue(nextFields?.[activeLanguageCode] ?? "");
  if (previousText || !nextText) {
    return null;
  }

  return activeLanguageCode;
}

export function resolveDirtyTrackedEditorRowIds(dirtyRowIds, options = {}) {
  const trackedRowIds = cloneDirtyRowIds(dirtyRowIds);
  const candidateRowIds = Array.isArray(options?.rowIds)
    ? options.rowIds.filter((rowId) => trackedRowIds.has(rowId))
    : [...trackedRowIds];
  const excludedRowId = typeof options?.excludeRowId === "string" ? options.excludeRowId : "";
  return [...new Set(candidateRowIds.filter((rowId) => rowId && rowId !== excludedRowId))];
}

export function reconcileDirtyRowIds(rows, dirtyRowIds, rowIds = null) {
  const rowMap = new Map(
    (Array.isArray(rows) ? rows : [])
      .map((row) => [row?.rowId, row])
      .filter(([rowId]) => Boolean(rowId)),
  );
  const nextDirtyRowIds = cloneDirtyRowIds(dirtyRowIds);
  const candidateRowIds = Array.isArray(rowIds)
    ? rowIds.filter(Boolean)
    : [...nextDirtyRowIds];

  for (const rowId of candidateRowIds) {
    const row = rowMap.get(rowId) ?? null;
    if (rowNeedsDirtyTracking(row)) {
      nextDirtyRowIds.add(rowId);
      continue;
    }

    nextDirtyRowIds.delete(rowId);
  }

  return nextDirtyRowIds;
}
