import { selectedProjectsTeam } from "./project-context.js";
import {
  rowHasFieldChanges,
  rowHasPersistedChanges,
} from "./editor-row-persistence-model.js";
import {
  assertEditorWritePermissionForContext,
  handleEditorPermissionDenied,
} from "./editor-write-permission.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";

const DEBUG_EDITOR_WRITE = false;

export function cloneQueueContextValue(value) {
  if (value == null) {
    return value;
  }
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function queuedEditorWriteTeam(snapshotTeam) {
  const installationId = Number.isFinite(snapshotTeam?.installationId)
    ? snapshotTeam.installationId
    : null;
  const currentTeam = selectedProjectsTeam();
  if (
    installationId !== null
    && Number.isFinite(currentTeam?.installationId)
    && currentTeam.installationId === installationId
  ) {
    return currentTeam;
  }

  return (Array.isArray(state.teams) ? state.teams : []).find(
    (team) => Number.isFinite(team?.installationId) && team.installationId === installationId,
  ) ?? snapshotTeam;
}

export function createQueuedEditorWritePermissionContext({
  team = null,
  project = null,
  chapter = null,
  row = null,
  actionKind = "sharedWrite",
} = {}) {
  return {
    team: cloneQueueContextValue(team),
    project: cloneQueueContextValue(project),
    chapter: cloneQueueContextValue(chapter),
    row: cloneQueueContextValue(row),
    actionKind,
  };
}

export function editorChapterInvalidationKey(repoScope, chapterId) {
  return `editorChapter:${repoScope}:${chapterId}`;
}

function rowHasPendingCommentWrite(rowId, chapterState = state.editorChapter) {
  if (!rowId || !chapterState?.chapterId) {
    return false;
  }

  const comments = chapterState.comments;
  const commentsRowId = typeof comments?.rowId === "string" ? comments.rowId : "";
  return commentsRowId === rowId && (comments?.status === "saving" || comments?.status === "deleting");
}

function rowNeedsRefreshBeforeQueuedWrite(row) {
  return (
    !row
    || row.lifecycleState === "deleted"
    || row?.freshness === "stale"
    || row?.freshness === "staleDirty"
    || row?.freshness === "conflict"
    || row?.saveStatus === "conflict"
    || row?.remotelyDeleted === true
  );
}

function rowHasPendingTextWrite(row) {
  return (
    row?.saveStatus === "dirty"
    || row?.saveStatus === "error"
    || rowHasFieldChanges(row)
  );
}

function rowHasAnyPendingWrite(row, chapterState) {
  return (
    rowHasPendingTextWrite(row)
    || row?.markerSaveState?.status === "saving"
    || row?.textStyleSaveState?.status === "saving"
    || rowHasPersistedChanges(row)
    || rowHasPendingCommentWrite(row?.rowId, chapterState)
  );
}

export function assertQueuedEditorRowsReady({
  chapterId = "",
  rowIds = null,
  includeAllRows = false,
  forbidPendingText = false,
  forbidPendingWrites = false,
  message = "Refresh or resolve the editor rows before continuing.",
} = {}) {
  const chapterState = state.editorChapter;
  if (!chapterId || chapterState?.chapterId !== chapterId) {
    return;
  }

  if (chapterState.deferredStructuralChanges === true) {
    throw new Error(message);
  }

  const normalizedRowIds = Array.isArray(rowIds)
    ? [...new Set(rowIds.map((rowId) => (typeof rowId === "string" ? rowId.trim() : "")).filter(Boolean))]
    : [];
  const rows = includeAllRows
    ? (Array.isArray(chapterState.rows) ? chapterState.rows : [])
    : normalizedRowIds.map((rowId) =>
      (Array.isArray(chapterState.rows) ? chapterState.rows : []).find(
        (row) => row?.rowId === rowId || row?.id === rowId,
      ) ?? null,
    );

  if (rows.some(rowNeedsRefreshBeforeQueuedWrite)) {
    throw new Error(message);
  }

  if (forbidPendingText && rows.some(rowHasPendingTextWrite)) {
    throw new Error(message);
  }

  if (forbidPendingWrites && rows.some((row) => rowHasAnyPendingWrite(row, chapterState))) {
    throw new Error(message);
  }
}

export async function invokeQueuedEditorWriteCommand(command, payload, context, render) {
  const team = queuedEditorWriteTeam(context?.team ?? null);
  const rowId = context?.row?.rowId ?? context?.row?.id ?? payload?.input?.rowId ?? payload?.input?.row_id ?? "";
  const chapterId = context?.chapter?.id ?? payload?.input?.chapterId ?? payload?.input?.chapter_id ?? "";
  try {
    assertEditorWritePermissionForContext({
      team,
      project: context?.project ?? null,
      chapter: context?.chapter ?? null,
      row: context?.row ?? null,
      actionKind: context?.actionKind ?? "sharedWrite",
    });
  } catch (error) {
    if (handleEditorPermissionDenied(error, render)) {
      throw error;
    }
    throw error;
  }

  try {
    if (DEBUG_EDITOR_WRITE) console.info?.("[gtms editor-write]", "invoke:start", { command, chapterId, rowId });
    const result = await invoke(command, payload);
    if (DEBUG_EDITOR_WRITE) console.info?.("[gtms editor-write]", "invoke:succeeded", { command, chapterId, rowId });
    return result;
  } catch (error) {
    if (DEBUG_EDITOR_WRITE) console.info?.("[gtms editor-write]", "invoke:failed", {
      command,
      chapterId,
      rowId,
      error: error?.message ?? String(error),
    });
    if (handleEditorPermissionDenied(error, render)) {
      throw error;
    }
    throw error;
  }
}
