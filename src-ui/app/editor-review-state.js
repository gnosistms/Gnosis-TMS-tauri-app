import { cloneDirtyRowIds } from "./editor-row-persistence-model.js";
import {
  cloneRowFieldStates,
  hasEditorLanguage,
  normalizeFieldState,
} from "./editor-utils.js";
import { createEditorUnreviewAllModalState } from "./state.js";

function idleMarkerSaveState() {
  return {
    status: "idle",
    languageCode: null,
    kind: null,
    error: "",
  };
}

export function openEditorUnreviewAllModalState(chapterState, languageCode) {
  if (!chapterState?.chapterId || !hasEditorLanguage(chapterState, languageCode)) {
    return chapterState;
  }

  return {
    ...chapterState,
    unreviewAllModal: {
      ...createEditorUnreviewAllModalState(),
      isOpen: true,
      languageCode,
    },
  };
}

export function cancelEditorUnreviewAllModalState(chapterState) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    unreviewAllModal: createEditorUnreviewAllModalState(),
  };
}

export function applyEditorChapterRowsUnreviewed(chapterState, languageCode, rowIds = []) {
  if (!chapterState?.chapterId || !hasEditorLanguage(chapterState, languageCode)) {
    return chapterState;
  }

  const changedRowIds = new Set((Array.isArray(rowIds) ? rowIds : []).filter(Boolean));

  return {
    ...chapterState,
    rows: (Array.isArray(chapterState.rows) ? chapterState.rows : []).map((row) => {
      if (!changedRowIds.has(row?.rowId)) {
        return row;
      }

      const nextFieldState = {
        ...normalizeFieldState(row?.fieldStates?.[languageCode]),
        reviewed: false,
      };
      const nextPersistedFieldState = {
        ...normalizeFieldState(row?.persistedFieldStates?.[languageCode]),
        reviewed: false,
      };

      return {
        ...row,
        fieldStates: {
          ...cloneRowFieldStates(row?.fieldStates),
          [languageCode]: nextFieldState,
        },
        persistedFieldStates: {
          ...cloneRowFieldStates(row?.persistedFieldStates),
          [languageCode]: nextPersistedFieldState,
        },
        markerSaveState: idleMarkerSaveState(),
      };
    }),
    dirtyRowIds: cloneDirtyRowIds(chapterState.dirtyRowIds),
    unreviewAllModal: createEditorUnreviewAllModalState(),
  };
}
