import { historyEntryCanUndoReplace, reconcileExpandedEditorHistoryGroupKeys } from "./editor-history.js";
import {
  cloneRowFields,
  cloneRowFieldStates,
  cloneRowImages,
  normalizeFieldState,
  normalizeEditorFieldImage,
} from "./editor-utils.js";
import {
  createEditorHistoryState,
  createEditorReplaceUndoModalState,
} from "./state.js";

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

export function buildEditorHistoryRequestKey(chapterId, rowId, languageCode) {
  if (!chapterId || !rowId || !languageCode) {
    return null;
  }

  return `${chapterId}:${rowId}:${languageCode}`;
}

export function currentEditorHistoryRequestMatches(
  chapterState,
  chapterId,
  rowId,
  languageCode,
  requestKey,
) {
  return (
    chapterState?.chapterId === chapterId
    && chapterState.activeRowId === rowId
    && chapterState.activeLanguageCode === languageCode
    && chapterState.history?.requestKey === requestKey
  );
}

export function applyActiveEditorFieldHistoryLoading(chapterState) {
  if (!chapterState?.chapterId || !chapterState.activeRowId || !chapterState.activeLanguageCode) {
    return chapterState;
  }

  const history = currentEditorHistoryForSelection(
    chapterState,
    chapterState.activeRowId,
    chapterState.activeLanguageCode,
  );

  return {
    ...chapterState,
    history: {
      ...normalizeEditorHistoryState(history),
      status: "loading",
      error: "",
      rowId: chapterState.activeRowId,
      languageCode: chapterState.activeLanguageCode,
      requestKey: buildEditorHistoryRequestKey(
        chapterState.chapterId,
        chapterState.activeRowId,
        chapterState.activeLanguageCode,
      ),
      restoringCommitSha: null,
      expandedGroupKeys: cloneExpandedHistoryGroupKeys(history.expandedGroupKeys),
    },
  };
}

export function applyActiveEditorFieldHistoryLoaded(
  chapterState,
  rowId,
  languageCode,
  requestKey,
  entries,
) {
  if (!chapterState?.chapterId || !rowId || !languageCode) {
    return chapterState;
  }

  const previousHistory = normalizeEditorHistoryState(chapterState.history);
  const nextEntries = Array.isArray(entries) ? entries : [];

  return {
    ...chapterState,
    history: {
      status: "ready",
      error: "",
      rowId,
      languageCode,
      requestKey,
      restoringCommitSha: null,
      expandedGroupKeys: reconcileExpandedEditorHistoryGroupKeys(
        previousHistory.entries,
        nextEntries,
        previousHistory.expandedGroupKeys,
      ),
      entries: nextEntries,
    },
  };
}

export function applyActiveEditorFieldHistoryLoadFailed(
  chapterState,
  rowId,
  languageCode,
  requestKey,
  message = "",
) {
  if (!chapterState?.chapterId || !rowId || !languageCode) {
    return chapterState;
  }

  return {
    ...chapterState,
    history: {
      ...normalizeEditorHistoryState(chapterState.history),
      status: "error",
      error: message,
      rowId,
      languageCode,
      requestKey,
      restoringCommitSha: null,
      expandedGroupKeys: cloneExpandedHistoryGroupKeys(chapterState.history?.expandedGroupKeys),
    },
  };
}

export function applyEditorHistoryGroupExpandedToggle(chapterState, groupKey) {
  if (!groupKey || !chapterState?.chapterId) {
    return chapterState;
  }

  const history = normalizeEditorHistoryState(chapterState.history);
  const expandedGroupKeys = cloneExpandedHistoryGroupKeys(history.expandedGroupKeys);
  if (expandedGroupKeys.has(groupKey)) {
    expandedGroupKeys.delete(groupKey);
  } else {
    expandedGroupKeys.add(groupKey);
  }

  return {
    ...chapterState,
    history: {
      ...history,
      expandedGroupKeys,
    },
  };
}

export function currentActiveEditorHistoryEntryByCommitSha(chapterState, commitSha) {
  if (!commitSha || !chapterState?.activeRowId || !chapterState?.activeLanguageCode) {
    return null;
  }

  const history = currentEditorHistoryForSelection(
    chapterState,
    chapterState.activeRowId,
    chapterState.activeLanguageCode,
  );
  return history.entries.find((entry) => entry?.commitSha === commitSha) ?? null;
}

export function openEditorReplaceUndoModalState(chapterState, commitSha) {
  if (!chapterState?.chapterId || !commitSha) {
    return chapterState;
  }

  return {
    ...chapterState,
    replaceUndoModal: {
      ...createEditorReplaceUndoModalState(),
      isOpen: true,
      status: "idle",
      error: "",
      commitSha,
    },
  };
}

export function cancelEditorReplaceUndoModalState(chapterState) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    replaceUndoModal: createEditorReplaceUndoModalState(),
  };
}

export function applyEditorReplaceUndoModalLoading(chapterState) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    replaceUndoModal: {
      ...chapterState.replaceUndoModal,
      status: "loading",
      error: "",
    },
  };
}

export function applyEditorReplaceUndoModalError(chapterState, message = "") {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    replaceUndoModal: {
      ...createEditorReplaceUndoModalState(),
      ...(chapterState.replaceUndoModal && typeof chapterState.replaceUndoModal === "object"
        ? chapterState.replaceUndoModal
        : {}),
      status: "idle",
      error: message,
    },
  };
}

export function applyEditorHistoryRestoreRequested(chapterState, commitSha) {
  if (!chapterState?.chapterId || !chapterState.activeRowId || !chapterState.activeLanguageCode) {
    return chapterState;
  }

  return {
    ...chapterState,
    history: {
      ...currentEditorHistoryForSelection(
        chapterState,
        chapterState.activeRowId,
        chapterState.activeLanguageCode,
      ),
      status: "restoring",
      error: "",
      rowId: chapterState.activeRowId,
      languageCode: chapterState.activeLanguageCode,
      requestKey: buildEditorHistoryRequestKey(
        chapterState.chapterId,
        chapterState.activeRowId,
        chapterState.activeLanguageCode,
      ),
      restoringCommitSha: commitSha,
    },
  };
}

export function applyEditorHistoryRestoreSucceeded(chapterState) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    history: {
      ...normalizeEditorHistoryState(chapterState.history),
      status: "idle",
      error: "",
      restoringCommitSha: null,
    },
  };
}

export function applyEditorHistoryRestoreFailed(chapterState) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    history: {
      ...normalizeEditorHistoryState(chapterState.history),
      status: "ready",
      error: "",
      restoringCommitSha: null,
    },
  };
}

export function applyEditorRowHistoryRestored(row, languageCode, payload) {
  if (!row || !languageCode) {
    return row;
  }

  const nextValue = payload?.plainText ?? "";
  const nextFootnote = payload?.footnote ?? "";
  const nextImage = normalizeEditorFieldImage(payload?.image);
  const nextTextStyle =
    typeof payload?.textStyle === "string" && payload.textStyle.trim()
      ? payload.textStyle
      : row.textStyle;
  const nextFieldState = normalizeFieldState({
    reviewed: payload?.reviewed,
    pleaseCheck: payload?.pleaseCheck,
  });
  const nextImages = cloneRowImages(row.images);
  const nextPersistedImages = cloneRowImages(row.persistedImages);
  if (nextImage) {
    nextImages[languageCode] = nextImage;
    nextPersistedImages[languageCode] = nextImage;
  } else {
    delete nextImages[languageCode];
    delete nextPersistedImages[languageCode];
  }

  return {
    ...row,
    textStyle: nextTextStyle,
    fields: {
      ...cloneRowFields(row.fields),
      [languageCode]: nextValue,
    },
    footnotes: {
      ...cloneRowFields(row.footnotes),
      [languageCode]: nextFootnote,
    },
    images: nextImages,
    fieldStates: {
      ...cloneRowFieldStates(row.fieldStates),
      [languageCode]: nextFieldState,
    },
    persistedFields: {
      ...cloneRowFields(row.persistedFields),
      [languageCode]: nextValue,
    },
    persistedFootnotes: {
      ...cloneRowFields(row.persistedFootnotes),
      [languageCode]: nextFootnote,
    },
    persistedImages: nextPersistedImages,
    persistedFieldStates: {
      ...cloneRowFieldStates(row.persistedFieldStates),
      [languageCode]: nextFieldState,
    },
    saveStatus: "idle",
    saveError: "",
  };
}

export function historyEntryCanOpenReplaceUndo(chapterState, commitSha) {
  return historyEntryCanUndoReplace(currentActiveEditorHistoryEntryByCommitSha(chapterState, commitSha));
}
