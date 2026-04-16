import { rowHasPersistedChanges } from "./editor-row-persistence-model.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import { state, createEditorCommentsState, createEditorHistoryState } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  normalizeEditorRow,
  removeEditorChapterRow,
  updateEditorChapterRow,
} from "./editor-state-flow.js";
import { findEditorRowById } from "./editor-utils.js";

const pendingEditorRowReloads = new Map();

function normalizeHeadSha(headSha) {
  return typeof headSha === "string" && headSha.trim()
    ? headSha.trim()
    : null;
}

function clearActiveEditorSelectionForRow(rowId) {
  if (state.editorChapter?.activeRowId !== rowId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: null,
    activeLanguageCode: null,
    comments: createEditorCommentsState(),
    history: createEditorHistoryState(),
  };
}

function applyRowReloadedFromDisk(rowId, payloadRow, chapterBaseCommitSha = null) {
  const normalizedRow = normalizeEditorRow(payloadRow);
  updateEditorChapterRow(rowId, () => normalizedRow);
  state.editorChapter = {
    ...state.editorChapter,
    chapterBaseCommitSha:
      typeof chapterBaseCommitSha === "string" && chapterBaseCommitSha.trim()
        ? chapterBaseCommitSha
        : state.editorChapter.chapterBaseCommitSha,
  };
  return normalizedRow;
}

function applyMissingRemoteRow(rowId) {
  clearActiveEditorSelectionForRow(rowId);
  removeEditorChapterRow(rowId);
}

function applyDeletedRemoteRow(rowId, payloadRow, chapterBaseCommitSha = null) {
  const normalizedRow = normalizeEditorRow(payloadRow);
  updateEditorChapterRow(rowId, () => normalizedRow);
  clearActiveEditorSelectionForRow(rowId);
  state.editorChapter = {
    ...state.editorChapter,
    chapterBaseCommitSha:
      typeof chapterBaseCommitSha === "string" && chapterBaseCommitSha.trim()
        ? chapterBaseCommitSha
        : state.editorChapter.chapterBaseCommitSha,
  };
  return normalizedRow;
}

function editorRowWriteBlockedMessage(options = {}) {
  if (options.structural === true) {
    return "Refresh the file before changing row structure.";
  }

  return "Resolve the row state before saving changes.";
}

export function markEditorRowsStale(syncResult = {}) {
  if (!state.editorChapter?.chapterId || !Array.isArray(state.editorChapter.rows)) {
    return false;
  }

  const currentHeadSha = normalizeHeadSha(state.editorChapter.chapterBaseCommitSha);
  const oldHeadSha = normalizeHeadSha(syncResult?.oldHeadSha);
  if (currentHeadSha && oldHeadSha && currentHeadSha !== oldHeadSha) {
    return false;
  }

  const changedRowIds = new Set(
    (Array.isArray(syncResult.changedRowIds) ? syncResult.changedRowIds : []).filter(Boolean),
  );
  const deletedRowIds = new Set(
    (Array.isArray(syncResult.deletedRowIds) ? syncResult.deletedRowIds : []).filter(Boolean),
  );
  const hasDeferredStructuralChanges = (Array.isArray(syncResult.insertedRowIds) ? syncResult.insertedRowIds : []).length > 0;
  const nextDeferredStructuralChanges = state.editorChapter.deferredStructuralChanges || hasDeferredStructuralChanges;
  let visibleStateChanged = nextDeferredStructuralChanges !== state.editorChapter.deferredStructuralChanges;

  state.editorChapter = {
    ...state.editorChapter,
    chapterBaseCommitSha:
      typeof syncResult?.newHeadSha === "string" && syncResult.newHeadSha.trim()
        ? syncResult.newHeadSha.trim()
        : state.editorChapter.chapterBaseCommitSha,
    deferredStructuralChanges: nextDeferredStructuralChanges,
    rows: state.editorChapter.rows.map((row) => {
      if (!row?.rowId) {
        return row;
      }

      const rowChanged = changedRowIds.has(row.rowId) || deletedRowIds.has(row.rowId);
      if (!rowChanged) {
        return row;
      }

      if (row.freshness === "conflict") {
        const nextRemotelyDeleted = row.remotelyDeleted || deletedRowIds.has(row.rowId);
        if (nextRemotelyDeleted !== row.remotelyDeleted) {
          visibleStateChanged = true;
        }
        return {
          ...row,
          remotelyDeleted: nextRemotelyDeleted,
        };
      }

      const nextFreshness = rowHasPersistedChanges(row) ? "staleDirty" : "stale";
      const nextRemotelyDeleted = row.remotelyDeleted || deletedRowIds.has(row.rowId);
      if (nextFreshness === row.freshness && nextRemotelyDeleted === row.remotelyDeleted) {
        return row;
      }

      visibleStateChanged = true;
      return {
        ...row,
        freshness: nextFreshness,
        remotelyDeleted: nextRemotelyDeleted,
      };
    }),
  };

  return visibleStateChanged;
}

export async function reloadEditorRowFromDisk(render, rowId, options = {}) {
  if (!rowId || !state.editorChapter?.chapterId) {
    return null;
  }

  const pendingReload = pendingEditorRowReloads.get(rowId);
  if (pendingReload) {
    return pendingReload;
  }

  const reloadPromise = (async () => {
    const team = selectedProjectsTeam();
    const context = findChapterContextById(state.editorChapter.chapterId);
    if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
      return null;
    }

    try {
      const payload = await invoke("load_gtms_editor_row", {
        input: {
          installationId: team.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId: state.editorChapter.chapterId,
          rowId,
        },
      });

      if (state.editorChapter?.chapterId !== context.chapter.id) {
        return null;
      }

      const payloadRow = payload?.row ?? null;
      if (!payloadRow) {
        applyMissingRemoteRow(rowId);
        render?.();
        if (options.suppressNotice !== true) {
          showNoticeBadge("The row was deleted remotely.", render);
        }
        return null;
      }

      if (payloadRow.lifecycleState === "deleted") {
        const deletedRow = applyDeletedRemoteRow(rowId, payloadRow, payload?.chapterBaseCommitSha ?? null);
        render?.();
        if (options.suppressNotice !== true) {
          showNoticeBadge("The row was deleted remotely.", render);
        }
        return deletedRow;
      }

      const updatedRow = applyRowReloadedFromDisk(rowId, payloadRow, payload?.chapterBaseCommitSha ?? null);
      render?.();
      return updatedRow;
    } catch (error) {
      if (options.suppressNotice !== true) {
        const message = error instanceof Error ? error.message : String(error);
        showNoticeBadge(message || "The latest row state could not be loaded.", render);
      }
      return null;
    }
  })();

  pendingEditorRowReloads.set(rowId, reloadPromise);
  try {
    return await reloadPromise;
  } finally {
    pendingEditorRowReloads.delete(rowId);
  }
}

export async function ensureEditorRowReadyForActivation(render, rowId, options = {}) {
  const row = findEditorRowById(rowId, state.editorChapter);
  if (!row) {
    return false;
  }

  const input = options?.input;
  if (input instanceof HTMLTextAreaElement && (row.freshness === "stale" || row.remotelyDeleted === true)) {
    input.readOnly = true;
  }

  const needsReload =
    row.remotelyDeleted === true
    || (row.freshness === "stale" && !rowHasPersistedChanges(row));

  if (!needsReload) {
    if (input instanceof HTMLTextAreaElement) {
      input.readOnly = false;
    }
    return true;
  }

  const updatedRow = await reloadEditorRowFromDisk(render, rowId, {
    suppressNotice: options.suppressNotice === true,
  });
  if (input instanceof HTMLTextAreaElement && document.body.contains(input)) {
    input.readOnly = false;
  }

  return updatedRow?.lifecycleState !== "deleted";
}

export async function ensureEditorRowReadyForWrite(render, rowId, options = {}) {
  if (!rowId || !state.editorChapter?.chapterId) {
    return null;
  }

  if (options.structural === true && state.editorChapter.deferredStructuralChanges === true) {
    showNoticeBadge(editorRowWriteBlockedMessage(options), render);
    return null;
  }

  const row = findEditorRowById(rowId, state.editorChapter);
  if (!row) {
    return null;
  }

  if (row.freshness === "conflict" || row.saveStatus === "conflict") {
    showNoticeBadge(editorRowWriteBlockedMessage(options), render);
    return null;
  }

  if (row.remotelyDeleted === true) {
    const updatedRow = await reloadEditorRowFromDisk(render, rowId, { suppressNotice: false });
    return updatedRow?.lifecycleState === "active" ? findEditorRowById(rowId, state.editorChapter) : null;
  }

  if (row.freshness === "stale" && !rowHasPersistedChanges(row)) {
    const updatedRow = await reloadEditorRowFromDisk(render, rowId, { suppressNotice: true });
    return updatedRow?.lifecycleState === "active" ? findEditorRowById(rowId, state.editorChapter) : null;
  }

  if (row.freshness === "staleDirty" && options.allowStaleDirty !== true) {
    showNoticeBadge(editorRowWriteBlockedMessage(options), render);
    return null;
  }

  return row;
}
