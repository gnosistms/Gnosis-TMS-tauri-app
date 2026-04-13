import {
  applyInsertedEditorRowState,
  applyPermanentlyDeletedEditorRowState,
  applyRestoredEditorRowState,
  applySoftDeletedEditorRowState,
  cancelEditorRowPermanentDeletionModalState,
  cancelInsertEditorRowModalState,
  openEditorRowPermanentDeletionModalState,
  openInsertEditorRowModalState,
  toggleDeletedEditorRowGroupState,
} from "./editor-row-structure-state.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import {
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { canPermanentlyDeleteProjectFiles } from "./resource-capabilities.js";
import { findEditorRowById } from "./editor-utils.js";
import { ensureEditorRowReadyForWrite } from "./editor-row-sync-flow.js";

function hasRowStructureOperations(operations) {
  return (
    typeof operations?.applyStructuralEditorChange === "function"
    && typeof operations?.applyEditorSelectionsToProjectState === "function"
  );
}

export function openInsertEditorRowModal(rowId) {
  state.editorChapter = openInsertEditorRowModalState(state.editorChapter, rowId);
}

export function cancelInsertEditorRowModal() {
  state.editorChapter = cancelInsertEditorRowModalState(state.editorChapter);
}

export function openEditorRowPermanentDeletionModal(rowId) {
  state.editorChapter = openEditorRowPermanentDeletionModalState(state.editorChapter, rowId);
}

export function cancelEditorRowPermanentDeletionModal() {
  state.editorChapter = cancelEditorRowPermanentDeletionModalState(state.editorChapter);
}

export function toggleDeletedEditorRowGroup(render, groupId, anchorSnapshot = null, operations = {}) {
  if (!groupId || !state.editorChapter?.chapterId || !hasRowStructureOperations(operations)) {
    return;
  }

  operations.applyStructuralEditorChange(render, () => {
    state.editorChapter = toggleDeletedEditorRowGroupState(state.editorChapter, groupId);
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
      state.editorChapter = applyInsertedEditorRowState(
        state.editorChapter,
        payload?.row,
        modal.rowId,
        position === "before",
        payload?.sourceWordCounts,
      );
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

  const row = await ensureEditorRowReadyForWrite(render, rowId, { structural: true });
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

    const result = applySoftDeletedEditorRowState(
      state.editorChapter,
      rowId,
      payload?.lifecycleState ?? "deleted",
      payload?.sourceWordCounts,
      triggerAnchorSnapshot,
    );
    operations.applyStructuralEditorChange(render, () => {
      state.editorChapter = result.chapterState;
      operations.applyEditorSelectionsToProjectState(state.editorChapter);
    }, {
      anchorSnapshot: result.anchorSnapshot,
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

  if (!(await ensureEditorRowReadyForWrite(render, rowId, { structural: true }))) {
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
      state.editorChapter = applyRestoredEditorRowState(
        state.editorChapter,
        rowId,
        payload?.lifecycleState ?? "active",
        payload?.sourceWordCounts,
      );
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

  if (!(await ensureEditorRowReadyForWrite(render, modal.rowId, { structural: true }))) {
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
      state.editorChapter = applyPermanentlyDeletedEditorRowState(
        state.editorChapter,
        modal.rowId,
        payload?.sourceWordCounts,
      );
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
  if (!(await ensureEditorRowReadyForWrite(render, modal.rowId, { structural: true }))) {
    return;
  }
