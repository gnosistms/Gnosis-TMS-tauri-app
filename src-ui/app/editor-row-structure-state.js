import {
  deletedRowGroupIdAfterSoftDelete,
  expandedDeletedRowGroupIdsAfterPermanentDelete,
  expandedDeletedRowGroupIdsAfterRestore,
  expandedDeletedRowGroupIdsAfterSoftDelete,
} from "./editor-deleted-rows.js";
import { compactDirtyRowIds } from "./editor-dirty-row-state.js";
import { normalizeEditorRows } from "./editor-state-flow.js";
import { hasEditorRow } from "./editor-utils.js";
import {
  createEditorCommentsState,
  createEditorHistoryState,
  createEditorInsertRowModalState,
  createEditorRowPermanentDeletionModalState,
} from "./state.js";

function resolveSourceWordCounts(chapterState, sourceWordCounts) {
  return sourceWordCounts && typeof sourceWordCounts === "object"
    ? sourceWordCounts
    : chapterState.sourceWordCounts;
}

function cloneExpandedDeletedRowGroupIds(expandedDeletedRowGroupIds) {
  return expandedDeletedRowGroupIds instanceof Set
    ? new Set(expandedDeletedRowGroupIds)
    : new Set();
}

function withClearedActiveFieldForRow(chapterState, rowId) {
  if (chapterState?.activeRowId !== rowId) {
    return chapterState;
  }

  return {
    ...chapterState,
    activeRowId: null,
    activeLanguageCode: null,
    comments: createEditorCommentsState(),
    history: createEditorHistoryState(),
  };
}

function insertEditorRow(rows, nextRow, anchorRowId, insertBefore = true) {
  if (!nextRow?.rowId) {
    return Array.isArray(rows) ? rows : [];
  }

  const normalizedRow = normalizeEditorRows([nextRow])[0];
  const nextRows = Array.isArray(rows) ? [...rows] : [];
  const anchorIndex = nextRows.findIndex((row) => row?.rowId === anchorRowId);
  const insertIndex = anchorIndex < 0
    ? nextRows.length
    : insertBefore
      ? anchorIndex
      : anchorIndex + 1;
  nextRows.splice(insertIndex, 0, normalizedRow);
  return nextRows;
}

function rowsWithLifecycleState(rows, rowId, lifecycleState) {
  return (Array.isArray(rows) ? rows : []).map((row) =>
    row?.rowId === rowId
      ? {
        ...row,
        lifecycleState,
      }
      : row
  );
}

function rowsWithoutRowId(rows, rowId) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.rowId !== rowId);
}

export function toggleDeletedEditorRowGroupState(chapterState, groupId) {
  if (!groupId || !chapterState?.chapterId) {
    return chapterState;
  }

  const expandedDeletedRowGroupIds = cloneExpandedDeletedRowGroupIds(chapterState.expandedDeletedRowGroupIds);
  if (expandedDeletedRowGroupIds.has(groupId)) {
    expandedDeletedRowGroupIds.delete(groupId);
  } else {
    expandedDeletedRowGroupIds.add(groupId);
  }

  return {
    ...chapterState,
    expandedDeletedRowGroupIds,
  };
}

export function openInsertEditorRowModalState(chapterState, rowId) {
  if (!rowId || !hasEditorRow(chapterState, rowId)) {
    return chapterState;
  }

  return {
    ...chapterState,
    insertRowModal: {
      ...createEditorInsertRowModalState(),
      isOpen: true,
      rowId,
    },
  };
}

export function cancelInsertEditorRowModalState(chapterState) {
  return {
    ...chapterState,
    insertRowModal: createEditorInsertRowModalState(),
  };
}

export function openEditorRowPermanentDeletionModalState(chapterState, rowId) {
  if (!rowId || !hasEditorRow(chapterState, rowId)) {
    return chapterState;
  }

  return {
    ...chapterState,
    rowPermanentDeletionModal: {
      ...createEditorRowPermanentDeletionModalState(),
      isOpen: true,
      rowId,
    },
  };
}

export function cancelEditorRowPermanentDeletionModalState(chapterState) {
  return {
    ...chapterState,
    rowPermanentDeletionModal: createEditorRowPermanentDeletionModalState(),
  };
}

export function applyInsertedEditorRowState(
  chapterState,
  nextRow,
  anchorRowId,
  insertBefore = true,
  sourceWordCounts = null,
) {
  if (!chapterState?.chapterId || !nextRow?.rowId) {
    return chapterState;
  }

  return {
    ...chapterState,
    rows: insertEditorRow(chapterState.rows, nextRow, anchorRowId, insertBefore),
    sourceWordCounts: resolveSourceWordCounts(chapterState, sourceWordCounts),
    insertRowModal: createEditorInsertRowModalState(),
    activeRowId: nextRow.rowId ?? chapterState.activeRowId,
    activeLanguageCode:
      chapterState.activeLanguageCode
      ?? chapterState.selectedTargetLanguageCode
      ?? chapterState.selectedSourceLanguageCode
      ?? null,
  };
}

export function applySoftDeletedEditorRowState(
  chapterState,
  rowId,
  lifecycleState = "deleted",
  sourceWordCounts = null,
  triggerAnchorSnapshot = null,
) {
  if (!chapterState?.chapterId || !rowId) {
    return {
      chapterState,
      anchorSnapshot: null,
    };
  }

  const previousRows = Array.isArray(chapterState.rows) ? chapterState.rows : [];
  const rows = rowsWithLifecycleState(previousRows, rowId, lifecycleState);
  const expandedDeletedRowGroupIds = expandedDeletedRowGroupIdsAfterSoftDelete(
    previousRows,
    rowId,
    chapterState.expandedDeletedRowGroupIds,
    rows,
  );
  const nextDeletedGroupId = deletedRowGroupIdAfterSoftDelete(previousRows, rowId);
  const nextDeletedGroupIsOpen =
    typeof nextDeletedGroupId === "string" && expandedDeletedRowGroupIds.has(nextDeletedGroupId);
  const offsetTop = Number.isFinite(Number(triggerAnchorSnapshot?.offsetTop))
    ? Number(triggerAnchorSnapshot.offsetTop)
    : 80;
  const anchorSnapshot = nextDeletedGroupId && !nextDeletedGroupIsOpen
    ? {
      type: "deleted-group",
      rowId: `deleted-group:${nextDeletedGroupId}`,
      languageCode: null,
      offsetTop,
    }
    : {
      type: "row",
      rowId,
      languageCode: null,
      offsetTop,
    };

  return {
    chapterState: {
      ...withClearedActiveFieldForRow(chapterState, rowId),
      rows,
      expandedDeletedRowGroupIds,
      sourceWordCounts: resolveSourceWordCounts(chapterState, sourceWordCounts),
    },
    anchorSnapshot,
  };
}

export function applyRestoredEditorRowState(
  chapterState,
  rowId,
  lifecycleState = "active",
  sourceWordCounts = null,
) {
  if (!chapterState?.chapterId || !rowId) {
    return chapterState;
  }

  const previousRows = Array.isArray(chapterState.rows) ? chapterState.rows : [];
  const rows = rowsWithLifecycleState(previousRows, rowId, lifecycleState);
  const expandedDeletedRowGroupIds = expandedDeletedRowGroupIdsAfterRestore(
    previousRows,
    rowId,
    chapterState.expandedDeletedRowGroupIds,
    rows,
  );

  return {
    ...chapterState,
    rows,
    expandedDeletedRowGroupIds,
    sourceWordCounts: resolveSourceWordCounts(chapterState, sourceWordCounts),
  };
}

export function applyPermanentlyDeletedEditorRowState(chapterState, rowId, sourceWordCounts = null) {
  if (!chapterState?.chapterId || !rowId) {
    return chapterState;
  }

  const previousRows = Array.isArray(chapterState.rows) ? chapterState.rows : [];
  const rows = rowsWithoutRowId(previousRows, rowId);
  const expandedDeletedRowGroupIds = expandedDeletedRowGroupIdsAfterPermanentDelete(
    previousRows,
    rowId,
    chapterState.expandedDeletedRowGroupIds,
    rows,
  );
  const nextChapterState = withClearedActiveFieldForRow(chapterState, rowId);

  return {
    ...nextChapterState,
    rows,
    dirtyRowIds: compactDirtyRowIds(rows, chapterState.dirtyRowIds),
    expandedDeletedRowGroupIds,
    sourceWordCounts: resolveSourceWordCounts(chapterState, sourceWordCounts),
    rowPermanentDeletionModal: createEditorRowPermanentDeletionModalState(),
  };
}
