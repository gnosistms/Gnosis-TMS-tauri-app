import {
  cloneDirtyRowIds,
  reviewTabLanguageToOpenAfterSave,
  resolveDirtyTrackedEditorRowIds,
  rowHasFieldChanges,
  rowHasPersistedChanges,
  rowTextContentEqual,
} from "./editor-row-persistence-model.js";
import {
  markEditorRowDirty,
  reconcileDirtyTrackedEditorRows,
} from "./editor-dirty-row-state.js";
import {
  EDITOR_ROW_FILTER_MODE_HAS_CONFLICT,
  normalizeEditorChapterFilterState,
} from "./editor-filters.js";
import { loadActiveEditorFieldHistory } from "./editor-history-flow.js";
import {
  applyEditorRowConflictDetected,
  applyEditorRowConflictResolvedWithRemote,
  applyEditorRowFieldValue,
  applyEditorRowMarkerSaved,
  applyEditorRowMarkerSaveFailed,
  applyEditorRowMarkerSaving,
  applyEditorRowPersistFailed,
  applyEditorRowPersistQueuedWhileSaving,
  applyEditorRowPersistRequested,
  applyEditorRowPersistReset,
  applyEditorRowPersistSucceeded,
  applyEditorRowTextStyleSaved,
  applyEditorRowTextStyleSaveFailed,
  applyEditorRowTextStyleSaving,
} from "./editor-persistence-state.js";
import {
  applyEditorChapterRowsUnreviewed,
  cancelEditorUnreviewAllModalState,
  openEditorUnreviewAllModalState,
} from "./editor-review-state.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import { createEditorImageCaptionEditorState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { normalizeEditorRowTextStyle } from "./editor-row-text-style.js";
import {
  buildEditorFieldSelector,
  cloneRowFields,
  findEditorRowById,
  normalizeFieldState,
} from "./editor-utils.js";
import {
  ensureEditorRowReadyForWrite,
  reloadEditorRowFromDisk,
} from "./editor-row-sync-flow.js";

const pendingEditorRowPersistByRowId = new Map();
const pendingEditorDirtyRowScanFrameByRowId = new Map();
const pendingEditorRowCommitMetadataByRowId = new Map();
let pendingEditorFootnoteOpenRequest = null;
let pendingEditorImageCaptionOpenRequest = null;

function normalizePendingEditorCommitMetadata(commitMetadata) {
  if (!commitMetadata || typeof commitMetadata !== "object") {
    return null;
  }

  const operation =
    typeof commitMetadata.operation === "string" ? commitMetadata.operation.trim() : "";
  const aiModel =
    typeof commitMetadata.aiModel === "string" ? commitMetadata.aiModel.trim() : "";
  if (!operation && !aiModel) {
    return null;
  }

  return {
    operation,
    aiModel,
  };
}

function queuePendingEditorCommitMetadata(rowId, commitMetadata) {
  const normalizedCommitMetadata = normalizePendingEditorCommitMetadata(commitMetadata);
  if (!rowId || !normalizedCommitMetadata) {
    return;
  }

  pendingEditorRowCommitMetadataByRowId.set(rowId, normalizedCommitMetadata);
}

function takePendingEditorCommitMetadata(rowId) {
  if (!rowId) {
    return null;
  }

  const commitMetadata = pendingEditorRowCommitMetadataByRowId.get(rowId) ?? null;
  pendingEditorRowCommitMetadataByRowId.delete(rowId);
  return commitMetadata;
}

function lockConflictFilter() {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const currentFilters = normalizeEditorChapterFilterState(state.editorChapter.filters);
  if (currentFilters.rowFilterMode === EDITOR_ROW_FILTER_MODE_HAS_CONFLICT) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    filters: {
      ...currentFilters,
      rowFilterMode: EDITOR_ROW_FILTER_MODE_HAS_CONFLICT,
    },
  };
}

function cancelScheduledDirtyRowScan(rowId) {
  const pendingScan = pendingEditorDirtyRowScanFrameByRowId.get(rowId);
  if (!pendingScan) {
    return;
  }

  if (Number.isInteger(pendingScan.frameId) && pendingScan.frameId !== 0) {
    window.cancelAnimationFrame(pendingScan.frameId);
  }
  if (Number.isInteger(pendingScan.verifyFrameId) && pendingScan.verifyFrameId !== 0) {
    window.cancelAnimationFrame(pendingScan.verifyFrameId);
  }

  pendingEditorDirtyRowScanFrameByRowId.delete(rowId);
}

function updateUnreviewAllModalError(message = "", render) {
  if (!state.editorChapter?.chapterId || !state.editorChapter?.unreviewAllModal?.isOpen) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    unreviewAllModal: {
      ...state.editorChapter.unreviewAllModal,
      status: "idle",
      error: message,
    },
  };
  render?.();
}

function chapterHasPendingEditorWrites(chapterState = state.editorChapter) {
  return hasPendingEditorWrites(chapterState);
}

function rowHasPendingCommentWrite(rowId, chapterState = state.editorChapter) {
  if (!rowId || !chapterState?.chapterId) {
    return false;
  }

  const comments = chapterState.comments;
  const commentsRowId = typeof comments?.rowId === "string" ? comments.rowId : "";
  return commentsRowId === rowId && (comments?.status === "saving" || comments?.status === "deleting");
}

function scopedEditorRows(chapterState = state.editorChapter, options = {}) {
  const rowIdFilter = Array.isArray(options?.rowIds)
    ? new Set(options.rowIds.filter(Boolean))
    : null;
  const excludeRowId = typeof options?.excludeRowId === "string" ? options.excludeRowId : "";

  return (Array.isArray(chapterState?.rows) ? chapterState.rows : []).filter((row) => {
    const rowId = row?.rowId;
    return Boolean(rowId) && rowId !== excludeRowId && (!rowIdFilter || rowIdFilter.has(rowId));
  });
}

export function hasPendingEditorWrites(chapterState = state.editorChapter, options = {}) {
  return scopedEditorRows(chapterState, options).some((row) =>
    row?.saveStatus === "saving"
    || row?.markerSaveState?.status === "saving"
    || row?.textStyleSaveState?.status === "saving"
    || rowHasPersistedChanges(row)
    || rowHasPendingCommentWrite(row?.rowId, chapterState)
  );
}

function chapterNeedsRefreshBeforeMarkerBatchUpdate(chapterState = state.editorChapter) {
  if (chapterState?.deferredStructuralChanges === true) {
    return true;
  }

  return (Array.isArray(chapterState?.rows) ? chapterState.rows : []).some((row) =>
    row?.freshness === "stale"
    || row?.freshness === "staleDirty"
    || row?.freshness === "conflict"
    || row?.remotelyDeleted === true
  );
}

function formatUnreviewAllCount(count) {
  return count === 1 ? "1 row" : `${count} rows`;
}

function nextChapterBaseCommitSha(payload, chapterState = state.editorChapter) {
  return typeof payload?.chapterBaseCommitSha === "string" && payload.chapterBaseCommitSha.trim()
    ? payload.chapterBaseCommitSha.trim()
    : chapterState?.chapterBaseCommitSha ?? null;
}

function focusedEditorRowId() {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLTextAreaElement && activeElement.matches("[data-editor-row-field]")
    ? activeElement.dataset.rowId ?? ""
    : "";
}

export function scheduleDirtyEditorRowScan(render, rowId, operations = {}) {
  if (!rowId || typeof window === "undefined") {
    return;
  }

  cancelScheduledDirtyRowScan(rowId);

  const pendingScan = {
    frameId: 0,
    verifyFrameId: 0,
  };
  pendingScan.frameId = window.requestAnimationFrame(() => {
    pendingScan.frameId = 0;
    pendingScan.verifyFrameId = window.requestAnimationFrame(() => {
      pendingEditorDirtyRowScanFrameByRowId.delete(rowId);
      if (focusedEditorRowId() === rowId) {
        return;
      }

      void flushDirtyEditorRows(render, operations, { rowIds: [rowId] });
    });
  });

  pendingEditorDirtyRowScanFrameByRowId.set(rowId, pendingScan);
}

export async function flushDirtyEditorRows(render, operations = {}, options = {}) {
  if (!state.editorChapter?.chapterId) {
    return true;
  }

  const candidateRowIds = resolveDirtyTrackedEditorRowIds(state.editorChapter?.dirtyRowIds, {
    rowIds: Array.isArray(options?.rowIds) ? options.rowIds : null,
    excludeRowId: typeof options?.excludeRowId === "string" ? options.excludeRowId : "",
  });
  if (candidateRowIds.length === 0) {
    return !hasPendingEditorWrites(state.editorChapter, options);
  }

  for (const rowId of candidateRowIds) {
    const row = findEditorRowById(rowId, state.editorChapter);
    if (!row) {
      reconcileDirtyTrackedEditorRows([rowId]);
      continue;
    }

    if (!rowHasPersistedChanges(row)) {
      reconcileDirtyTrackedEditorRows([rowId]);
      continue;
    }

    if (!rowHasFieldChanges(row)) {
      continue;
    }

    await persistEditorRowOnBlur(render, rowId, operations);
  }

  reconcileDirtyTrackedEditorRows(candidateRowIds);
  return !hasPendingEditorWrites(state.editorChapter, options);
}

export function updateEditorRowFieldValue(rowId, languageCode, nextValue, operations = {}) {
  updateEditorRowFieldValueForContentKind(
    rowId,
    languageCode,
    nextValue,
    "field",
    operations,
  );
}

export function updateEditorRowFieldValueForContentKind(
  rowId,
  languageCode,
  nextValue,
  contentKind = "field",
  operations = {},
) {
  const { updateEditorChapterRow } = operations;
  if (!rowId || !languageCode || typeof updateEditorChapterRow !== "function") {
    return;
  }

  updateEditorChapterRow(
    rowId,
    (row) => applyEditorRowFieldValue(row, languageCode, nextValue, contentKind),
  );
  markEditorRowDirty(rowId);
}

export function openEditorFootnote(render, rowId, languageCode) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  pendingEditorFootnoteOpenRequest = {
    rowId,
    languageCode,
  };

  state.editorChapter = {
    ...state.editorChapter,
    footnoteEditor: {
      rowId,
      languageCode,
    },
  };
  render?.({ scope: "translate-body" });

  if (typeof window !== "undefined") {
    window.requestAnimationFrame(() => {
      const input = document.querySelector(buildEditorFieldSelector(rowId, languageCode, "footnote"));
      if (input instanceof HTMLTextAreaElement) {
        input.focus({ preventScroll: true });
      }
      if (
        pendingEditorFootnoteOpenRequest?.rowId === rowId
        && pendingEditorFootnoteOpenRequest?.languageCode === languageCode
      ) {
        pendingEditorFootnoteOpenRequest = null;
      }
    });
  }
}

export function openEditorImageCaption(render, rowId, languageCode) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  pendingEditorImageCaptionOpenRequest = {
    rowId,
    languageCode,
  };

  state.editorChapter = {
    ...state.editorChapter,
    imageCaptionEditor: {
      rowId,
      languageCode,
    },
  };
  render?.({ scope: "translate-body" });

  if (typeof window !== "undefined") {
    window.requestAnimationFrame(() => {
      const input = document.querySelector(buildEditorFieldSelector(rowId, languageCode, "image-caption"));
      if (input instanceof HTMLTextAreaElement) {
        input.focus({ preventScroll: true });
      }
      if (
        pendingEditorImageCaptionOpenRequest?.rowId === rowId
        && pendingEditorImageCaptionOpenRequest?.languageCode === languageCode
      ) {
        pendingEditorImageCaptionOpenRequest = null;
      }
    });
  }
}

export function collapseEmptyEditorFootnote(render, rowId, languageCode) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  if (
    state.editorChapter.footnoteEditor?.rowId !== rowId
    || state.editorChapter.footnoteEditor?.languageCode !== languageCode
  ) {
    return;
  }
  if (
    pendingEditorFootnoteOpenRequest?.rowId === rowId
    && pendingEditorFootnoteOpenRequest?.languageCode === languageCode
  ) {
    return;
  }

  const row = findEditorRowById(rowId, state.editorChapter);
  const footnote = typeof row?.footnotes?.[languageCode] === "string"
    ? row.footnotes[languageCode]
    : String(row?.footnotes?.[languageCode] ?? "");
  if (footnote.trim()) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    footnoteEditor: {
      rowId: null,
      languageCode: null,
    },
  };
  render?.({ scope: "translate-body" });
}

export function collapseEditorImageCaption(render, rowId, languageCode) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  if (
    state.editorChapter.imageCaptionEditor?.rowId !== rowId
    || state.editorChapter.imageCaptionEditor?.languageCode !== languageCode
  ) {
    return;
  }

  if (
    pendingEditorImageCaptionOpenRequest?.rowId === rowId
    && pendingEditorImageCaptionOpenRequest?.languageCode === languageCode
  ) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    imageCaptionEditor: createEditorImageCaptionEditorState(),
  };
  render?.({ scope: "translate-body" });
}

export async function updateEditorRowTextStyle(render, rowId, nextTextStyle, operations = {}) {
  const { updateEditorChapterRow } = operations;
  if (!rowId || typeof updateEditorChapterRow !== "function") {
    return;
  }

  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId) {
    return;
  }

  const normalizedTextStyle = normalizeEditorRowTextStyle(nextTextStyle);
  let row = await ensureEditorRowReadyForWrite(render, rowId);
  if (!row) {
    return;
  }

  if (row.saveStatus !== "idle") {
    await persistEditorRowOnBlur(render, rowId, operations);
    row = await ensureEditorRowReadyForWrite(render, rowId);
    if (!row || row.saveStatus !== "idle") {
      return;
    }
  }

  const previousTextStyle = normalizeEditorRowTextStyle(row.textStyle);
  if (previousTextStyle === normalizedTextStyle) {
    return;
  }

  if (row.markerSaveState?.status === "saving" || row.textStyleSaveState?.status === "saving") {
    return;
  }

  if (rowHasPendingCommentWrite(rowId, editorChapter)) {
    showNoticeBadge("Finish saving comments before updating the row style.", render);
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  updateEditorChapterRow(
    rowId,
    (currentRow) => applyEditorRowTextStyleSaving(currentRow, normalizedTextStyle),
  );
  markEditorRowDirty(rowId);
  render?.({ scope: "translate-body" });

  try {
    const payload = await invoke("update_gtms_editor_row_text_style", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
        textStyle: normalizedTextStyle,
      },
    });

    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      updateEditorChapterRow(
        rowId,
        (currentRow) => applyEditorRowTextStyleSaved(currentRow, payload?.textStyle),
      );
      state.editorChapter = {
        ...state.editorChapter,
        chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
      };
      reconcileDirtyTrackedEditorRows([rowId]);
      render?.({ scope: "translate-body" });

      if (state.editorChapter.activeRowId === rowId) {
        loadActiveEditorFieldHistory(render);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      updateEditorChapterRow(
        rowId,
        (currentRow) => applyEditorRowTextStyleSaveFailed(currentRow, previousTextStyle, message),
      );
      reconcileDirtyTrackedEditorRows([rowId]);
      render?.({ scope: "translate-body" });
    }
    showNoticeBadge(message || "The row style could not be saved.", render);
  }

  if (focusedEditorRowId() !== rowId) {
    void flushDirtyEditorRows(render, operations, { rowIds: [rowId] });
  }
}

export async function toggleEditorRowFieldMarker(
  render,
  rowId,
  languageCode,
  kind,
  operations = {},
) {
  const { updateEditorChapterRow } = operations;
  if (
    !rowId
    || !languageCode
    || (kind !== "reviewed" && kind !== "please-check")
    || typeof updateEditorChapterRow !== "function"
  ) {
    return;
  }

  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId) {
    return;
  }

  const activeRowId =
    typeof state.editorChapter.activeRowId === "string" ? state.editorChapter.activeRowId : "";
  if (activeRowId && activeRowId !== rowId) {
    const activeRow = findEditorRowById(activeRowId, state.editorChapter);
    if (rowHasFieldChanges(activeRow)) {
      await persistEditorRowOnBlur(render, activeRowId, operations);
      if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
        return;
      }
    }
  }

  if (!(await flushDirtyEditorRows(render, operations, { excludeRowId: rowId }))) {
    showNoticeBadge("Finish saving the current row before updating review markers.", render);
    return;
  }

  if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
    return;
  }

  const row = await ensureEditorRowReadyForWrite(render, rowId);
  if (!row) {
    return;
  }

  if (row.saveStatus !== "idle") {
    showNoticeBadge("Save the row text before updating review markers.", render);
    return;
  }

  if (row.markerSaveState?.status === "saving") {
    return;
  }

  if (row.textStyleSaveState?.status === "saving") {
    showNoticeBadge("Finish saving the row style before updating review markers.", render);
    return;
  }

  if (rowHasPendingCommentWrite(rowId, editorChapter)) {
    showNoticeBadge("Finish saving comments before updating review markers.", render);
    return;
  }

  const currentFieldState = normalizeFieldState(row.fieldStates?.[languageCode]);
  const nextEnabled = kind === "reviewed"
    ? !currentFieldState.reviewed
    : !currentFieldState.pleaseCheck;
  const nextFieldState = {
    ...currentFieldState,
    ...(kind === "reviewed"
      ? { reviewed: nextEnabled }
      : { pleaseCheck: nextEnabled }),
  };

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  const previousFieldState = currentFieldState;
  markEditorRowDirty(rowId);
  updateEditorChapterRow(
    rowId,
    (currentRow) => applyEditorRowMarkerSaving(currentRow, languageCode, kind, nextFieldState),
  );
  render?.();

  try {
    const payload = await invoke("update_gtms_editor_row_field_flag", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
        languageCode,
        flag: kind,
        enabled: nextEnabled,
      },
    });

    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      updateEditorChapterRow(
        rowId,
        (currentRow) => applyEditorRowMarkerSaved(currentRow, languageCode, payload),
      );
      state.editorChapter = {
        ...state.editorChapter,
        chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
      };
      reconcileDirtyTrackedEditorRows([rowId]);
      render?.();

      if (state.editorChapter.activeRowId === rowId && state.editorChapter.activeLanguageCode === languageCode) {
        loadActiveEditorFieldHistory(render);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      updateEditorChapterRow(
        rowId,
        (currentRow) => applyEditorRowMarkerSaveFailed(currentRow, languageCode, previousFieldState, message),
      );
      reconcileDirtyTrackedEditorRows([rowId]);
      render?.();
    }
    showNoticeBadge(message || "The review marker could not be saved.", render);
  }
}

export function openEditorUnreviewAllModal(render) {
  const chapterState = state.editorChapter;
  const languageCode =
    typeof chapterState?.selectedTargetLanguageCode === "string"
      ? chapterState.selectedTargetLanguageCode.trim()
      : "";
  if (!chapterState?.chapterId || !languageCode) {
    return;
  }

  state.editorChapter = openEditorUnreviewAllModalState(chapterState, languageCode);
  render?.();
}

export function cancelEditorUnreviewAllModal(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = cancelEditorUnreviewAllModalState(state.editorChapter);
  render?.();
}

export async function confirmEditorUnreviewAll(render, operations = {}) {
  const editorChapter = state.editorChapter;
  const modal = editorChapter?.unreviewAllModal;
  const languageCode =
    typeof modal?.languageCode === "string" ? modal.languageCode.trim() : "";
  if (!editorChapter?.chapterId || !modal?.isOpen || modal.status === "loading" || !languageCode) {
    return;
  }

  await flushDirtyEditorRows(render, operations);
  if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
    return;
  }

  if (chapterHasPendingEditorWrites(state.editorChapter)) {
    updateUnreviewAllModalError(
      "Save all row text before marking every translation unreviewed.",
      render,
    );
    return;
  }

  if (chapterNeedsRefreshBeforeMarkerBatchUpdate(state.editorChapter)) {
    updateUnreviewAllModalError(
      "Refresh or resolve the file before marking every translation unreviewed.",
      render,
    );
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    unreviewAllModal: {
      ...state.editorChapter.unreviewAllModal,
      status: "loading",
      error: "",
    },
  };
  render?.();

  try {
    const payload = await invoke("clear_gtms_editor_reviewed_markers", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        languageCode,
      },
    });

    if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
      return;
    }

    const changedRowIds = Array.isArray(payload?.rowIds) ? payload.rowIds.filter(Boolean) : [];
    const activeRowId = state.editorChapter.activeRowId;
    const activeLanguageCode = state.editorChapter.activeLanguageCode;
    state.editorChapter = {
      ...applyEditorChapterRowsUnreviewed(
        state.editorChapter,
        languageCode,
        changedRowIds,
      ),
      chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
    };
    reconcileDirtyTrackedEditorRows(changedRowIds);
    render?.();

    if (
      changedRowIds.includes(activeRowId)
      && activeLanguageCode === languageCode
    ) {
      loadActiveEditorFieldHistory(render);
    }

    showNoticeBadge(
      changedRowIds.length > 0
        ? `Marked ${formatUnreviewAllCount(changedRowIds.length)} unreviewed.`
        : "All translations are already unreviewed.",
      render,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateUnreviewAllModalError(message, render);
    showNoticeBadge(message || "The reviewed markers could not be cleared.", render);
  }
}

export async function persistEditorRowOnBlur(render, rowId, operations = {}, options = {}) {
  await persistEditorRow(render, rowId, operations, options);
}

export async function resolveEditorRowConflict(render, rowId, resolution, operations = {}) {
  const { updateEditorChapterRow } = operations;
  if (!rowId || typeof updateEditorChapterRow !== "function") {
    return;
  }

  const row = findEditorRowById(rowId, state.editorChapter);
  if (!row?.conflictState) {
    return;
  }

  if (resolution === "use-remote") {
    updateEditorChapterRow(rowId, (currentRow) => applyEditorRowConflictResolvedWithRemote(currentRow));
    reconcileDirtyTrackedEditorRows([rowId]);
    render?.({ scope: "translate-body" });
    render?.({ scope: "translate-sidebar" });
    return;
  }

  if (resolution !== "keep-local") {
    return;
  }

  await persistEditorRow(render, rowId, operations, {
    baseFieldsOverride: row.conflictState?.remoteRow?.fields ?? null,
    baseFootnotesOverride: row.conflictState?.remoteRow?.footnotes ?? null,
    baseImageCaptionsOverride: row.conflictState?.remoteRow?.imageCaptions ?? null,
  });
}

async function persistEditorRow(render, rowId, operations = {}, options = {}) {
  const {
    updateEditorChapterRow,
    applyEditorSelectionsToProjectState,
  } = operations;
  if (
    !rowId
    || !state.editorChapter?.chapterId
    || typeof updateEditorChapterRow !== "function"
    || typeof applyEditorSelectionsToProjectState !== "function"
  ) {
    return;
  }

  const existingPersist = pendingEditorRowPersistByRowId.get(rowId);
  if (existingPersist) {
    queuePendingEditorCommitMetadata(rowId, options?.commitMetadata);
    const row = findEditorRowById(rowId, state.editorChapter);
    if (row?.saveStatus === "saving") {
      updateEditorChapterRow(rowId, (currentRow) => applyEditorRowPersistQueuedWhileSaving(currentRow));
    }
    await existingPersist;
    return;
  }

  let nextCommitMetadata = normalizePendingEditorCommitMetadata(options?.commitMetadata);
  const persistPromise = (async () => {
    while (state.editorChapter?.chapterId) {
      const editorChapter = state.editorChapter;
      const row =
        options?.baseFieldsOverride || options?.baseFootnotesOverride || options?.baseImageCaptionsOverride
        ? findEditorRowById(rowId, state.editorChapter)
        : await ensureEditorRowReadyForWrite(render, rowId, {
          allowStaleDirty: true,
        });
      if (!row) {
        reconcileDirtyTrackedEditorRows([rowId]);
        return;
      }

      if (row.textStyleSaveState?.status === "saving") {
        return;
      }

      if (!rowHasFieldChanges(row)) {
        pendingEditorRowCommitMetadataByRowId.delete(rowId);
        if (row.saveStatus !== "idle" || row.saveError) {
          updateEditorChapterRow(rowId, (currentRow) => applyEditorRowPersistReset(currentRow));
          render?.({ scope: "translate-sidebar" });
        }
        reconcileDirtyTrackedEditorRows([rowId]);
        return;
      }

      const team = selectedProjectsTeam();
      const context = findChapterContextById(editorChapter.chapterId);
      if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
        return;
      }

      const commitMetadata = nextCommitMetadata ?? takePendingEditorCommitMetadata(rowId);
      nextCommitMetadata = null;

      const fieldsToPersist = cloneRowFields(row.fields);
      const footnotesToPersist = cloneRowFields(row.footnotes);
      const imageCaptionsToPersist = cloneRowFields(row.imageCaptions);
      const reviewLanguageToOpen = reviewTabLanguageToOpenAfterSave(
        editorChapter,
        rowId,
        row,
        fieldsToPersist,
      );
      updateEditorChapterRow(rowId, (currentRow) => applyEditorRowPersistRequested(currentRow));
      render?.({ scope: "translate-sidebar" });

      try {
        const payload = await invoke("update_gtms_editor_row_fields", {
          input: {
            installationId: team.installationId,
            projectId: context.project.id,
            repoName: context.project.name,
            chapterId: editorChapter.chapterId,
            rowId,
            fields: fieldsToPersist,
            footnotes: footnotesToPersist,
            imageCaptions: imageCaptionsToPersist,
            baseFields:
              options?.baseFieldsOverride && typeof options.baseFieldsOverride === "object"
                ? cloneRowFields(options.baseFieldsOverride)
                : cloneRowFields(row.baseFields),
            baseFootnotes:
              options?.baseFootnotesOverride && typeof options.baseFootnotesOverride === "object"
                ? cloneRowFields(options.baseFootnotesOverride)
                : cloneRowFields(row.baseFootnotes),
            baseImageCaptions:
              options?.baseImageCaptionsOverride && typeof options.baseImageCaptionsOverride === "object"
                ? cloneRowFields(options.baseImageCaptionsOverride)
                : cloneRowFields(row.baseImageCaptions),
            ...(commitMetadata?.operation ? { operation: commitMetadata.operation } : {}),
            ...(commitMetadata?.aiModel ? { aiModel: commitMetadata.aiModel } : {}),
          },
        });

        if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
          return;
        }

        if (payload?.status === "conflict") {
          if (rowTextContentEqual(
            fieldsToPersist,
            footnotesToPersist,
            imageCaptionsToPersist,
            payload?.row?.fields,
            payload?.row?.footnotes,
            payload?.row?.imageCaptions,
          )) {
            updateEditorChapterRow(
              rowId,
              (currentRow) => applyEditorRowPersistSucceeded(currentRow, payload?.row),
            );
            reconcileDirtyTrackedEditorRows([rowId]);
            render?.();
            return;
          }

          updateEditorChapterRow(
            rowId,
            (currentRow) => applyEditorRowConflictDetected(currentRow, payload, {
              localFields: fieldsToPersist,
              localFootnotes: footnotesToPersist,
              localImageCaptions: imageCaptionsToPersist,
            }),
          );
          lockConflictFilter();
          render?.();
          showNoticeBadge("Translation text changed on disk. Choose which version to keep.", render, 2400);
          return;
        }

        if (payload?.status === "deleted") {
          await reloadEditorRowFromDisk(render, rowId, { suppressNotice: false });
          reconcileDirtyTrackedEditorRows([rowId]);
          return;
        }

        const updatedRow = updateEditorChapterRow(
          rowId,
          (currentRow) => applyEditorRowPersistSucceeded(currentRow, payload?.row),
        );

        state.editorChapter = {
          ...state.editorChapter,
          sourceWordCounts:
            payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
              ? payload.sourceWordCounts
              : state.editorChapter.sourceWordCounts,
          chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
        };
        if (
          reviewLanguageToOpen
          && state.editorChapter.activeRowId === rowId
          && state.editorChapter.activeLanguageCode === reviewLanguageToOpen
        ) {
          const reviewExpandedSectionKeys =
            state.editorChapter.reviewExpandedSectionKeys instanceof Set
              ? new Set(state.editorChapter.reviewExpandedSectionKeys)
              : new Set();
          reviewExpandedSectionKeys.add("last-update");
          state.editorChapter = {
            ...state.editorChapter,
            sidebarTab: "review",
            reviewExpandedSectionKeys,
          };
        }
        reconcileDirtyTrackedEditorRows([rowId]);
        applyEditorSelectionsToProjectState(state.editorChapter);
        render?.({ scope: "translate-sidebar" });
        if (state.editorChapter.activeRowId === rowId) {
          loadActiveEditorFieldHistory(render);
        }

        if (updatedRow?.saveStatus !== "dirty") {
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (state.editorChapter?.chapterId === editorChapter.chapterId) {
          updateEditorChapterRow(rowId, (currentRow) => applyEditorRowPersistFailed(currentRow, message));
          reconcileDirtyTrackedEditorRows([rowId]);
          render?.({ scope: "translate-sidebar" });
        }
        showNoticeBadge(message || "The row could not be saved.", render);
        return;
      }
    }
  })();

  pendingEditorRowPersistByRowId.set(rowId, persistPromise);
  try {
    await persistPromise;
  } finally {
    pendingEditorRowPersistByRowId.delete(rowId);
  }
}
