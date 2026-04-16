import {
  EDITOR_ROW_FILTER_MODE_HAS_CONFLICT,
  EDITOR_ROW_FILTER_MODE_SHOW_ALL,
  normalizeEditorChapterFilterState,
} from "./editor-filters.js";
import {
  conflictedLanguageCodesForRow,
  editorChapterHasUnresolvedConflicts,
} from "./editor-conflicts.js";
import {
  applyEditorConflictResolutionSavedLocally,
  applyEditorRowConflictDetected,
  applyEditorRowConflictSaveSucceeded,
  applyEditorRowPersistSucceeded,
} from "./editor-persistence-state.js";
import { rowFieldsEqual } from "./editor-row-persistence-model.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import {
  createEditorConflictResolutionModalState,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { cloneRowFields, findEditorRowById } from "./editor-utils.js";

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

function resetConflictFilterIfClear() {
  if (!state.editorChapter?.chapterId || editorChapterHasUnresolvedConflicts(state.editorChapter)) {
    return;
  }

  const currentFilters = normalizeEditorChapterFilterState(state.editorChapter.filters);
  if (currentFilters.rowFilterMode === EDITOR_ROW_FILTER_MODE_SHOW_ALL) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    filters: {
      ...currentFilters,
      rowFilterMode: EDITOR_ROW_FILTER_MODE_SHOW_ALL,
    },
  };
}

function buildConflictResolutionModalState(row, languageCode) {
  const localText = row?.fields?.[languageCode] ?? "";
  const remoteText = row?.conflictState?.remoteRow?.fields?.[languageCode] ?? "";

  return {
    ...createEditorConflictResolutionModalState(),
    isOpen: true,
    rowId: row?.rowId ?? null,
    languageCode,
    localText,
    remoteText,
    finalText: remoteText,
    remoteVersion: row?.conflictState?.remoteVersion ?? null,
  };
}

function closeConflictResolutionModalState() {
  state.editorChapter = {
    ...state.editorChapter,
    conflictResolutionModal: createEditorConflictResolutionModalState(),
  };
}

function nextChapterBaseCommitSha(payload, chapterState = state.editorChapter) {
  return typeof payload?.chapterBaseCommitSha === "string" && payload.chapterBaseCommitSha.trim()
    ? payload.chapterBaseCommitSha.trim()
    : chapterState?.chapterBaseCommitSha ?? null;
}

function activeEditorMutationInput(rowId) {
  const team = selectedProjectsTeam();
  const context = findChapterContextById(state.editorChapter?.chapterId);
  if (!rowId || !Number.isFinite(team?.installationId) || !context?.project?.name || !context?.chapter?.id) {
    return null;
  }

  return {
    installationId: team.installationId,
    projectId: context.project.id,
    repoName: context.project.name,
    chapterId: context.chapter.id,
    rowId,
  };
}

async function loadLatestEditorRowSnapshot(rowId) {
  const input = activeEditorMutationInput(rowId);
  if (!input) {
    return null;
  }

  return invoke("load_gtms_editor_row", { input });
}

export function openEditorConflictResolutionModal(render, rowId, languageCode, operations = {}) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  const row = findEditorRowById(rowId, state.editorChapter);
  const conflictLanguageCodes = conflictedLanguageCodesForRow(row, state.editorChapter.languages);
  if (!row?.conflictState?.remoteRow || !conflictLanguageCodes.has(languageCode)) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: rowId,
    activeLanguageCode: languageCode,
    conflictResolutionModal: buildConflictResolutionModalState(row, languageCode),
  };
  render?.();
  if (typeof operations.loadActiveEditorFieldHistory === "function") {
    operations.loadActiveEditorFieldHistory(render);
  }
}

export function cancelEditorConflictResolutionModal(render) {
  if (!state.editorChapter?.conflictResolutionModal?.isOpen) {
    return;
  }

  closeConflictResolutionModalState();
  render?.();
}

export function updateEditorConflictResolutionFinalText(nextValue) {
  if (!state.editorChapter?.conflictResolutionModal?.isOpen) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    conflictResolutionModal: {
      ...state.editorChapter.conflictResolutionModal,
      finalText: typeof nextValue === "string" ? nextValue : String(nextValue ?? ""),
    },
  };
}

export async function copyEditorConflictResolutionVersion(render, side) {
  const modal = state.editorChapter?.conflictResolutionModal;
  if (!modal?.isOpen) {
    return;
  }

  const text = side === "local" ? modal.localText : side === "remote" ? modal.remoteText : "";
  if (!text) {
    return;
  }

  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    showNoticeBadge("Clipboard access is not available.", render, 1800);
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showNoticeBadge("Copied.", render, 1200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNoticeBadge(message || "The text could not be copied.", render, 1800);
  }
}

export async function saveEditorConflictResolution(render, operations = {}) {
  const modal = state.editorChapter?.conflictResolutionModal;
  if (!modal?.isOpen || modal.status === "loading") {
    return;
  }

  const rowId = modal.rowId ?? "";
  const languageCode = modal.languageCode ?? "";
  const input = activeEditorMutationInput(rowId);
  const row = findEditorRowById(rowId, state.editorChapter);
  const conflictLanguageCodes = conflictedLanguageCodesForRow(row, state.editorChapter.languages);
  if (!input || !row?.conflictState?.remoteRow || !conflictLanguageCodes.has(languageCode)) {
    return;
  }

  const remoteFields = cloneRowFields(row.conflictState.remoteRow.fields);
  const nextLocalFields = {
    ...cloneRowFields(row.fields),
    [languageCode]: typeof modal.finalText === "string" ? modal.finalText : String(modal.finalText ?? ""),
  };
  const fieldsToPersist = {
    ...remoteFields,
    [languageCode]: nextLocalFields[languageCode],
  };

  state.editorChapter = {
    ...state.editorChapter,
    conflictResolutionModal: {
      ...modal,
      status: "loading",
      error: "",
    },
  };
  render?.();

  let payload = null;
  try {
    payload = await invoke("update_gtms_editor_row_fields", {
      input: {
        ...input,
        fields: fieldsToPersist,
        baseFields: remoteFields,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId) {
      state.editorChapter = {
        ...state.editorChapter,
        conflictResolutionModal: {
          ...state.editorChapter.conflictResolutionModal,
          status: "idle",
          error: message || "The conflict could not be saved.",
        },
      };
      render?.();
    }
    return;
  }

  if (!state.editorChapter?.chapterId) {
    return;
  }

  let savedLocalRowPayload = null;
  if (payload?.status === "conflict") {
    if (payload?.row && rowFieldsEqual(fieldsToPersist, payload.row.fields)) {
      savedLocalRowPayload = payload.row;
    } else {
      const updatedRow =
        typeof operations.updateEditorChapterRow === "function"
          ? operations.updateEditorChapterRow(
            rowId,
            (currentRow) => applyEditorRowConflictDetected(currentRow, payload, {
              localFields: nextLocalFields,
            }),
          )
          : null;
      lockConflictFilter();
      state.editorChapter = {
        ...state.editorChapter,
        conflictResolutionModal: buildConflictResolutionModalState(
          updatedRow ?? findEditorRowById(rowId, state.editorChapter),
          languageCode,
        ),
      };
      render?.();
      showNoticeBadge("Translation text changed on GitHub again. Review the latest version.", render, 2400);
      return;
    }
  } else if (payload?.status === "deleted" || !payload?.row) {
    state.editorChapter = {
      ...state.editorChapter,
      conflictResolutionModal: {
        ...state.editorChapter.conflictResolutionModal,
        status: "idle",
        error: "This row was deleted on GitHub.",
      },
    };
    render?.();
    return;
  } else {
    savedLocalRowPayload = payload.row;
  }

  const locallySavedRow =
    typeof operations.updateEditorChapterRow === "function"
      ? operations.updateEditorChapterRow(
        rowId,
        (currentRow) => applyEditorConflictResolutionSavedLocally(
          currentRow,
          savedLocalRowPayload,
          nextLocalFields,
          {
            remoteVersion: currentRow?.conflictState?.remoteVersion ?? modal.remoteVersion ?? null,
          },
        ),
      )
      : null;
  state.editorChapter = {
    ...state.editorChapter,
    sourceWordCounts:
      payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
        ? payload.sourceWordCounts
        : state.editorChapter.sourceWordCounts,
    chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
  };
  if (typeof operations.applyEditorSelectionsToProjectState === "function") {
    operations.applyEditorSelectionsToProjectState(state.editorChapter);
  }
  if (typeof operations.reconcileDirtyTrackedEditorRows === "function") {
    operations.reconcileDirtyTrackedEditorRows([rowId]);
  }
  lockConflictFilter();
  render?.();

  const syncPayload =
    typeof operations.syncEditorBackgroundNow === "function"
      ? await operations.syncEditorBackgroundNow(render, {
        skipDirtyFlush: true,
        afterLocalCommit: true,
      })
      : null;

  if (!state.editorChapter?.chapterId) {
    return;
  }

  if (syncPayload === null) {
    state.editorChapter = {
      ...state.editorChapter,
      conflictResolutionModal: {
        ...state.editorChapter.conflictResolutionModal,
        status: "idle",
        error: "The conflict was saved locally, but the sync to GitHub did not complete. Try Save and finalize again.",
      },
    };
    render?.();
    return;
  }

  let finalRow = locallySavedRow ?? findEditorRowById(rowId, state.editorChapter);
  let latestRowPayload = null;
  let latestRowLoadFailed = false;
  try {
    latestRowPayload = await loadLatestEditorRowSnapshot(rowId);
  } catch {
    latestRowLoadFailed = true;
  }

  if (!state.editorChapter?.chapterId) {
    return;
  }

  if (latestRowPayload?.row) {
    const currentRow = findEditorRowById(rowId, state.editorChapter);
    if (currentRow && !rowFieldsEqual(currentRow.fields, latestRowPayload.row.fields)) {
      finalRow =
        typeof operations.updateEditorChapterRow === "function"
          ? operations.updateEditorChapterRow(
            rowId,
            (candidateRow) => applyEditorRowConflictDetected(candidateRow, {
              row: latestRowPayload.row,
              baseFields: cloneRowFields(latestRowPayload.row.fields),
              remoteVersion: latestRowPayload.rowVersion ?? null,
            }, {
              localFields: cloneRowFields(currentRow.fields),
            }),
          )
          : currentRow;
    } else if (currentRow && typeof operations.updateEditorChapterRow === "function") {
      finalRow = operations.updateEditorChapterRow(
        rowId,
        (candidateRow) => applyEditorRowPersistSucceeded(candidateRow, latestRowPayload.row),
      );
      if (typeof operations.reconcileDirtyTrackedEditorRows === "function") {
        operations.reconcileDirtyTrackedEditorRows([rowId]);
      }
    }
  } else if (latestRowLoadFailed && typeof operations.updateEditorChapterRow === "function") {
    finalRow = operations.updateEditorChapterRow(
      rowId,
      (currentRow) => applyEditorRowConflictSaveSucceeded(
        currentRow,
        savedLocalRowPayload,
        nextLocalFields,
        {
          remoteVersion: currentRow?.conflictState?.remoteVersion ?? modal.remoteVersion ?? null,
        },
      ),
    );
    showNoticeBadge("The row synced, but the latest version details could not be reloaded.", render, 2400);
  } else if (!latestRowPayload?.row) {
    state.editorChapter = {
      ...state.editorChapter,
      conflictResolutionModal: {
        ...state.editorChapter.conflictResolutionModal,
        status: "idle",
        error: "The latest row state could not be loaded.",
      },
    };
    render?.();
    return;
  }

  if (editorChapterHasUnresolvedConflicts(state.editorChapter)) {
    lockConflictFilter();
  } else {
    resetConflictFilterIfClear();
  }

  if (
    finalRow?.conflictState?.remoteRow
    && conflictedLanguageCodesForRow(finalRow, state.editorChapter.languages).has(languageCode)
  ) {
    state.editorChapter = {
      ...state.editorChapter,
      conflictResolutionModal: buildConflictResolutionModalState(finalRow, languageCode),
    };
    render?.();
    return;
  }

  closeConflictResolutionModalState();
  render?.();
  if (
    typeof operations.loadActiveEditorFieldHistory === "function"
    && state.editorChapter?.activeRowId === rowId
    && state.editorChapter?.activeLanguageCode === languageCode
  ) {
    operations.loadActiveEditorFieldHistory(render);
  }
}
