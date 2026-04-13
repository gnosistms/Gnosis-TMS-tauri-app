import { historyEntryCanUndoReplace, reconcileExpandedEditorHistoryGroupKeys } from "./editor-history.js";
import { buildEditorReplaceUndoNotice, normalizeEditorReplaceUndoModalState } from "./editor-replace.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-chapter-flow.js";
import { invoke } from "./runtime.js";
import {
  createEditorHistoryState,
  createEditorReplaceUndoModalState,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  cloneRowFields,
  cloneRowFieldStates,
  findEditorRowById,
  hasActiveEditorField,
  hasEditorLanguage,
  hasEditorRow,
  normalizeFieldState,
} from "./editor-utils.js";

function buildEditorHistoryRequestKey(chapterId, rowId, languageCode) {
  if (!chapterId || !rowId || !languageCode) {
    return null;
  }

  return `${chapterId}:${rowId}:${languageCode}`;
}

export function cloneExpandedHistoryGroupKeys(expandedGroupKeys) {
  return expandedGroupKeys instanceof Set
    ? new Set(expandedGroupKeys)
    : new Set();
}

export function normalizeEditorHistoryState(history) {
  return {
    ...createEditorHistoryState(),
    ...(history && typeof history === "object" ? history : {}),
    rowId: typeof history?.rowId === "string" ? history.rowId : null,
    languageCode: typeof history?.languageCode === "string" ? history.languageCode : null,
    requestKey: typeof history?.requestKey === "string" ? history.requestKey : null,
    restoringCommitSha:
      typeof history?.restoringCommitSha === "string" ? history.restoringCommitSha : null,
    expandedGroupKeys: cloneExpandedHistoryGroupKeys(history?.expandedGroupKeys),
    entries: Array.isArray(history?.entries) ? history.entries : [],
  };
}

export function currentEditorHistoryForSelection(chapterState, rowId, languageCode) {
  const history = normalizeEditorHistoryState(chapterState?.history);
  if (history.rowId === rowId && history.languageCode === languageCode) {
    return history;
  }

  return createEditorHistoryState();
}

function currentHistoryRequestMatches(editorChapter, chapterId, rowId, languageCode, requestKey) {
  return (
    editorChapter?.chapterId === chapterId
    && editorChapter.activeRowId === rowId
    && editorChapter.activeLanguageCode === languageCode
    && editorChapter.history?.requestKey === requestKey
  );
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

    if (!currentHistoryRequestMatches(state.editorChapter, editorChapter.chapterId, rowId, languageCode, requestKey)) {
      return;
    }

    const previousHistory = normalizeEditorHistoryState(state.editorChapter.history);
    state.editorChapter = {
      ...state.editorChapter,
      history: {
        status: "ready",
        error: "",
        rowId,
        languageCode,
        requestKey,
        restoringCommitSha: null,
        expandedGroupKeys: reconcileExpandedEditorHistoryGroupKeys(
          previousHistory.entries,
          Array.isArray(payload?.entries) ? payload.entries : [],
          previousHistory.expandedGroupKeys,
        ),
        entries: Array.isArray(payload?.entries) ? payload.entries : [],
      },
    };
    render?.({ scope: "translate-sidebar" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!currentHistoryRequestMatches(state.editorChapter, editorChapter.chapterId, rowId, languageCode, requestKey)) {
      return;
    }

    state.editorChapter = {
      ...state.editorChapter,
      history: {
        ...normalizeEditorHistoryState(state.editorChapter.history),
        status: "error",
        error: message,
        rowId,
        languageCode,
        requestKey,
        restoringCommitSha: null,
        expandedGroupKeys: cloneExpandedHistoryGroupKeys(state.editorChapter.history?.expandedGroupKeys),
      },
    };
    render?.({ scope: "translate-sidebar" });
  }
}

export function loadActiveEditorFieldHistory(render) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !hasActiveEditorField(editorChapter)) {
    return;
  }

  const currentHistory = currentEditorHistoryForSelection(
    editorChapter,
    editorChapter.activeRowId,
    editorChapter.activeLanguageCode,
  );
  const requestKey = buildEditorHistoryRequestKey(
    editorChapter.chapterId,
    editorChapter.activeRowId,
    editorChapter.activeLanguageCode,
  );
  state.editorChapter = {
    ...editorChapter,
    history: {
      ...normalizeEditorHistoryState(editorChapter.history),
      status: "loading",
      error: "",
      rowId: editorChapter.activeRowId,
      languageCode: editorChapter.activeLanguageCode,
      requestKey,
      restoringCommitSha: null,
      expandedGroupKeys: cloneExpandedHistoryGroupKeys(currentHistory.expandedGroupKeys),
    },
  };
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

  const history = normalizeEditorHistoryState(state.editorChapter.history);
  const expandedGroupKeys = cloneExpandedHistoryGroupKeys(history.expandedGroupKeys);
  if (expandedGroupKeys.has(groupKey)) {
    expandedGroupKeys.delete(groupKey);
  } else {
    expandedGroupKeys.add(groupKey);
  }

  state.editorChapter = {
    ...state.editorChapter,
    history: {
      ...history,
      expandedGroupKeys,
    },
  };
}

export function hasPendingEditorRowWrites(chapterState = state.editorChapter) {
  return (Array.isArray(chapterState?.rows) ? chapterState.rows : []).some((row) =>
    row?.saveStatus !== "idle" || row?.markerSaveState?.status === "saving"
  );
}

export function currentActiveHistoryEntryByCommitSha(commitSha, chapterState = state.editorChapter) {
  if (!commitSha || !hasActiveEditorField(chapterState)) {
    return null;
  }

  const history = currentEditorHistoryForSelection(
    chapterState,
    chapterState.activeRowId,
    chapterState.activeLanguageCode,
  );
  return history.entries.find((entry) => entry?.commitSha === commitSha) ?? null;
}

export function openEditorReplaceUndoModal(commitSha) {
  const entry = currentActiveHistoryEntryByCommitSha(commitSha);
  if (!state.editorChapter?.chapterId || !historyEntryCanUndoReplace(entry)) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    replaceUndoModal: {
      ...createEditorReplaceUndoModalState(),
      isOpen: true,
      status: "idle",
      error: "",
      commitSha,
    },
  };
}

export function cancelEditorReplaceUndoModal() {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    replaceUndoModal: createEditorReplaceUndoModalState(),
  };
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

  const row = findEditorRowById(editorChapter.activeRowId, editorChapter);
  if (!row || row.saveStatus !== "idle" || row.markerSaveState?.status === "saving") {
    showNoticeBadge("Save the current row before restoring history.", render);
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = {
    ...editorChapter,
    history: {
      ...currentEditorHistoryForSelection(
        editorChapter,
        editorChapter.activeRowId,
        editorChapter.activeLanguageCode,
      ),
      status: "restoring",
      error: "",
      rowId: editorChapter.activeRowId,
      languageCode: editorChapter.activeLanguageCode,
      requestKey: buildEditorHistoryRequestKey(
        editorChapter.chapterId,
        editorChapter.activeRowId,
        editorChapter.activeLanguageCode,
      ),
      restoringCommitSha: commitSha,
    },
  };
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
      updateEditorChapterRow(editorChapter.activeRowId, (currentRow) => ({
        ...currentRow,
        fields: {
          ...cloneRowFields(currentRow.fields),
          [editorChapter.activeLanguageCode]: payload?.plainText ?? "",
        },
        fieldStates: {
          ...cloneRowFieldStates(currentRow.fieldStates),
          [editorChapter.activeLanguageCode]: normalizeFieldState({
            reviewed: payload?.reviewed,
            pleaseCheck: payload?.pleaseCheck,
          }),
        },
        persistedFields: {
          ...cloneRowFields(currentRow.persistedFields),
          [editorChapter.activeLanguageCode]: payload?.plainText ?? "",
        },
        persistedFieldStates: {
          ...cloneRowFieldStates(currentRow.persistedFieldStates),
          [editorChapter.activeLanguageCode]: normalizeFieldState({
            reviewed: payload?.reviewed,
            pleaseCheck: payload?.pleaseCheck,
          }),
        },
        saveStatus: "idle",
        saveError: "",
      }));

      state.editorChapter = {
        ...state.editorChapter,
        sourceWordCounts:
          payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
            ? payload.sourceWordCounts
            : state.editorChapter.sourceWordCounts,
        history: {
          ...normalizeEditorHistoryState(state.editorChapter.history),
          status: "idle",
          error: "",
          restoringCommitSha: null,
        },
      };
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
      state.editorChapter = {
        ...state.editorChapter,
        history: {
          ...normalizeEditorHistoryState(state.editorChapter.history),
          status: "ready",
          error: "",
          restoringCommitSha: null,
        },
      };
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

  if (!historyEntryCanUndoReplace(currentActiveHistoryEntryByCommitSha(modal.commitSha, editorChapter))) {
    state.editorChapter = {
      ...editorChapter,
      replaceUndoModal: {
        ...modal,
        status: "idle",
        error: "The selected batch replace history entry is no longer available.",
      },
    };
    render?.();
    return;
  }

  if (hasPendingEditorRowWrites(editorChapter)) {
    state.editorChapter = {
      ...editorChapter,
      replaceUndoModal: {
        ...modal,
        status: "idle",
        error: "Save or resolve current row edits before undoing a batch replace.",
      },
    };
    render?.();
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = {
    ...editorChapter,
    replaceUndoModal: {
      ...modal,
      status: "loading",
      error: "",
    },
  };
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
        markEditorRowsPersisted(updatedRows, payload?.sourceWordCounts);
      }
      state.editorChapter = {
        ...state.editorChapter,
        replaceUndoModal: createEditorReplaceUndoModalState(),
      };
      render?.();
      if (updatedRows.some((row) => row?.rowId === state.editorChapter.activeRowId)) {
        loadActiveEditorFieldHistory(render);
      }
      showNoticeBadge(buildEditorReplaceUndoNotice(updatedRows.length, skippedRowCount), render);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      state.editorChapter = {
        ...state.editorChapter,
        replaceUndoModal: {
          ...normalizeEditorReplaceUndoModalState(state.editorChapter.replaceUndoModal),
          status: "idle",
          error: message,
        },
      };
      render?.();
    }
  }
}
