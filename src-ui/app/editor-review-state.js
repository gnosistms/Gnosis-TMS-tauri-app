import { cloneDirtyRowIds } from "./editor-row-persistence-model.js";
import {
  cloneRowFieldStates,
  hasEditorLanguage,
  normalizeFieldState,
} from "./editor-utils.js";
import { createEditorUnreviewAllModalState } from "./state.js";

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

function chapterRows(chapterState) {
  return Array.isArray(chapterState?.rows) ? chapterState.rows : [];
}

function normalizedRowIdSet(rowIds) {
  return new Set((Array.isArray(rowIds) ? rowIds : []).filter(Boolean));
}

function rowReviewedFlag(row, statesKey, languageCode) {
  return normalizeFieldState(row?.[statesKey]?.[languageCode]).reviewed;
}

function withRowReviewedFlag(row, statesKey, languageCode, reviewed) {
  if (rowReviewedFlag(row, statesKey, languageCode) === reviewed) {
    return row;
  }

  return {
    ...row,
    [statesKey]: {
      ...cloneRowFieldStates(row?.[statesKey]),
      [languageCode]: {
        ...normalizeFieldState(row?.[statesKey]?.[languageCode]),
        reviewed,
      },
    },
  };
}

// A single-row reviewed toggle the user made after "Unreview all" was queued.
// The repo write queue runs operations in order, so it lands after the batch and
// its optimistic value must survive the batch settling.
function rowHasLaterReviewedToggle(row, languageCode) {
  const markerSaveState = row?.markerSaveState;
  return (
    markerSaveState?.status === "saving"
    && markerSaveState.kind === "reviewed"
    && markerSaveState.languageCode === languageCode
  );
}

export function editorChapterReviewedRowIds(chapterState, languageCode) {
  if (!chapterState?.chapterId || !hasEditorLanguage(chapterState, languageCode)) {
    return [];
  }

  return chapterRows(chapterState)
    .filter((row) => row?.rowId && rowReviewedFlag(row, "fieldStates", languageCode))
    .map((row) => row.rowId);
}

// Optimistic half of "Unreview all": the markers turn off and the modal closes as
// soon as the user confirms, while the batch commit waits its turn in the repo
// write queue (often behind a background GitHub sync). Persisted states stay
// untouched, so these rows read as dirty until the commit settles.
export function applyEditorChapterRowsUnreviewing(chapterState, languageCode, rowIds = []) {
  if (!chapterState?.chapterId || !hasEditorLanguage(chapterState, languageCode)) {
    return chapterState;
  }

  const targetRowIds = normalizedRowIdSet(rowIds);
  return {
    ...chapterState,
    rows: chapterRows(chapterState).map((row) =>
      targetRowIds.has(row?.rowId)
        ? withRowReviewedFlag(row, "fieldStates", languageCode, false)
        : row
    ),
    unreviewAllModal: createEditorUnreviewAllModalState(),
  };
}

// Commit half: the backend clears the marker in every row file of the chapter,
// soft-deleted rows included, so every row's persisted state is now unreviewed.
// The visible state follows except where a later reviewed toggle is still queued.
export function applyEditorChapterRowsUnreviewed(chapterState, languageCode) {
  if (!chapterState?.chapterId || !hasEditorLanguage(chapterState, languageCode)) {
    return chapterState;
  }

  return {
    ...chapterState,
    rows: chapterRows(chapterState).map((row) => {
      if (!row?.rowId) {
        return row;
      }

      const persistedRow = withRowReviewedFlag(row, "persistedFieldStates", languageCode, false);
      return rowHasLaterReviewedToggle(row, languageCode)
        ? persistedRow
        : withRowReviewedFlag(persistedRow, "fieldStates", languageCode, false);
    }),
    dirtyRowIds: cloneDirtyRowIds(chapterState.dirtyRowIds),
  };
}

// Failure half: nothing was written, so each row the batch turned off goes back
// to its persisted marker, unless the user has toggled it again since.
export function restoreEditorChapterRowsUnreviewing(chapterState, languageCode, rowIds = []) {
  if (!chapterState?.chapterId || !hasEditorLanguage(chapterState, languageCode)) {
    return chapterState;
  }

  const targetRowIds = normalizedRowIdSet(rowIds);
  return {
    ...chapterState,
    rows: chapterRows(chapterState).map((row) =>
      targetRowIds.has(row?.rowId) && !rowHasLaterReviewedToggle(row, languageCode)
        ? withRowReviewedFlag(
          row,
          "fieldStates",
          languageCode,
          rowReviewedFlag(row, "persistedFieldStates", languageCode),
        )
        : row
    ),
  };
}
