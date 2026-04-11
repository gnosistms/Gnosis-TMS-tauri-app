function editorRowLabel(row, rowIndex = 0) {
  return (
    row?.externalId?.trim()
    || row?.description?.trim()
    || row?.context?.trim()
    || `Row ${rowIndex + 1}`
  );
}

const editorRowLookupCache = new WeakMap();

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function buildEditorRowLookup(rows) {
  if (editorRowLookupCache.has(rows)) {
    return editorRowLookupCache.get(rows);
  }

  const rowById = new Map();
  const rowIndexById = new Map();
  rows.forEach((row, index) => {
    const rowId = typeof row?.rowId === "string" ? row.rowId.trim() : "";
    if (!rowId) {
      return;
    }

    rowById.set(rowId, row);
    rowIndexById.set(rowId, index);
  });

  const lookup = {
    rowById,
    rowIndexById,
  };
  editorRowLookupCache.set(rows, lookup);
  return lookup;
}

export function editorChapterRows(chapterState) {
  return normalizeRows(chapterState?.rows);
}

export function findEditorChapterRow(chapterState, rowId) {
  if (typeof rowId !== "string" || !rowId.trim()) {
    return null;
  }

  const rows = editorChapterRows(chapterState);
  return buildEditorRowLookup(rows).rowById.get(rowId.trim()) ?? null;
}

export function findEditorChapterRowIndex(chapterState, rowId) {
  if (typeof rowId !== "string" || !rowId.trim()) {
    return -1;
  }

  const rows = editorChapterRows(chapterState);
  return buildEditorRowLookup(rows).rowIndexById.get(rowId.trim()) ?? -1;
}

export function buildEditorRowViewModel(row, languages, rowIndex = 0) {
  return {
    id: row.rowId,
    title: editorRowLabel(row, rowIndex),
    saveStatus: row.saveStatus || "idle",
    saveError: row.saveError || "",
    sections: (Array.isArray(languages) ? languages : []).map((language) => ({
      code: language.code,
      name: language.name,
      text: row.fields?.[language.code] ?? "",
      reviewed: row.fieldStates?.[language.code]?.reviewed === true,
      pleaseCheck: row.fieldStates?.[language.code]?.pleaseCheck === true,
      markerSaveState:
        row.markerSaveState?.languageCode === language.code
          ? row.markerSaveState
          : { status: "idle", languageCode: null, kind: null, error: "" },
    })),
  };
}

export function buildEditorRowViewModelsRange(rows, languages, startIndex = 0, endIndex = rows?.length ?? 0) {
  const normalizedRows = normalizeRows(rows);
  const safeStartIndex = Math.max(0, startIndex);
  const safeEndIndex = Math.min(normalizedRows.length, Math.max(safeStartIndex, endIndex));

  return normalizedRows
    .slice(safeStartIndex, safeEndIndex)
    .map((row, offset) => buildEditorRowViewModel(row, languages, safeStartIndex + offset));
}

export function buildEditorChapterRowViewModelById(chapterState, languages, rowId) {
  const row = findEditorChapterRow(chapterState, rowId);
  if (!row) {
    return null;
  }

  const rowIndex = findEditorChapterRowIndex(chapterState, rowId);
  return buildEditorRowViewModel(row, languages, rowIndex >= 0 ? rowIndex : 0);
}
