import { createEditorHistoryState } from "./state.js";

export function cloneExpandedHistoryGroupKeys(expandedGroupKeys) {
  return expandedGroupKeys instanceof Set
    ? new Set(expandedGroupKeys)
    : new Set();
}

export function normalizeEditorHistoryState(history) {
  return {
    ...createEditorHistoryState(),
    ...(history && typeof history === "object" ? history : {}),
    rowId: typeof history?.rowId === "string" ? history.rowId : null,
    languageCode: typeof history?.languageCode === "string" ? history.languageCode : null,
    requestKey: typeof history?.requestKey === "string" ? history.requestKey : null,
    restoringCommitSha:
      typeof history?.restoringCommitSha === "string" ? history.restoringCommitSha : null,
    expandedGroupKeys: cloneExpandedHistoryGroupKeys(history?.expandedGroupKeys),
    entries: Array.isArray(history?.entries) ? history.entries : [],
  };
}

export function currentEditorHistoryForSelection(chapterState, rowId, languageCode) {
  const history = normalizeEditorHistoryState(chapterState?.history);
  if (history.rowId === rowId && history.languageCode === languageCode) {
    return history;
  }

  return createEditorHistoryState();
}
