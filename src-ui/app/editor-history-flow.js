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
  historyEntryCanOpenReplaceUndo,
  openEditorReplaceUndoModalState,
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

function nextChapterBaseCommitSha(payload, chapterState = state.editorChapter) {
  return typeof payload?.chapterBaseCommitSha === "string" && payload.chapterBaseCommitSha.trim()
    ? payload.chapterBaseCommitSha.trim()
    : chapterState?.chapterBaseCommitSha ?? null;
}

async function fetchEditorFieldHistory(render, requestKey) {
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

export function loadActiveEditorFieldHistory(render) {
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
  render?.({ scope: "translate-sidebar" });
  void fetchEditorFieldHistory(render, requestKey);
}

export function setActiveEditorField(render, rowId, languageCode) {
  if (!rowId || !languageCode || !hasEditorRow(state.editorChapter, rowId) || !hasEditorLanguage(state.editorChapter, languageCode)) {
    return;
  }

  const editorChapter = state.editorChapter;
  if (
    editorChapter.activeRowId === rowId
    && editorChapter.activeLanguageCode === languageCode
    && (editorChapter.history?.status === "loading" || editorChapter.history?.status === "ready")
  ) {
    return;
  }

  state.editorChapter = {
    ...editorChapter,
    activeRowId: rowId,
    activeLanguageCode: languageCode,
  };
  loadActiveEditorFieldHistory(render);
}

export function toggleEditorHistoryGroupExpanded(groupKey) {
  if (!groupKey || !state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = applyEditorHistoryGroupExpandedToggle(state.editorChapter, groupKey);
}

export function hasPendingEditorRowWrites(chapterState = state.editorChapter) {
  return (Array.isArray(chapterState?.rows) ? chapterState.rows : []).some((row) =>
    row?.saveStatus !== "idle" || row?.markerSaveState?.status === "saving"
  );
}

export function currentActiveHistoryEntryByCommitSha(commitSha, chapterState = state.editorChapter) {
  return currentActiveEditorHistoryEntryByCommitSha(chapterState, commitSha);
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
  if (!row || row.saveStatus !== "idle" || row.markerSaveState?.status === "saving") {
    showNoticeBadge("Save the current row before restoring history.", render);
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = applyEditorHistoryRestoreRequested(editorChapter, commitSha);
  render?.();

  try {
    const payload = await invoke("restore_gtms_editor_field_from_history", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId: editorChapter.activeRowId,
        languageCode: editorChapter.activeLanguageCode,
        commitSha,
      },
    });

    if (
      state.editorChapter?.chapterId === editorChapter.chapterId
      && state.editorChapter.activeRowId === editorChapter.activeRowId
      && state.editorChapter.activeLanguageCode === editorChapter.activeLanguageCode
    ) {
      updateEditorChapterRow(
        editorChapter.activeRowId,
        (currentRow) => applyEditorRowHistoryRestored(currentRow, editorChapter.activeLanguageCode, payload),
      );

      state.editorChapter = applyEditorHistoryRestoreSucceeded({
        ...state.editorChapter,
        sourceWordCounts:
          payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
            ? payload.sourceWordCounts
            : state.editorChapter.sourceWordCounts,
        chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
      });
      reconcileDirtyTrackedEditorRows([editorChapter.activeRowId]);
      applyEditorSelectionsToProjectState(state.editorChapter);
      render?.();
      loadActiveEditorFieldHistory(render);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      state.editorChapter?.chapterId === editorChapter.chapterId
      && state.editorChapter.activeRowId === editorChapter.activeRowId
      && state.editorChapter.activeLanguageCode === editorChapter.activeLanguageCode
    ) {
      state.editorChapter = applyEditorHistoryRestoreFailed(state.editorChapter);
      render?.();
    }
    showNoticeBadge(message || "The selected history entry could not be restored.", render);
  }
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

  if (hasPendingEditorRowWrites(editorChapter)) {
    state.editorChapter = applyEditorReplaceUndoModalError(
      editorChapter,
      "Save or resolve current row edits before undoing a batch replace.",
    );
    render?.();
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = applyEditorReplaceUndoModalLoading(editorChapter);
  render?.();

  try {
    const payload = await invoke("reverse_gtms_editor_batch_replace_commit", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        commitSha: modal.commitSha,
      },
    });

    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      state.editorChapter = applyEditorReplaceUndoModalError(state.editorChapter, message);
      render?.();
    }
  }
}
