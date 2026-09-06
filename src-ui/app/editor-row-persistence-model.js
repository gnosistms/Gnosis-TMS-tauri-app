import { rowImagesEqual } from "./editor-images.js";
import { normalizeEditorFootnotes } from "./editor-footnotes.js";
import { rowTimingsEqual } from "./editor-timing.js";

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

export function rowFootnotesEqual(left, right) {
  const leftEntries = Object.entries(left && typeof left === "object" ? left : {});
  const rightEntries = Object.entries(right && typeof right === "object" ? right : {});
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([code, value]) => {
    const leftFootnotes = normalizeEditorFootnotes(value);
    const rightFootnotes = normalizeEditorFootnotes(right?.[code]);
    if (leftFootnotes.length !== rightFootnotes.length) {
      return false;
    }

    return leftFootnotes.every((entry, index) => (
      entry.marker === rightFootnotes[index]?.marker
      && entry.text === rightFootnotes[index]?.text
    ));
  });
}

export function rowTextContentEqual(
  leftFields,
  leftFootnotes,
  leftImageCaptions,
  rightFields,
  rightFootnotes,
  rightImageCaptions,
  leftImages = {},
  rightImages = {},
) {
  return (
    rowFieldsEqual(leftFields, rightFields)
    && rowFootnotesEqual(leftFootnotes, rightFootnotes)
    && rowFieldsEqual(leftImageCaptions, rightImageCaptions)
    && rowImagesEqual(leftImages, rightImages)
  );
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

// Language codes whose text content (field, footnotes, or caption) differs
// from what was last persisted — the columns a save is actually about.
// Rows without persisted tracking (none loaded yet) report every column.
export function editorRowChangedLanguageCodes(row) {
  const fields = row?.fields ?? {};
  const footnotes = row?.footnotes ?? {};
  const imageCaptions = row?.imageCaptions ?? {};
  const languageCodes = new Set([
    ...Object.keys(fields),
    ...Object.keys(footnotes),
    ...Object.keys(imageCaptions),
  ]);
  if (!row?.persistedFields && !row?.persistedFootnotes && !row?.persistedImageCaptions) {
    return languageCodes;
  }
  const persistedFields = row?.persistedFields ?? {};
  const persistedFootnotes = row?.persistedFootnotes ?? {};
  const persistedImageCaptions = row?.persistedImageCaptions ?? {};
  const changed = new Set();
  for (const languageCode of languageCodes) {
    if (
      !rowTextContentEqual(
        { [languageCode]: fields[languageCode] ?? "" },
        { [languageCode]: footnotes[languageCode] ?? [] },
        { [languageCode]: imageCaptions[languageCode] ?? "" },
        { [languageCode]: persistedFields[languageCode] ?? "" },
        { [languageCode]: persistedFootnotes[languageCode] ?? [] },
        { [languageCode]: persistedImageCaptions[languageCode] ?? "" },
      )
    ) {
      changed.add(languageCode);
    }
  }
  return changed;
}

export function rowHasFieldChanges(row) {
  return (
    !rowTextContentEqual(
      row?.fields,
      row?.footnotes,
      row?.imageCaptions,
      row?.persistedFields,
      row?.persistedFootnotes,
      row?.persistedImageCaptions,
      row?.images,
      row?.persistedImages,
    )
    || !rowTimingsEqual(row?.timings, row?.persistedTimings)
  );
}

export function rowHasPersistedChanges(row) {
  return rowHasFieldChanges(row) || !rowFieldStatesEqual(row?.fieldStates, row?.persistedFieldStates);
}

export function rowNeedsDirtyTracking(row) {
  return rowHasPersistedChanges(row)
    || row?.saveStatus === "saving"
    || row?.markerSaveState?.status === "saving"
    || row?.textStyleSaveState?.status === "saving";
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
