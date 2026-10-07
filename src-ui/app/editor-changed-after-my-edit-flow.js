import {
  EDITOR_ROW_FILTER_MODE_CHANGED_AFTER_MY_EDIT,
  normalizeEditorChapterFilterState,
} from "./editor-filters.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";

// State for the "Changed after my last edit" filter:
//   { chapterId, status: "loading" | "ready" | "error", error, rowIds: Set, rowsById: Map }
// rowsById holds each row's baseline (the row at my last edit, or as created) from
// load_gtms_editor_changed_after_my_edit.
//
// The row set is a snapshot taken when the filter is turned on: rows stay listed after I
// edit them, until the filter changes. A refresh after a background sync only adds rows.

let latestRequestId = 0;

export function changedAfterMyEditFilterIsActive(editorChapter = state.editorChapter) {
  return normalizeEditorChapterFilterState(editorChapter?.filters).rowFilterMode
    === EDITOR_ROW_FILTER_MODE_CHANGED_AFTER_MY_EDIT;
}

export function changedAfterMyEditStateForChapter(editorChapter) {
  const value = editorChapter?.changedAfterMyEdit;
  return value && value.chapterId === editorChapter?.chapterId ? value : null;
}

export function mergeChangedAfterMyEditRows(previousState, rows, chapterId) {
  const rowIds = new Set(previousState?.rowIds ?? []);
  const rowsById = new Map(previousState?.rowsById ?? []);
  for (const row of Array.isArray(rows) ? rows : []) {
    if (typeof row?.rowId !== "string" || !row.rowId) {
      continue;
    }
    rowIds.add(row.rowId);
    // A row already on screen keeps the baseline it was first shown with.
    if (!rowsById.has(row.rowId)) {
      rowsById.set(row.rowId, row);
    }
  }
  return { chapterId, status: "ready", error: "", rowIds, rowsById };
}

/**
 * Loads the rows changed after my last edit. `merge: false` starts a new snapshot (the
 * filter was just turned on); `merge: true` adds newly qualifying rows to the current
 * one (after a sync brought in other people's commits).
 */
export async function loadChangedAfterMyEditRows(render, { merge = false } = {}) {
  const editorChapter = state.editorChapter;
  const chapterId = editorChapter?.chapterId;
  const team = selectedProjectsTeam();
  const context = findChapterContextById(chapterId);
  if (!chapterId || !Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  const requestId = ++latestRequestId;
  const previousState = merge ? changedAfterMyEditStateForChapter(editorChapter) : null;
  if (!merge) {
    state.editorChapter = {
      ...editorChapter,
      changedAfterMyEdit: {
        chapterId,
        status: "loading",
        error: "",
        rowIds: new Set(),
        rowsById: new Map(),
      },
    };
    render?.({ scope: "translate-body" });
  }

  let nextState;
  try {
    const payload = await invoke("load_gtms_editor_changed_after_my_edit", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId,
      },
    });
    nextState = mergeChangedAfterMyEditRows(previousState, payload?.rows, chapterId);
  } catch (error) {
    if (merge) {
      // Keep showing the current snapshot; the next sync retries.
      return;
    }
    nextState = {
      chapterId,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      rowIds: new Set(),
      rowsById: new Map(),
    };
  }

  if (
    requestId !== latestRequestId
    || state.editorChapter?.chapterId !== chapterId
    || !changedAfterMyEditFilterIsActive(state.editorChapter)
  ) {
    return;
  }
  state.editorChapter = { ...state.editorChapter, changedAfterMyEdit: nextState };
  render?.({ scope: "translate-body" });
}

export function refreshChangedAfterMyEditRowsAfterSync(render, syncPayload) {
  const oldHeadSha = String(syncPayload?.oldHeadSha ?? "").trim();
  const newHeadSha = String(syncPayload?.newHeadSha ?? "").trim();
  if (!newHeadSha || oldHeadSha === newHeadSha || !changedAfterMyEditFilterIsActive()) {
    return;
  }
  void loadChangedAfterMyEditRows(render, { merge: true });
}
