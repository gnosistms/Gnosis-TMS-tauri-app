import {
  applyEditorCommentDeleteFailed,
  applyEditorCommentDeleteSucceeded,
  applyEditorCommentDeleting,
  applyEditorCommentDraftChanged,
  applyEditorCommentSaveFailed,
  applyEditorCommentSaveSucceeded,
  applyEditorCommentSaving,
  applyEditorCommentsLoadFailed,
  applyEditorCommentsLoaded,
  applyEditorCommentsLoading,
  applyEditorCommentsSelection,
  applyEditorCommentSeenRevisions,
  applyEditorRowCommentSeen,
  applyEditorSidebarTab,
  buildEditorCommentsRequestKey,
  currentEditorCommentsForRow,
  currentEditorCommentsRequestMatches,
} from "./editor-comments-state.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import {
  loadStoredEditorCommentSeenRevisions,
  pruneStoredEditorCommentSeenRevisions,
  saveStoredEditorCommentSeenRevision,
} from "./editor-comment-preferences.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { findEditorRowById, hasEditorLanguage, hasEditorRow } from "./editor-utils.js";

function persistSeenRevision(chapterId, rowId, commentsRevision) {
  const seenRevisions = saveStoredEditorCommentSeenRevision(chapterId, rowId, commentsRevision);
  state.editorChapter = applyEditorCommentSeenRevisions(state.editorChapter, seenRevisions);
}

export function hydrateEditorCommentSeenRevisions(chapterId, rowIds = []) {
  const seenRevisions = pruneStoredEditorCommentSeenRevisions(chapterId, rowIds);
  state.editorChapter = applyEditorCommentSeenRevisions(state.editorChapter, seenRevisions);
}

function markRowCommentsSeen(rowId, commentsRevision) {
  if (!state.editorChapter?.chapterId || !rowId) {
    return;
  }

  state.editorChapter = applyEditorRowCommentSeen(state.editorChapter, rowId, commentsRevision);
  persistSeenRevision(state.editorChapter.chapterId, rowId, commentsRevision);
}

async function fetchEditorRowComments(render, requestKey) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !editorChapter.activeRowId) {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  const rowId = editorChapter.activeRowId;

  try {
    const payload = await invoke("load_gtms_editor_row_comments", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
      },
    });

    if (!currentEditorCommentsRequestMatches(state.editorChapter, editorChapter.chapterId, rowId, requestKey)) {
      return;
    }

    state.editorChapter = applyEditorCommentsLoaded(state.editorChapter, rowId, requestKey, payload);
    markRowCommentsSeen(rowId, payload?.commentsRevision ?? 0);
    render?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!currentEditorCommentsRequestMatches(state.editorChapter, editorChapter.chapterId, rowId, requestKey)) {
      return;
    }

    state.editorChapter = applyEditorCommentsLoadFailed(
      state.editorChapter,
      rowId,
      requestKey,
      message,
    );
    render?.();
  }
}

export function loadActiveEditorRowComments(render) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !editorChapter.activeRowId) {
    return;
  }

  const requestKey = buildEditorCommentsRequestKey(editorChapter.chapterId, editorChapter.activeRowId);
  state.editorChapter = applyEditorCommentsLoading(editorChapter, editorChapter.activeRowId);
  render?.();
  void fetchEditorRowComments(render, requestKey);
}

export function openEditorRowComments(render, rowId, languageCode) {
  if (
    !rowId
    || !languageCode
    || !hasEditorRow(state.editorChapter, rowId)
    || !hasEditorLanguage(state.editorChapter, languageCode)
  ) {
    return;
  }

  state.editorChapter = applyEditorCommentsSelection(state.editorChapter, rowId, languageCode);
  const row = findEditorRowById(rowId, state.editorChapter);
  const comments = currentEditorCommentsForRow(state.editorChapter, rowId);
  render?.();

  if (
    comments.status === "ready"
    && comments.rowId === rowId
    && comments.commentsRevision === (row?.commentsRevision ?? 0)
  ) {
    markRowCommentsSeen(rowId, comments.commentsRevision);
    render?.();
    return;
  }

  if (comments.status === "loading" && comments.rowId === rowId) {
    return;
  }

  loadActiveEditorRowComments(render);
}

export function switchEditorSidebarTab(render, tab, operations = {}) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const normalizedTab = tab === "comments" || tab === "duplicates" ? tab : "history";
  state.editorChapter = applyEditorSidebarTab(state.editorChapter, normalizedTab);
  render?.();

  if (normalizedTab === "comments" && state.editorChapter.activeRowId) {
    const row = findEditorRowById(state.editorChapter.activeRowId, state.editorChapter);
    const comments = currentEditorCommentsForRow(state.editorChapter, state.editorChapter.activeRowId);
    if (
      comments.status === "ready"
      && comments.commentsRevision === (row?.commentsRevision ?? 0)
    ) {
      markRowCommentsSeen(state.editorChapter.activeRowId, comments.commentsRevision);
      render?.();
      return;
    }

    loadActiveEditorRowComments(render);
    return;
  }

  if (normalizedTab === "history" && typeof operations?.loadActiveEditorFieldHistory === "function") {
    operations.loadActiveEditorFieldHistory(render);
  }
}

export function updateEditorCommentDraft(nextValue) {
  state.editorChapter = applyEditorCommentDraftChanged(state.editorChapter, nextValue);
}

export function loadEditorCommentSeenRevisionsForChapter(chapterId, rowIds = []) {
  const initialSeenRevisions = loadStoredEditorCommentSeenRevisions(chapterId);
  const validRowIdSet = new Set((Array.isArray(rowIds) ? rowIds : []).filter(Boolean));
  const prunedSeenRevisions = Object.fromEntries(
    Object.entries(initialSeenRevisions).filter(([rowId]) => validRowIdSet.has(rowId)),
  );
  const persistedSeenRevisions = pruneStoredEditorCommentSeenRevisions(chapterId, [...validRowIdSet]);
  return Object.keys(persistedSeenRevisions).length > 0 ? persistedSeenRevisions : prunedSeenRevisions;
}

export async function saveActiveEditorRowComment(render) {
  const editorChapter = state.editorChapter;
  const rowId = editorChapter?.activeRowId;
  const comments = editorChapter?.comments;
  const body = String(comments?.draft ?? "").trim();
  if (!editorChapter?.chapterId || !rowId || !body) {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = applyEditorCommentSaving(editorChapter);
  render?.();

  try {
    const payload = await invoke("save_gtms_editor_row_comment", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
        body,
      },
    });

    if (state.editorChapter?.chapterId !== editorChapter.chapterId || state.editorChapter.activeRowId !== rowId) {
      return;
    }

    state.editorChapter = applyEditorCommentSaveSucceeded(state.editorChapter, rowId, payload);
    markRowCommentsSeen(rowId, payload?.commentsRevision ?? 0);
    render?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId && state.editorChapter.activeRowId === rowId) {
      state.editorChapter = applyEditorCommentSaveFailed(state.editorChapter, message);
      render?.();
    }
    showNoticeBadge(message || "The comment could not be saved.", render);
  }
}

export async function deleteActiveEditorRowComment(render, commentId) {
  const editorChapter = state.editorChapter;
  const rowId = editorChapter?.activeRowId;
  if (!editorChapter?.chapterId || !rowId || !commentId) {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = applyEditorCommentDeleting(editorChapter, commentId);
  render?.();

  try {
    const payload = await invoke("delete_gtms_editor_row_comment", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
        commentId,
      },
    });

    if (state.editorChapter?.chapterId !== editorChapter.chapterId || state.editorChapter.activeRowId !== rowId) {
      return;
    }

    state.editorChapter = applyEditorCommentDeleteSucceeded(state.editorChapter, rowId, payload);
    markRowCommentsSeen(rowId, payload?.commentsRevision ?? 0);
    render?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId && state.editorChapter.activeRowId === rowId) {
      state.editorChapter = applyEditorCommentDeleteFailed(state.editorChapter, message);
      render?.();
    }
    showNoticeBadge(message || "The comment could not be deleted.", render);
  }
}
