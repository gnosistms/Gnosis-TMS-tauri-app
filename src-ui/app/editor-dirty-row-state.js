import {
  cloneDirtyRowIds,
  reconcileDirtyRowIds,
  resolveDirtyTrackedEditorRowIds,
} from "./editor-row-persistence-model.js";
import { state } from "./state.js";

export function compactDirtyRowIds(rows, dirtyRowIds) {
  const validRowIds = new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => row?.rowId)
      .filter(Boolean),
  );

  return new Set(
    [...cloneDirtyRowIds(dirtyRowIds)].filter((rowId) => validRowIds.has(rowId)),
  );
}

function setEditorDirtyRowIds(dirtyRowIds) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    dirtyRowIds,
  };
}

export function markEditorRowDirty(rowId) {
  if (!rowId || !state.editorChapter?.chapterId) {
    return;
  }

  const dirtyRowIds = cloneDirtyRowIds(state.editorChapter.dirtyRowIds);
  if (dirtyRowIds.has(rowId)) {
    return;
  }

  dirtyRowIds.add(rowId);
  setEditorDirtyRowIds(dirtyRowIds);
}

export function reconcileDirtyTrackedEditorRows(rowIds = null) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const currentDirtyRowIds = cloneDirtyRowIds(state.editorChapter.dirtyRowIds);
  const nextDirtyRowIds = reconcileDirtyRowIds(
    state.editorChapter.rows,
    currentDirtyRowIds,
    rowIds,
  );
  const dirtyRowIdsChanged =
    nextDirtyRowIds.size !== currentDirtyRowIds.size
    || [...nextDirtyRowIds].some((rowId) => !currentDirtyRowIds.has(rowId));
  if (dirtyRowIdsChanged) {
    setEditorDirtyRowIds(nextDirtyRowIds);
  }
}
