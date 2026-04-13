import {
  deletedRowGroupIdAfterSoftDelete,
  expandedDeletedRowGroupIdsAfterPermanentDelete,
  expandedDeletedRowGroupIdsAfterRestore,
  expandedDeletedRowGroupIdsAfterSoftDelete,
} from "./editor-deleted-rows.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-chapter-flow.js";
import { invoke } from "./runtime.js";
import {
  createEditorHistoryState,
  createEditorInsertRowModalState,
  createEditorRowPermanentDeletionModalState,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { canPermanentlyDeleteProjectFiles } from "./resource-capabilities.js";
import { findEditorRowById, hasEditorRow } from "./editor-utils.js";

function hasRowStructureOperations(operations) {
  return (
    typeof operations?.updateEditorChapterRow === "function"
    && typeof operations?.insertEditorChapterRow === "function"
    && typeof operations?.removeEditorChapterRow === "function"
    && typeof operations?.applyStructuralEditorChange === "function"
    && typeof operations?.rowsWithEditorRowLifecycleState === "function"
    && typeof operations?.applyEditorSelectionsToProjectState === "function"
  );
}

export function openInsertEditorRowModal(rowId) {
  if (!rowId || !hasEditorRow(state.editorChapter, rowId)) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    insertRowModal: {
      ...createEditorInsertRowModalState(),
      isOpen: true,
      rowId,
    },
  };
}

export function cancelInsertEditorRowModal() {
  state.editorChapter = {
    ...state.editorChapter,
    insertRowModal: createEditorInsertRowModalState(),
  };
}

export function openEditorRowPermanentDeletionModal(rowId) {
  if (!rowId || !hasEditorRow(state.editorChapter, rowId)) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    rowPermanentDeletionModal: {
      ...createEditorRowPermanentDeletionModalState(),
      isOpen: true,
      rowId,
    },
  };
}

export function cancelEditorRowPermanentDeletionModal() {
  state.editorChapter = {
    ...state.editorChapter,
    rowPermanentDeletionModal: createEditorRowPermanentDeletionModalState(),
  };
}

export function toggleDeletedEditorRowGroup(render, groupId, anchorSnapshot = null, operations = {}) {
  if (!groupId || !state.editorChapter?.chapterId || !hasRowStructureOperations(operations)) {
    return;
  }

  operations.applyStructuralEditorChange(render, () => {
    const expandedDeletedRowGroupIds =
      state.editorChapter?.expandedDeletedRowGroupIds instanceof Set
        ? new Set(state.editorChapter.expandedDeletedRowGroupIds)
        : new Set();
    if (expandedDeletedRowGroupIds.has(groupId)) {
      expandedDeletedRowGroupIds.delete(groupId);
    } else {
      expandedDeletedRowGroupIds.add(groupId);
    }
    state.editorChapter = {
      ...state.editorChapter,
      expandedDeletedRowGroupIds,
    };
  }, { anchorSnapshot });
}

export async function confirmInsertEditorRow(render, position, operations = {}) {
  if (!hasRowStructureOperations(operations)) {
    return;
  }

  const editorChapter = state.editorChapter;
  const modal = editorChapter?.insertRowModal;
  if (!editorChapter?.chapterId || !modal?.isOpen || !modal.rowId) {
    return;
  }
  if (position !== "before" && position !== "after") {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = {
    ...editorChapter,
    insertRowModal: {
      ...modal,
      status: "loading",
      error: "",
    },
  };
  render?.();

  try {
    const payload = await invoke(
      position === "before" ? "insert_gtms_editor_row_before" : "insert_gtms_editor_row_after",
      {
        input: {
          installationId: team.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId: editorChapter.chapterId,
          rowId: modal.rowId,
        },
      },
    );

    if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
      return;
    }

    const insertedRowId = typeof payload?.row?.rowId === "string" ? payload.row.rowId : null;
    const insertAnchorSnapshot = insertedRowId
      ? {
        type: "row",
        rowId: insertedRowId,
        languageCode: null,
        offsetTop: 80,
      }
      : null;

    operations.applyStructuralEditorChange(render, () => {
      operations.insertEditorChapterRow(payload?.row, modal.rowId, position === "before");
      state.editorChapter = {
        ...state.editorChapter,
        sourceWordCounts:
          payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
            ? payload.sourceWordCounts
            : state.editorChapter.sourceWordCounts,
        insertRowModal: createEditorInsertRowModalState(),
        activeRowId: payload?.row?.rowId ?? state.editorChapter.activeRowId,
        activeLanguageCode:
          state.editorChapter.activeLanguageCode
          ?? state.editorChapter.selectedTargetLanguageCode
          ?? state.editorChapter.selectedSourceLanguageCode
          ?? null,
      };
      operations.applyEditorSelectionsToProjectState(state.editorChapter);
    }, {
      anchorSnapshot: insertAnchorSnapshot,
      reloadHistory: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      state.editorChapter = {
        ...state.editorChapter,
        insertRowModal: {
          ...state.editorChapter.insertRowModal,
          status: "idle",
          error: message,
        },
      };
      render?.();
    }
    showNoticeBadge(message || "The row could not be inserted.", render);
  }
}

export async function softDeleteEditorRow(render, rowId, triggerAnchorSnapshot = null, operations = {}) {
  if (!hasRowStructureOperations(operations)) {
    return;
  }

  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !rowId) {
    return;
  }

  const row = findEditorRowById(rowId, editorChapter);
  if (!row || row.saveStatus !== "idle" || row.markerSaveState?.status === "saving") {
    showNoticeBadge("Save the current row before deleting it.", render);
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  try {
    const payload = await invoke("soft_delete_gtms_editor_row", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
      },
    });

    if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
      return;
    }

    const previousRows = state.editorChapter.rows;
    const nextRows = operations.rowsWithEditorRowLifecycleState(
      previousRows,
      rowId,
      payload?.lifecycleState ?? "deleted",
    );
    const expandedDeletedRowGroupIds = expandedDeletedRowGroupIdsAfterSoftDelete(
      previousRows,
      rowId,
      state.editorChapter.expandedDeletedRowGroupIds,
      nextRows,
    );
    const nextDeletedGroupId = deletedRowGroupIdAfterSoftDelete(previousRows, rowId);
    const nextDeletedGroupIsOpen =
      typeof nextDeletedGroupId === "string" && expandedDeletedRowGroupIds.has(nextDeletedGroupId);
    const anchorSnapshot = nextDeletedGroupId && !nextDeletedGroupIsOpen
      ? {
        type: "deleted-group",
        rowId: `deleted-group:${nextDeletedGroupId}`,
        languageCode: null,
        offsetTop: Number.isFinite(Number(triggerAnchorSnapshot?.offsetTop))
          ? Number(triggerAnchorSnapshot.offsetTop)
          : 80,
      }
      : {
        type: "row",
        rowId,
        languageCode: null,
        offsetTop: Number.isFinite(Number(triggerAnchorSnapshot?.offsetTop))
          ? Number(triggerAnchorSnapshot.offsetTop)
          : 80,
      };
    operations.applyStructuralEditorChange(render, () => {
      operations.updateEditorChapterRow(rowId, (currentRow) => ({
        ...currentRow,
        lifecycleState: payload?.lifecycleState ?? "deleted",
      }));
      state.editorChapter = {
        ...state.editorChapter,
        expandedDeletedRowGroupIds,
        sourceWordCounts:
          payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
            ? payload.sourceWordCounts
            : state.editorChapter.sourceWordCounts,
        activeRowId: state.editorChapter.activeRowId === rowId ? null : state.editorChapter.activeRowId,
        activeLanguageCode:
          state.editorChapter.activeRowId === rowId ? null : state.editorChapter.activeLanguageCode,
        history:
          state.editorChapter.activeRowId === rowId
            ? createEditorHistoryState()
            : state.editorChapter.history,
      };
      operations.applyEditorSelectionsToProjectState(state.editorChapter);
    }, {
      anchorSnapshot,
    });
    showNoticeBadge("Row deleted.", render);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNoticeBadge(message || "The row could not be deleted.", render);
  }
}

export async function restoreEditorRow(render, rowId, operations = {}) {
  if (!hasRowStructureOperations(operations)) {
    return;
  }

  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !rowId) {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  try {
    const payload = await invoke("restore_gtms_editor_row", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
      },
    });

    if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
      return;
    }

    operations.applyStructuralEditorChange(render, () => {
      const previousRows = state.editorChapter.rows;
      operations.updateEditorChapterRow(rowId, (currentRow) => ({
        ...currentRow,
        lifecycleState: payload?.lifecycleState ?? "active",
      }));
      const expandedDeletedRowGroupIds = expandedDeletedRowGroupIdsAfterRestore(
        previousRows,
        rowId,
        state.editorChapter.expandedDeletedRowGroupIds,
        state.editorChapter.rows,
      );
      state.editorChapter = {
        ...state.editorChapter,
        expandedDeletedRowGroupIds,
        sourceWordCounts:
          payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
            ? payload.sourceWordCounts
            : state.editorChapter.sourceWordCounts,
      };
      operations.applyEditorSelectionsToProjectState(state.editorChapter);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNoticeBadge(message || "The row could not be restored.", render);
  }
}

export async function confirmEditorRowPermanentDeletion(render, operations = {}) {
  if (!hasRowStructureOperations(operations)) {
    return;
  }

  const editorChapter = state.editorChapter;
  const modal = editorChapter?.rowPermanentDeletionModal;
  if (!editorChapter?.chapterId || !modal?.isOpen || !modal.rowId) {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }
  if (!canPermanentlyDeleteProjectFiles(team)) {
    state.editorChapter = {
      ...editorChapter,
      rowPermanentDeletionModal: {
        ...modal,
        error: "You do not have permission to permanently delete rows in this team.",
      },
    };
    render?.();
    return;
  }

  state.editorChapter = {
    ...editorChapter,
    rowPermanentDeletionModal: {
      ...modal,
      status: "loading",
      error: "",
    },
  };
  render?.();

  try {
    const payload = await invoke("permanently_delete_gtms_editor_row", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId: modal.rowId,
      },
    });

    if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
      return;
    }

    operations.applyStructuralEditorChange(render, () => {
      const previousRows = state.editorChapter.rows;
      operations.removeEditorChapterRow(modal.rowId);
      const expandedDeletedRowGroupIds = expandedDeletedRowGroupIdsAfterPermanentDelete(
        previousRows,
        modal.rowId,
        state.editorChapter.expandedDeletedRowGroupIds,
        state.editorChapter.rows,
      );
      state.editorChapter = {
        ...state.editorChapter,
        expandedDeletedRowGroupIds,
        sourceWordCounts:
          payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
            ? payload.sourceWordCounts
            : state.editorChapter.sourceWordCounts,
        rowPermanentDeletionModal: createEditorRowPermanentDeletionModalState(),
      };
      operations.applyEditorSelectionsToProjectState(state.editorChapter);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      state.editorChapter = {
        ...state.editorChapter,
        rowPermanentDeletionModal: {
          ...state.editorChapter.rowPermanentDeletionModal,
          status: "idle",
          error: message,
        },
      };
      render?.();
    }
    showNoticeBadge(message || "The row could not be permanently deleted.", render);
  }
}
