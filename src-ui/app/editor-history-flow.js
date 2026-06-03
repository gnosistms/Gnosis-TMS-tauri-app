import {
  applyActiveEditorFieldHistoryLoaded,
  applyActiveEditorFieldHistoryLoadFailed,
  applyActiveEditorFieldHistoryLoading,
  applyEditorHistoryGroupExpandedToggle,
  applyEditorHistoryRestoreFailed,
  applyEditorHistoryRestoreRequested,
  applyEditorHistoryRestoreSucceeded,
  applyEditorReplaceUndoModalError,
  applyEditorReplaceUndoModalLoading,
  applyEditorRowHistoryRestored,
  buildEditorHistoryRequestKey,
  cancelEditorReplaceUndoModalState,
  currentActiveEditorHistoryEntryByCommitSha,
  currentEditorHistoryRequestMatches,
  editorRowMatchesHistoryPayload,
  historyEntryCanOpenReplaceUndo,
  openEditorReplaceUndoModalState,
  removeOptimisticEditorHistoryEntry,
} from "./editor-history-state.js";
import { buildEditorReplaceUndoNotice, normalizeEditorReplaceUndoModalState } from "./editor-replace.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  findEditorRowById,
  hasActiveEditorField,
  hasEditorLanguage,
  hasEditorRow,
} from "./editor-utils.js";
import { ensureEditorRowReadyForWrite } from "./editor-row-sync-flow.js";
import { requestEditorOperation } from "./editor-operation-queue.js";
import {
  assertQueuedEditorRowsReady,
  createQueuedEditorWritePermissionContext,
  editorChapterInvalidationKey,
  invokeQueuedEditorWriteCommand,
} from "./editor-queued-write.js";
import { projectRepoScope } from "./repo-write-queue.js";

const optimisticHistoryRestoreBaselines = new Map();

function nextChapterBaseCommitSha(payload, chapterState = state.editorChapter) {
  return typeof payload?.chapterBaseCommitSha === "string" && payload.chapterBaseCommitSha.trim()
    ? payload.chapterBaseCommitSha.trim()
    : chapterState?.chapterBaseCommitSha ?? null;
}

function cloneHistoryRestoreRow(row) {
  if (!row) {
    return null;
  }

  return typeof structuredClone === "function"
    ? structuredClone(row)
    : JSON.parse(JSON.stringify(row));
}

function historyRestoreBaselineKey(value) {
  if (!value?.chapterId || !value?.rowId || !value?.languageCode) {
    return "";
  }

  return `${value.chapterId}:${value.rowId}:${value.languageCode}`;
}

function captureHistoryRestoreBaseline(value) {
  const key = historyRestoreBaselineKey(value);
  if (!key || optimisticHistoryRestoreBaselines.has(key)) {
    return;
  }

  const row = findEditorRowById(value.rowId, state.editorChapter);
  if (row) {
    optimisticHistoryRestoreBaselines.set(key, cloneHistoryRestoreRow(row));
  }
}

function consumeHistoryRestoreBaseline(value) {
  const key = historyRestoreBaselineKey(value);
  if (!key) {
    return null;
  }

  const baseline = optimisticHistoryRestoreBaselines.get(key) ?? null;
  optimisticHistoryRestoreBaselines.delete(key);
  return baseline;
}

function applyOptimisticHistoryRestore(value, operations) {
  const {
    updateEditorChapterRow,
    reconcileDirtyTrackedEditorRows,
    applyEditorSelectionsToProjectState,
    render,
  } = operations;
  if (!value?.restoreEntry || typeof updateEditorChapterRow !== "function") {
    return;
  }

  captureHistoryRestoreBaseline(value);
  updateEditorChapterRow(value.rowId, (currentRow) => ({
    ...applyEditorRowHistoryRestored(currentRow, value.languageCode, value.restoreEntry),
    saveStatus: "saving",
    saveError: "",
  }));
  reconcileDirtyTrackedEditorRows?.([value.rowId]);
  applyEditorSelectionsToProjectState?.(state.editorChapter);
  render?.();
}

function rollbackOptimisticHistoryRestore(value, message, operations) {
  const {
    updateEditorChapterRow,
    reconcileDirtyTrackedEditorRows,
    applyEditorSelectionsToProjectState,
  } = operations;
  const baseline = consumeHistoryRestoreBaseline(value);
  if (!baseline || typeof updateEditorChapterRow !== "function") {
    return;
  }

  updateEditorChapterRow(value.rowId, (currentRow) => {
    if (editorRowMatchesHistoryPayload(currentRow, value.languageCode, value.restoreEntry)) {
      return baseline;
    }

    return {
      ...currentRow,
      persistedFields: baseline.persistedFields,
      persistedFootnotes: baseline.persistedFootnotes,
      persistedImageCaptions: baseline.persistedImageCaptions,
      persistedImages: baseline.persistedImages,
      persistedFieldStates: baseline.persistedFieldStates,
      persistedTextStyle: baseline.persistedTextStyle,
      saveStatus: "error",
      saveError: message || "The selected history entry could not be restored.",
    };
  });
  reconcileDirtyTrackedEditorRows?.([value.rowId]);
  applyEditorSelectionsToProjectState?.(state.editorChapter);
}

async function fetchEditorFieldHistory(render, requestKey, options = {}) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !editorChapter.activeRowId || !editorChapter.activeLanguageCode) {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  const rowId = editorChapter.activeRowId;
  const languageCode = editorChapter.activeLanguageCode;

  try {
    const payload = await invoke("load_gtms_editor_field_history", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
        languageCode,
      },
    });

    if (!currentEditorHistoryRequestMatches(state.editorChapter, editorChapter.chapterId, rowId, languageCode, requestKey)) {
      return;
    }

    state.editorChapter = applyActiveEditorFieldHistoryLoaded(
      state.editorChapter,
      rowId,
      languageCode,
      requestKey,
      payload?.entries,
    );
    if (options?.clearOptimisticOperationId) {
      state.editorChapter = removeOptimisticEditorHistoryEntry(
        state.editorChapter,
        options.clearOptimisticOperationId,
      );
    }
    render?.({ scope: "translate-sidebar" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!currentEditorHistoryRequestMatches(state.editorChapter, editorChapter.chapterId, rowId, languageCode, requestKey)) {
      return;
    }

    state.editorChapter = applyActiveEditorFieldHistoryLoadFailed(
      state.editorChapter,
      rowId,
      languageCode,
      requestKey,
      message,
    );
    render?.({ scope: "translate-sidebar" });
  }
}

export function loadActiveEditorFieldHistory(render, options = {}) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !hasActiveEditorField(editorChapter)) {
    return;
  }

  const requestKey = buildEditorHistoryRequestKey(
    editorChapter.chapterId,
    editorChapter.activeRowId,
    editorChapter.activeLanguageCode,
  );
  state.editorChapter = applyActiveEditorFieldHistoryLoading(editorChapter);
  if (options?.clearOptimisticOperationId) {
    state.editorChapter = removeOptimisticEditorHistoryEntry(
      state.editorChapter,
      options.clearOptimisticOperationId,
    );
  }
  render?.({ scope: "translate-sidebar" });
  void fetchEditorFieldHistory(render, requestKey, options);
}

export function toggleEditorHistoryGroupExpanded(groupKey) {
  if (!groupKey || !state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = applyEditorHistoryGroupExpandedToggle(state.editorChapter, groupKey);
}

export function openEditorReplaceUndoModal(commitSha) {
  if (!state.editorChapter?.chapterId || !historyEntryCanOpenReplaceUndo(state.editorChapter, commitSha)) {
    return;
  }

  state.editorChapter = openEditorReplaceUndoModalState(state.editorChapter, commitSha);
}

export function cancelEditorReplaceUndoModal() {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = cancelEditorReplaceUndoModalState(state.editorChapter);
}

export async function restoreEditorFieldHistory(render, commitSha, operations = {}) {
  const {
    updateEditorChapterRow,
    reconcileDirtyTrackedEditorRows,
    applyEditorSelectionsToProjectState,
  } = operations;
  if (
    typeof updateEditorChapterRow !== "function"
    || typeof reconcileDirtyTrackedEditorRows !== "function"
    || typeof applyEditorSelectionsToProjectState !== "function"
  ) {
    return;
  }

  const editorChapter = state.editorChapter;
  if (!commitSha || !editorChapter?.chapterId || !hasActiveEditorField(editorChapter)) {
    return;
  }

  const row = await ensureEditorRowReadyForWrite(render, editorChapter.activeRowId);
  if (!row || (row.saveStatus !== "idle" && row.saveStatus !== "saving")) {
    showNoticeBadge("Save the current row before restoring history.", render);
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  const repoScope = projectRepoScope({ team, project: context?.project ?? null });
  if (!Number.isFinite(team?.installationId) || !context?.project?.name || !repoScope) {
    return;
  }

  state.editorChapter = applyEditorHistoryRestoreRequested(editorChapter, commitSha);
  render?.();

  const operationValue = {
    input: {
      installationId: team.installationId,
      projectId: context.project.id,
      repoName: context.project.name,
      chapterId: editorChapter.chapterId,
      rowId: editorChapter.activeRowId,
      languageCode: editorChapter.activeLanguageCode,
      commitSha,
    },
    chapterId: editorChapter.chapterId,
    rowId: editorChapter.activeRowId,
    languageCode: editorChapter.activeLanguageCode,
    commitSha,
    restoreEntry: currentActiveEditorHistoryEntryByCommitSha(editorChapter, commitSha),
    permissionContext: createQueuedEditorWritePermissionContext({
      team,
      project: context.project,
      chapter: context.chapter,
      row,
      actionKind: "sharedWrite",
    }),
  };

  const requested = requestEditorOperation({
    repoScope,
    chapterScope: `${repoScope}:${editorChapter.chapterId}`,
    rowScope: `${repoScope}:${editorChapter.chapterId}:${editorChapter.activeRowId}`,
    coalesceKey: `restoreHistory:${editorChapter.chapterId}:${editorChapter.activeRowId}:${editorChapter.activeLanguageCode}`,
    kind: "restoreHistory",
    value: operationValue,
    metadata: {
      projectId: context.project.id,
      chapterId: editorChapter.chapterId,
      rowId: editorChapter.activeRowId,
      languageCode: editorChapter.activeLanguageCode,
      commitSha,
    },
    invalidationKeys: [editorChapterInvalidationKey(repoScope, editorChapter.chapterId)],
  }, {
    applyOptimistic: (operation) => {
      applyOptimisticHistoryRestore(operation.value, {
        updateEditorChapterRow,
        reconcileDirtyTrackedEditorRows,
        applyEditorSelectionsToProjectState,
        render,
      });
    },
    run: async (operation) => {
      assertQueuedEditorRowsReady({
        chapterId: operation.value.chapterId,
        rowIds: [operation.value.rowId],
        forbidPendingText: true,
        message: "Save, refresh, or resolve the row before restoring history.",
      });
      return invokeQueuedEditorWriteCommand("restore_gtms_editor_field_from_history", {
        input: {
          ...operation.value.input,
        },
      }, operation.value.permissionContext, render);
    },
    onSuccess: (payload, operation) => {
      const value = operation?.value ?? operationValue;
      consumeHistoryRestoreBaseline(value);
      if (
        state.editorChapter?.chapterId === value.chapterId
        && state.editorChapter.activeRowId === value.rowId
        && state.editorChapter.activeLanguageCode === value.languageCode
      ) {
        updateEditorChapterRow(
          value.rowId,
          (currentRow) => applyEditorRowHistoryRestored(currentRow, value.languageCode, payload),
        );

        state.editorChapter = applyEditorHistoryRestoreSucceeded({
          ...state.editorChapter,
          sourceWordCounts:
            payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
              ? payload.sourceWordCounts
              : state.editorChapter.sourceWordCounts,
          chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
        });
        reconcileDirtyTrackedEditorRows([value.rowId]);
        applyEditorSelectionsToProjectState(state.editorChapter);
        render?.();
        loadActiveEditorFieldHistory(render);
      }
    },
    onError: (error, operation) => {
      const value = operation?.value ?? operationValue;
      const message = error instanceof Error ? error.message : String(error);
      rollbackOptimisticHistoryRestore(value, message, {
        updateEditorChapterRow,
        reconcileDirtyTrackedEditorRows,
        applyEditorSelectionsToProjectState,
      });
      if (
        state.editorChapter?.chapterId === value.chapterId
        && state.editorChapter.activeRowId === value.rowId
        && state.editorChapter.activeLanguageCode === value.languageCode
        && state.editorChapter.history?.restoringCommitSha === value.commitSha
      ) {
        state.editorChapter = applyEditorHistoryRestoreFailed(state.editorChapter);
        render?.();
      }
      showNoticeBadge(message || "The selected history entry could not be restored.", render);
    },
  });
  requested.promise.catch(() => {});
}

export async function confirmEditorReplaceUndo(render, operations = {}) {
  const { markEditorRowsPersisted } = operations;
  if (typeof markEditorRowsPersisted !== "function") {
    return;
  }

  const editorChapter = state.editorChapter;
  const modal = normalizeEditorReplaceUndoModalState(editorChapter?.replaceUndoModal);
  if (!editorChapter?.chapterId || !modal.isOpen || !modal.commitSha || modal.status === "loading") {
    return;
  }

  if (!historyEntryCanOpenReplaceUndo(editorChapter, modal.commitSha)) {
    state.editorChapter = applyEditorReplaceUndoModalError(
      editorChapter,
      "The selected batch replace history entry is no longer available.",
    );
    render?.();
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  const repoScope = projectRepoScope({ team, project: context?.project ?? null });
  if (!Number.isFinite(team?.installationId) || !context?.project?.name || !repoScope) {
    return;
  }

  state.editorChapter = applyEditorReplaceUndoModalLoading(editorChapter);
  render?.();

  const operationValue = {
    input: {
      installationId: team.installationId,
      projectId: context.project.id,
      repoName: context.project.name,
      chapterId: editorChapter.chapterId,
      commitSha: modal.commitSha,
    },
    chapterId: editorChapter.chapterId,
    commitSha: modal.commitSha,
    permissionContext: createQueuedEditorWritePermissionContext({
      team,
      project: context.project,
      chapter: context.chapter,
      actionKind: "sharedWrite",
    }),
  };

  const requested = requestEditorOperation({
    repoScope,
    chapterScope: `${repoScope}:${editorChapter.chapterId}`,
    kind: "replaceUndo",
    value: operationValue,
    metadata: {
      projectId: context.project.id,
      chapterId: editorChapter.chapterId,
      commitSha: modal.commitSha,
    },
    invalidationKeys: [editorChapterInvalidationKey(repoScope, editorChapter.chapterId)],
  }, {
    run: async (operation) => {
      assertQueuedEditorRowsReady({
        chapterId: operation.value.chapterId,
        includeAllRows: true,
        forbidPendingText: true,
        message: "Save, refresh, or resolve this file before undoing batch replace.",
      });
      if (
        state.editorChapter?.chapterId === operation.value.chapterId
        && !historyEntryCanOpenReplaceUndo(state.editorChapter, operation.value.commitSha)
      ) {
        throw new Error("The selected batch replace history entry is no longer available.");
      }
      return invokeQueuedEditorWriteCommand("reverse_gtms_editor_batch_replace_commit", {
        input: {
          ...operation.value.input,
        },
      }, operation.value.permissionContext, render);
    },
    onSuccess: (payload, operation) => {
      const value = operation?.value ?? operationValue;
      if (state.editorChapter?.chapterId === value.chapterId) {
        const updatedRows = Array.isArray(payload?.updatedRows) ? payload.updatedRows : [];
        const skippedRowCount = Array.isArray(payload?.skippedRowIds) ? payload.skippedRowIds.length : 0;
        if (updatedRows.length > 0) {
          markEditorRowsPersisted(
            updatedRows,
            payload?.sourceWordCounts,
            nextChapterBaseCommitSha(payload, state.editorChapter),
          );
        } else {
          state.editorChapter = {
            ...state.editorChapter,
            chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
          };
        }
        state.editorChapter = cancelEditorReplaceUndoModalState(state.editorChapter);
        render?.();
        if (updatedRows.some((row) => row?.rowId === state.editorChapter.activeRowId)) {
          loadActiveEditorFieldHistory(render);
        }
        showNoticeBadge(buildEditorReplaceUndoNotice(updatedRows.length, skippedRowCount), render);
      }
    },
    onError: (error, operation) => {
      const value = operation?.value ?? operationValue;
      const message = error instanceof Error ? error.message : String(error);
      if (state.editorChapter?.chapterId === value.chapterId) {
        state.editorChapter = applyEditorReplaceUndoModalError(state.editorChapter, message);
        render?.();
      }
    },
  });
  requested.promise.catch(() => {});
}
