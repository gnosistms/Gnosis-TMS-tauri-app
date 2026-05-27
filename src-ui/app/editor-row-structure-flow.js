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
import {
  createEditorRegressionInsertedRow,
  isEditorRegressionFixtureState,
} from "./editor-regression-fixture.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import {
  captureTranslateAnchorForRow,
} from "./scroll-state.js";
import {
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { addLocalHardDeleteTombstone } from "./local-hard-delete-store.js";
import { getProjectWritePolicy } from "./resource-write-policy.js";
import { ensureEditorRowReadyForWrite } from "./editor-row-sync-flow.js";
import { invokeEditorWriteCommand } from "./editor-write-permission.js";
import { requestEditorOperation } from "./editor-operation-queue.js";
import {
  assertQueuedEditorRowsReady,
  createQueuedEditorWritePermissionContext,
  editorChapterInvalidationKey,
  invokeQueuedEditorWriteCommand,
} from "./editor-queued-write.js";
import { projectRepoScope } from "./repo-write-queue.js";

function hasRowStructureOperations(operations) {
  return (
    typeof operations?.applyStructuralEditorChange === "function"
    && typeof operations?.applyEditorSelectionsToProjectState === "function"
  );
}

function nextChapterBaseCommitSha(chapterState, payload = null) {
  return typeof payload?.chapterBaseCommitSha === "string" && payload.chapterBaseCommitSha.trim()
    ? payload.chapterBaseCommitSha.trim()
    : chapterState?.chapterBaseCommitSha ?? null;
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

  if (isEditorRegressionFixtureState(state)) {
    const nextRow = createEditorRegressionInsertedRow(editorChapter);
    if (!nextRow?.rowId) {
      return;
    }

    operations.applyStructuralEditorChange(render, () => {
      state.editorChapter = applyInsertedEditorRowState(
        state.editorChapter,
        nextRow,
        modal.rowId,
        position === "before",
      );
      operations.applyEditorSelectionsToProjectState(state.editorChapter);
    }, {
      anchorSnapshot: {
        type: "row",
        rowId: nextRow.rowId,
        languageCode: null,
        offsetTop: 80,
      },
      reloadHistory: true,
    });
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
    const payload = await invokeEditorWriteCommand(
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
      { render, actionKind: "sharedWrite", rowId: modal.rowId },
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
    const chapterBaseCommitSha = nextChapterBaseCommitSha(state.editorChapter, payload);

    operations.applyStructuralEditorChange(render, () => {
      state.editorChapter = {
        ...applyInsertedEditorRowState(
          state.editorChapter,
          payload?.row,
          modal.rowId,
          position === "before",
          payload?.sourceWordCounts,
        ),
        chapterBaseCommitSha,
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

  if (isEditorRegressionFixtureState(state)) {
    const result = applySoftDeletedEditorRowState(
      state.editorChapter,
      rowId,
      "deleted",
      null,
      triggerAnchorSnapshot,
    );
    operations.applyStructuralEditorChange(render, () => {
      state.editorChapter = result.chapterState;
      operations.applyEditorSelectionsToProjectState(state.editorChapter);
    }, {
      anchorSnapshot: result.anchorSnapshot,
    });
    return;
  }

  const row = await ensureEditorRowReadyForWrite(render, rowId, { structural: true });
  if (!row || (row.saveStatus !== "idle" && row.saveStatus !== "saving")) {
    showNoticeBadge("Save the current row before deleting it.", render);
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  const repoScope = projectRepoScope({ team, project: context?.project ?? null });
  if (!Number.isFinite(team?.installationId) || !context?.project?.name || !repoScope) {
    return;
  }

  const operationValue = {
    input: {
      installationId: team.installationId,
      projectId: context.project.id,
      repoName: context.project.name,
      chapterId: editorChapter.chapterId,
      rowId,
    },
    chapterId: editorChapter.chapterId,
    rowId,
    triggerAnchorSnapshot,
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
    rowScope: `${repoScope}:${editorChapter.chapterId}:${rowId}`,
    kind: "softDeleteRow",
    value: operationValue,
    metadata: {
      projectId: context.project.id,
      chapterId: editorChapter.chapterId,
      rowId,
    },
    invalidationKeys: [editorChapterInvalidationKey(repoScope, editorChapter.chapterId)],
  }, {
    run: async (operation) => {
      assertQueuedEditorRowsReady({
        chapterId: operation.value.chapterId,
        rowIds: [operation.value.rowId],
        forbidPendingText: true,
        message: "Save, refresh, or resolve the row before deleting it.",
      });
      return invokeQueuedEditorWriteCommand("soft_delete_gtms_editor_row", {
        input: {
          ...operation.value.input,
        },
      }, operation.value.permissionContext, render);
    },
    onSuccess: (payload, operation) => {
      const value = operation?.value ?? operationValue;
      if (state.editorChapter?.chapterId !== value.chapterId) {
        return;
      }

      const result = applySoftDeletedEditorRowState(
        state.editorChapter,
        value.rowId,
        payload?.lifecycleState ?? "deleted",
        payload?.sourceWordCounts,
        value.triggerAnchorSnapshot,
      );
      const chapterBaseCommitSha = nextChapterBaseCommitSha(state.editorChapter, payload);
      operations.applyStructuralEditorChange(render, () => {
        state.editorChapter = {
          ...result.chapterState,
          chapterBaseCommitSha,
        };
        operations.applyEditorSelectionsToProjectState(state.editorChapter);
      }, {
        anchorSnapshot: result.anchorSnapshot,
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      showNoticeBadge(message || "The row could not be deleted.", render);
    },
  });
  requested.promise.catch(() => {});
}

export async function restoreEditorRow(render, rowId, operations = {}) {
  if (!hasRowStructureOperations(operations)) {
    return;
  }

  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !rowId) {
    return;
  }

  if (isEditorRegressionFixtureState(state)) {
    const triggerAnchorSnapshot = captureTranslateAnchorForRow(rowId);
    const result = applyRestoredEditorRowState(
      state.editorChapter,
      rowId,
      "active",
      null,
      triggerAnchorSnapshot,
    );
    operations.applyStructuralEditorChange(render, () => {
      state.editorChapter = result.chapterState;
      operations.applyEditorSelectionsToProjectState(state.editorChapter);
    }, {
      anchorSnapshot: result.anchorSnapshot,
    });
    return;
  }

  if (!(await ensureEditorRowReadyForWrite(render, rowId, { structural: true, actionKind: "restoreRow" }))) {
    return;
  }

  const triggerAnchorSnapshot = captureTranslateAnchorForRow(rowId);

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  const repoScope = projectRepoScope({ team, project: context?.project ?? null });
  if (!Number.isFinite(team?.installationId) || !context?.project?.name || !repoScope) {
    return;
  }

  const row = Array.isArray(editorChapter.rows)
    ? editorChapter.rows.find((item) => item?.rowId === rowId || item?.id === rowId)
    : null;
  const operationValue = {
    input: {
      installationId: team.installationId,
      projectId: context.project.id,
      repoName: context.project.name,
      chapterId: editorChapter.chapterId,
      rowId,
    },
    chapterId: editorChapter.chapterId,
    rowId,
    triggerAnchorSnapshot,
    permissionContext: createQueuedEditorWritePermissionContext({
      team,
      project: context.project,
      chapter: context.chapter,
      row,
      actionKind: "restoreRow",
    }),
  };

  const requested = requestEditorOperation({
    repoScope,
    chapterScope: `${repoScope}:${editorChapter.chapterId}`,
    rowScope: `${repoScope}:${editorChapter.chapterId}:${rowId}`,
    kind: "restoreRow",
    value: operationValue,
    metadata: {
      projectId: context.project.id,
      chapterId: editorChapter.chapterId,
      rowId,
    },
    invalidationKeys: [editorChapterInvalidationKey(repoScope, editorChapter.chapterId)],
  }, {
    run: async (operation) => invokeQueuedEditorWriteCommand("restore_gtms_editor_row", {
      input: {
        ...operation.value.input,
      },
    }, operation.value.permissionContext, render),
    onSuccess: (payload, operation) => {
      const value = operation?.value ?? operationValue;
      if (state.editorChapter?.chapterId !== value.chapterId) {
        return;
      }

      const result = applyRestoredEditorRowState(
        state.editorChapter,
        value.rowId,
        payload?.lifecycleState ?? "active",
        payload?.sourceWordCounts,
        value.triggerAnchorSnapshot,
      );
      const chapterBaseCommitSha = nextChapterBaseCommitSha(state.editorChapter, payload);
      operations.applyStructuralEditorChange(render, () => {
        state.editorChapter = {
          ...result.chapterState,
          chapterBaseCommitSha,
        };
        operations.applyEditorSelectionsToProjectState(state.editorChapter);
      }, {
        anchorSnapshot: result.anchorSnapshot,
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      showNoticeBadge(message || "The row could not be restored.", render);
    },
  });
  requested.promise.catch(() => {});
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

  if (isEditorRegressionFixtureState(state)) {
    const triggerAnchorSnapshot = captureTranslateAnchorForRow(modal.rowId);
    const result = applyPermanentlyDeletedEditorRowState(
      state.editorChapter,
      modal.rowId,
      null,
      triggerAnchorSnapshot,
    );
    operations.applyStructuralEditorChange(render, () => {
      state.editorChapter = result.chapterState;
      operations.applyEditorSelectionsToProjectState(state.editorChapter);
    }, {
      anchorSnapshot: result.anchorSnapshot,
    });
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  const row = Array.isArray(editorChapter.rows)
    ? editorChapter.rows.find((item) => item?.rowId === modal.rowId || item?.id === modal.rowId)
    : null;
  if (!team || !context?.project?.name || !row) {
    return;
  }
  if (row.lifecycleState !== "deleted") {
    state.editorChapter = {
      ...editorChapter,
      rowPermanentDeletionModal: {
        ...modal,
        error: "Only deleted rows can be removed locally.",
      },
    };
    render?.();
    return;
  }

  const policy = getProjectWritePolicy({
    team,
    project: context.project,
    chapter: context.chapter,
    row,
    actionKind: "localHardDelete",
  });
  if (!policy.allowed) {
    state.editorChapter = {
      ...editorChapter,
      rowPermanentDeletionModal: {
        ...modal,
        error: policy.message,
      },
    };
    render?.();
    return;
  }

  addLocalHardDeleteTombstone(team, "editorRow", {
    ...row,
    id: row.rowId ?? row.id,
    repoName: context.project.name,
  });
  const triggerAnchorSnapshot = captureTranslateAnchorForRow(modal.rowId);
  const result = applyPermanentlyDeletedEditorRowState(
    editorChapter,
    modal.rowId,
    null,
    triggerAnchorSnapshot,
  );
  operations.applyStructuralEditorChange(render, () => {
    state.editorChapter = result.chapterState;
    operations.applyEditorSelectionsToProjectState(state.editorChapter);
  }, {
    anchorSnapshot: result.anchorSnapshot,
  });
  showNoticeBadge("Row removed locally.", render, 2200);
}
