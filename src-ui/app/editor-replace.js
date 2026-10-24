import { findEditorSearchMatches } from "./editor-filters.js";
import { cloneRowFields, cloneRowFootnotes } from "./editor-utils.js";
import { createEditorReplaceState, createEditorReplaceUndoModalState } from "./state.js";
import { srtGroupingEnabled, srtGroupsForChapter, combineSrtRows } from "./editor-srt-grouping.js";
import { replaceSrtFragmentTexts } from "./editor-srt-group-replace.js";

function normalizeString(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

export function cloneEditorReplaceSelectedRowIds(selectedRowIds) {
  return selectedRowIds instanceof Set
    ? new Set([...selectedRowIds].filter(Boolean))
    : new Set();
}

export function normalizeEditorReplaceState(replace) {
  return {
    ...createEditorReplaceState(),
    ...(replace && typeof replace === "object" ? replace : {}),
    enabled: replace?.enabled === true,
    replaceQuery: typeof replace?.replaceQuery === "string" ? replace.replaceQuery : "",
    selectedRowIds: cloneEditorReplaceSelectedRowIds(replace?.selectedRowIds),
    status: replace?.status === "saving" ? "saving" : "idle",
    error: typeof replace?.error === "string" ? replace.error : "",
  };
}

export function normalizeEditorReplaceUndoModalState(modal) {
  return {
    ...createEditorReplaceUndoModalState(),
    ...(modal && typeof modal === "object" ? modal : {}),
    commitSha: typeof modal?.commitSha === "string" ? modal.commitSha : null,
  };
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
  groups = null,
}) {
  const selectedIds = selectedRowIds instanceof Set ? selectedRowIds : new Set();
  if (groups) {
    const selectedGroups = groups.filter((members) => selectedIds.has(members[0].rowId));
    const memberIds = new Set(selectedGroups.flat().map((row) => row.rowId));
    const plan = buildEditorBatchReplaceUpdates({ rows, selectedRowIds: memberIds, visibleLanguageCodes, searchQuery, replaceText, caseSensitive });
    const updates = new Map(plan.updatedRows.map((row) => [row.rowId, row]));
    for (const members of selectedGroups) {
      for (const code of visibleLanguageCodes) {
        const original = members.map((row) => row.fields?.[code] ?? "");
        const parts = replaceSrtFragmentTexts(original, code, searchQuery, replaceText, caseSensitive);
        for (const [index, row] of members.entries()) {
          if (parts[index] === original[index]) continue;
          const update = updates.get(row.rowId) ?? { rowId: row.rowId, fields: cloneRowFields(row.fields), footnotes: cloneRowFootnotes(row.footnotes), imageCaptions: cloneRowFields(row.imageCaptions) };
          update.fields[code] = parts[index];
          update.baseFields = cloneRowFields(row.persistedFields ?? row.fields);
          updates.set(row.rowId, update);
        }
      }
    }
    const updatedRows = rows.filter((row) => updates.has(row.rowId)).map((row) => updates.get(row.rowId));
    return { matchingSelectedRowIds: selectedGroups.map((members) => members[0].rowId), updatedRows, updatedRowIds: updatedRows.map((row) => row.rowId) };
  }
  const visibleCodes = visibleLanguageCodes instanceof Set ? visibleLanguageCodes : new Set();
  const updatedRows = [];
  const matchingSelectedRowIds = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const rowId = typeof row?.rowId === "string" ? row.rowId : "";
    if (!rowId || !selectedIds.has(rowId) || row?.lifecycleState === "deleted") {
      continue;
    }

    const currentFields = cloneRowFields(row.fields);
    const currentFootnotes = cloneRowFootnotes(row.footnotes);
    const currentImageCaptions = cloneRowFields(row.imageCaptions);
    let matched = false;
    let changed = false;
    const nextFields = cloneRowFields(currentFields);
    const nextFootnotes = cloneRowFootnotes(currentFootnotes);

    for (const languageCode of visibleCodes) {
      const currentText = normalizeString(currentFields[languageCode] ?? "");
      const matches = findEditorSearchMatches(currentText, searchQuery, languageCode, {
        caseSensitive,
      });
      const currentFootnoteEntries = currentFootnotes[languageCode] ?? [];
      const footnoteMatches = currentFootnoteEntries.flatMap((entry, index) =>
        findEditorSearchMatches(entry.text, searchQuery, languageCode, {
          caseSensitive,
        }).map((match) => ({ ...match, footnoteIndex: index })),
      );
      if (matches.length === 0 && footnoteMatches.length === 0) {
        continue;
      }

      if (matches.length > 0) {
        matched = true;
        const nextText = applyEditorSearchReplace(currentText, searchQuery, replaceText, languageCode, {
          caseSensitive,
        });
        if (nextText !== currentText) {
          nextFields[languageCode] = nextText;
          changed = true;
        }
      }

      if (footnoteMatches.length > 0) {
        matched = true;
        const nextFootnoteEntries = currentFootnoteEntries.map((entry) => ({
          ...entry,
          text: applyEditorSearchReplace(entry.text, searchQuery, replaceText, languageCode, {
            caseSensitive,
          }),
        }));
        if (nextFootnoteEntries.some((entry, index) => entry.text !== currentFootnoteEntries[index]?.text)) {
          nextFootnotes[languageCode] = nextFootnoteEntries;
          changed = true;
        }
      }
    }

    if (matched) {
      matchingSelectedRowIds.push(rowId);
    }

    if (changed) {
      updatedRows.push({
        rowId,
        fields: nextFields,
        footnotes: nextFootnotes,
        imageCaptions: currentImageCaptions,
      });
    }
  }

  return {
    matchingSelectedRowIds,
    updatedRows,
    updatedRowIds: updatedRows.map((row) => row.rowId),
  };
}

export function currentMatchingEditorReplaceRowIds(chapterState, rowMatchesSearch) {
  if (srtGroupingEnabled(chapterState)) return srtGroupsForChapter(chapterState)
    .filter((members) => members[0].lifecycleState !== "deleted")
    .map((members) => members.length > 1 ? combineSrtRows(members, chapterState.languages, chapterState) : members[0])
    .filter((row) => rowMatchesSearch(row, chapterState)).map((row) => row.rowId);
  return (Array.isArray(chapterState?.rows) ? chapterState.rows : [])
    .filter((row) => row?.lifecycleState !== "deleted")
    .filter((row) => rowMatchesSearch(row, chapterState))
    .map((row) => row.rowId)
    .filter(Boolean);
}

export function selectedMatchingEditorReplaceRowIds(chapterState, rowMatchesSearch) {
  const replaceState = normalizeEditorReplaceState(chapterState?.replace);
  if (!replaceState.enabled) {
    return [];
  }

  const matchingRowIds = new Set(currentMatchingEditorReplaceRowIds(chapterState, rowMatchesSearch));
  return [...replaceState.selectedRowIds].filter((rowId) => matchingRowIds.has(rowId));
}

export function updateEditorReplaceState(appState, nextValue) {
  if (!appState?.editorChapter?.chapterId) {
    return;
  }

  const currentReplaceState = normalizeEditorReplaceState(appState.editorChapter?.replace);
  appState.editorChapter = {
    ...appState.editorChapter,
    replace:
      typeof nextValue === "function"
        ? normalizeEditorReplaceState(nextValue(currentReplaceState))
        : normalizeEditorReplaceState(nextValue),
  };
}

export function formatReplaceRowCount(rowCount) {
  return rowCount === 1 ? "1 row" : `${rowCount} rows`;
}

export function summarizeReplaceSearchQuery(searchQuery, maxLength = 36) {
  const text = String(searchQuery ?? "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

export function buildEditorReplaceResetCommitMessage(rowCount) {
  return `Create reset point before replace in ${formatReplaceRowCount(rowCount)}`;
}

export function buildEditorReplaceCommitMessage(searchQuery, rowCount) {
  const queryLabel = summarizeReplaceSearchQuery(searchQuery);
  return `Replace "${queryLabel}" in ${formatReplaceRowCount(rowCount)}`;
}

export function buildEditorReplaceUndoNotice(updatedCount, skippedCount) {
  const updatedLabel = formatReplaceRowCount(updatedCount);
  const skippedLabel = formatReplaceRowCount(skippedCount);
  if (updatedCount > 0 && skippedCount > 0) {
    return `Undid replace in ${updatedLabel}. ${skippedLabel} ${skippedCount === 1 ? "was" : "were"} left unchanged because ${skippedCount === 1 ? "it was" : "they were"} edited later.`;
  }
  if (updatedCount > 0) {
    return `Undid replace in ${updatedLabel}.`;
  }
  if (skippedCount === 0) {
    return "No rows needed to be undone.";
  }
  return `No rows were undone. ${skippedLabel} ${skippedCount === 1 ? "was" : "were"} edited later and left unchanged.`;
}
