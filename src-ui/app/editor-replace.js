import { findEditorSearchMatches } from "./editor-filters.js";

function normalizeString(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function cloneRowFields(fields) {
  return Object.fromEntries(
    Object.entries(fields && typeof fields === "object" ? fields : {}).map(([code, value]) => [
      code,
      normalizeString(value),
    ]),
  );
}

export function applyEditorSearchReplace(text, searchQuery, replaceText, languageCode = "", options = {}) {
  const sourceText = normalizeString(text);
  const replacement = normalizeString(replaceText);
  const matches = findEditorSearchMatches(sourceText, searchQuery, languageCode, options);
  if (matches.length === 0) {
    return sourceText;
  }

  let cursor = 0;
  let nextText = "";
  for (const match of matches) {
    nextText += sourceText.slice(cursor, match.start);
    nextText += replacement;
    cursor = match.end;
  }
  nextText += sourceText.slice(cursor);
  return nextText;
}

export function buildEditorBatchReplaceUpdates({
  rows,
  selectedRowIds,
  visibleLanguageCodes,
  searchQuery,
  replaceText,
  caseSensitive = false,
}) {
  const selectedIds = selectedRowIds instanceof Set ? selectedRowIds : new Set();
  const visibleCodes = visibleLanguageCodes instanceof Set ? visibleLanguageCodes : new Set();
  const updatedRows = [];
  const matchingSelectedRowIds = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const rowId = typeof row?.rowId === "string" ? row.rowId : "";
    if (!rowId || !selectedIds.has(rowId) || row?.lifecycleState === "deleted") {
      continue;
    }

    const currentFields = cloneRowFields(row.fields);
    let matched = false;
    let changed = false;
    const nextFields = cloneRowFields(currentFields);

    for (const languageCode of visibleCodes) {
      const currentText = normalizeString(currentFields[languageCode] ?? "");
      const matches = findEditorSearchMatches(currentText, searchQuery, languageCode, {
        caseSensitive,
      });
      if (matches.length === 0) {
        continue;
      }

      matched = true;
      const nextText = applyEditorSearchReplace(currentText, searchQuery, replaceText, languageCode, {
        caseSensitive,
      });
      if (nextText !== currentText) {
        nextFields[languageCode] = nextText;
        changed = true;
      }
    }

    if (matched) {
      matchingSelectedRowIds.push(rowId);
    }

    if (changed) {
      updatedRows.push({
        rowId,
        fields: nextFields,
      });
    }
  }

  return {
    matchingSelectedRowIds,
    updatedRows,
    updatedRowIds: updatedRows.map((row) => row.rowId),
  };
}
