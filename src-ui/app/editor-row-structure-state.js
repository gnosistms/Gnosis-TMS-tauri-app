import {
  deletedRowGroupIdAfterSoftDelete,
  deletedRowGroupIdFromRange,
  expandedDeletedRowGroupIdsAfterPermanentDelete,
  expandedDeletedRowGroupIdsAfterRestore,
  expandedDeletedRowGroupIdsAfterSoftDelete,
} from "./editor-deleted-rows.js";
import { compactDirtyRowIds } from "./editor-dirty-row-state.js";
import { normalizeEditorRows } from "./editor-state-flow.js";
import { hasEditorRow } from "./editor-utils.js";
import {
  createEditorMainFieldEditorState,
  createEditorPendingSelectionState,
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
    mainFieldEditor: createEditorMainFieldEditorState(),
    pendingSelection: createEditorPendingSelectionState(),
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

function normalizeLocalLifecycleRow(row, lifecycleState) {
  if (!row) {
    return row;
  }

  return {
    ...row,
    lifecycleState,
    freshness: "fresh",
    remotelyDeleted: false,
    saveStatus: "idle",
    saveError: "",
    conflictState: null,
  };
}

function rowsWithLifecycleState(rows, rowId, lifecycleState) {
  return (Array.isArray(rows) ? rows : []).map((row) =>
    row?.rowId === rowId
      ? normalizeLocalLifecycleRow(row, lifecycleState)
      : row
  );
}

function rowsWithoutRowId(rows, rowId) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.rowId !== rowId);
}

function resolveAnchorOffsetTop(triggerAnchorSnapshot, fallback = 80) {
  const nextOffsetTop = Number(triggerAnchorSnapshot?.offsetTop);
  return Number.isFinite(nextOffsetTop) ? nextOffsetTop : fallback;
}

function deletedRowGroupBounds(rows, rowId) {
  const items = Array.isArray(rows) ? rows : [];
  const rowIndex = items.findIndex((row) => row?.rowId === rowId);
  if (rowIndex < 0 || items[rowIndex]?.lifecycleState !== "deleted") {
    return null;
  }

  let startIndex = rowIndex;
  let endIndex = rowIndex;
  while (startIndex > 0 && items[startIndex - 1]?.lifecycleState === "deleted") {
    startIndex -= 1;
  }
  while (endIndex + 1 < items.length && items[endIndex + 1]?.lifecycleState === "deleted") {
    endIndex += 1;
  }

  return { startIndex, endIndex };
}

function buildVisibleAnchorSnapshot(rows, rowId, expandedDeletedRowGroupIds, offsetTop) {
  if (!rowId) {
    return null;
  }

  const items = Array.isArray(rows) ? rows : [];
  const targetRow = items.find((row) => row?.rowId === rowId);
  if (!targetRow) {
    return null;
  }

  if (targetRow.lifecycleState !== "deleted") {
    return {
      type: "row",
      rowId,
      languageCode: null,
      offsetTop,
    };
  }

  const bounds = deletedRowGroupBounds(items, rowId);
  if (!bounds) {
    return {
      type: "row",
      rowId,
      languageCode: null,
      offsetTop,
    };
  }

  const groupId = deletedRowGroupIdFromRange(items, bounds.startIndex, bounds.endIndex);
  if (!groupId) {
    return {
      type: "row",
      rowId,
      languageCode: null,
      offsetTop,
    };
  }

  const normalizedExpandedDeletedRowGroupIds =
    expandedDeletedRowGroupIds instanceof Set
      ? expandedDeletedRowGroupIds
      : new Set();
  if (normalizedExpandedDeletedRowGroupIds.has(groupId)) {
    return {
      type: "row",
      rowId,
      languageCode: null,
      offsetTop,
    };
  }

  return {
    type: "deleted-group",
    rowId: `deleted-group:${groupId}`,
    languageCode: null,
    offsetTop,
  };
}

function nearestSurvivingAnchorRowId(previousRows, nextRows, rowId) {
  const previousItems = Array.isArray(previousRows) ? previousRows : [];
  const nextItems = Array.isArray(nextRows) ? nextRows : [];
  const previousRowIndex = previousItems.findIndex((row) => row?.rowId === rowId);
  if (previousRowIndex < 0) {
    return nextItems[0]?.rowId ?? null;
  }

  if (previousRowIndex < nextItems.length && nextItems[previousRowIndex]?.rowId) {
    return nextItems[previousRowIndex].rowId;
  }

  if (previousRowIndex > 0 && nextItems[previousRowIndex - 1]?.rowId) {
    return nextItems[previousRowIndex - 1].rowId;
  }

  return nextItems[0]?.rowId ?? null;
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
  const offsetTop = resolveAnchorOffsetTop(triggerAnchorSnapshot);
  const anchorSnapshot =
    buildVisibleAnchorSnapshot(rows, rowId, expandedDeletedRowGroupIds, offsetTop)
    ?? (nextDeletedGroupId && !nextDeletedGroupIsOpen
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
      });

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
  const expandedDeletedRowGroupIds = expandedDeletedRowGroupIdsAfterRestore(
    previousRows,
    rowId,
    chapterState.expandedDeletedRowGroupIds,
    rows,
  );
  const offsetTop = resolveAnchorOffsetTop(triggerAnchorSnapshot);

  return {
    chapterState: {
      ...chapterState,
      rows,
      expandedDeletedRowGroupIds,
      sourceWordCounts: resolveSourceWordCounts(chapterState, sourceWordCounts),
    },
    anchorSnapshot: buildVisibleAnchorSnapshot(
      rows,
      rowId,
      expandedDeletedRowGroupIds,
      offsetTop,
    ),
  };
}

export function applyPermanentlyDeletedEditorRowState(
  chapterState,
  rowId,
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
  const rows = rowsWithoutRowId(previousRows, rowId);
  const expandedDeletedRowGroupIds = expandedDeletedRowGroupIdsAfterPermanentDelete(
    previousRows,
    rowId,
    chapterState.expandedDeletedRowGroupIds,
    rows,
  );
  const nextChapterState = withClearedActiveFieldForRow(chapterState, rowId);
  const offsetTop = resolveAnchorOffsetTop(triggerAnchorSnapshot);
  const anchorRowId = nearestSurvivingAnchorRowId(previousRows, rows, rowId);

  return {
    chapterState: {
      ...nextChapterState,
      rows,
      dirtyRowIds: compactDirtyRowIds(rows, chapterState.dirtyRowIds),
      expandedDeletedRowGroupIds,
      sourceWordCounts: resolveSourceWordCounts(chapterState, sourceWordCounts),
      rowPermanentDeletionModal: createEditorRowPermanentDeletionModalState(),
    },
    anchorSnapshot: buildVisibleAnchorSnapshot(
      rows,
      anchorRowId,
      expandedDeletedRowGroupIds,
      offsetTop,
    ),
  };
}
