import { historyEntryCanUndoReplace, reconcileExpandedEditorHistoryGroupKeys } from "./editor-history.js";
import {
  cloneRowFields,
  cloneRowFieldStates,
  cloneRowImages,
  editorFootnotesPlainText,
  normalizeFieldState,
  normalizeEditorFieldImage,
} from "./editor-utils.js";
import { normalizeEditorRowTextStyle } from "./editor-row-text-style.js";
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
  const optimisticEntries = previousHistory.entries.filter((entry) => entry?.optimistic === true);
  const mergedEntries = [
    ...optimisticEntries,
    ...nextEntries.filter((entry) =>
      !optimisticEntries.some((optimisticEntry) => optimisticEntry.commitSha === entry?.commitSha),
    ),
  ];

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
        mergedEntries,
        previousHistory.expandedGroupKeys,
      ),
      entries: mergedEntries,
    },
  };
}

export function createOptimisticEditorHistoryEntryFromRow(row, languageCode, options = {}) {
  if (!row || !languageCode || !options?.operationId) {
    return null;
  }

  const fieldStates = cloneRowFieldStates(row.fieldStates);
  const fieldState = normalizeFieldState(fieldStates[languageCode]);

  return {
    commitSha: `optimistic:${options.operationId}`,
    optimistic: true,
    operationId: options.operationId,
    coalesceKey: typeof options.coalesceKey === "string" ? options.coalesceKey : "",
    authorName: "Pending local save",
    authorEmail: "",
    authorLogin: "",
    committedAt: options.committedAt ?? new Date().toISOString(),
    message: options.message ?? "Pending local save",
    operationType: typeof options.operationType === "string" ? options.operationType : "editor-update",
    statusNote: typeof options.statusNote === "string" ? options.statusNote : null,
    aiModel: typeof options.aiModel === "string" ? options.aiModel : null,
    plainText: String(row.fields?.[languageCode] ?? ""),
    footnote: editorFootnotesPlainText(row.footnotes?.[languageCode]),
    imageCaption: String(row.imageCaptions?.[languageCode] ?? ""),
    image: normalizeEditorFieldImage(row.images?.[languageCode]),
    textStyle: normalizeEditorRowTextStyle(row.textStyle),
    reviewed: fieldState.reviewed,
    pleaseCheck: fieldState.pleaseCheck,
  };
}

function historySelectionMatches(chapterState, rowId, languageCode) {
  return (
    chapterState?.chapterId
    && chapterState.activeRowId === rowId
    && chapterState.activeLanguageCode === languageCode
  );
}

export function applyOptimisticEditorHistoryEntry(chapterState, rowId, languageCode, entry) {
  if (!historySelectionMatches(chapterState, rowId, languageCode) || !entry?.commitSha) {
    return chapterState;
  }

  const history = currentEditorHistoryForSelection(chapterState, rowId, languageCode);
  const nextEntries = history.entries.filter((candidate) => {
    if (candidate?.optimistic !== true) {
      return true;
    }
    if (entry.coalesceKey && candidate.coalesceKey === entry.coalesceKey) {
      return false;
    }
    return candidate.operationId !== entry.operationId;
  });

  return {
    ...chapterState,
    history: {
      ...normalizeEditorHistoryState(history),
      status: history.status === "idle" ? "ready" : history.status,
      error: "",
      rowId,
      languageCode,
      requestKey: buildEditorHistoryRequestKey(chapterState.chapterId, rowId, languageCode),
      entries: [entry, ...nextEntries],
    },
  };
}

export function removeOptimisticEditorHistoryEntry(chapterState, operationId) {
  if (!chapterState?.chapterId || !operationId) {
    return chapterState;
  }

  const history = normalizeEditorHistoryState(chapterState.history);
  const nextEntries = history.entries.filter((entry) => entry?.operationId !== operationId);
  if (nextEntries.length === history.entries.length) {
    return chapterState;
  }

  return {
    ...chapterState,
    history: {
      ...history,
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
  const nextImageCaption = payload?.imageCaption ?? "";
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
    imageCaptions: {
      ...cloneRowFields(row.imageCaptions),
      [languageCode]: nextImageCaption,
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
    persistedImageCaptions: {
      ...cloneRowFields(row.persistedImageCaptions),
      [languageCode]: nextImageCaption,
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

function historyImageKey(image) {
  return JSON.stringify(normalizeEditorFieldImage(image) ?? null);
}

export function editorRowMatchesHistoryPayload(row, languageCode, payload) {
  if (!row || !languageCode) {
    return false;
  }

  const expectedFieldState = normalizeFieldState({
    reviewed: payload?.reviewed,
    pleaseCheck: payload?.pleaseCheck,
  });
  const currentFieldState = normalizeFieldState(row.fieldStates?.[languageCode]);
  const expectedTextStyle =
    typeof payload?.textStyle === "string" && payload.textStyle.trim()
      ? payload.textStyle
      : row.textStyle;

  return (
    String(row.fields?.[languageCode] ?? "") === String(payload?.plainText ?? "")
    && editorFootnotesPlainText(row.footnotes?.[languageCode]) === String(payload?.footnote ?? "")
    && String(row.imageCaptions?.[languageCode] ?? "") === String(payload?.imageCaption ?? "")
    && historyImageKey(row.images?.[languageCode]) === historyImageKey(payload?.image)
    && String(row.textStyle ?? "") === String(expectedTextStyle ?? "")
    && currentFieldState.reviewed === expectedFieldState.reviewed
    && currentFieldState.pleaseCheck === expectedFieldState.pleaseCheck
  );
}

export function historyEntryCanOpenReplaceUndo(chapterState, commitSha) {
  return historyEntryCanUndoReplace(currentActiveEditorHistoryEntryByCommitSha(chapterState, commitSha));
}
