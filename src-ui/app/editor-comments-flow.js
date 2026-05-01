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
import { normalizeEditorSidebarTab } from "./editor-comments.js";
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
import { ensureEditorRowReadyForWrite } from "./editor-row-sync-flow.js";

function renderEditorCommentsSidebar(render) {
  render?.({ scope: "translate-sidebar" });
}

function renderEditorCommentsSidebarAndBody(render) {
  render?.({ scope: "translate-body" });
  renderEditorCommentsSidebar(render);
}

function persistSeenRevision(chapterId, rowId, commentsRevision) {
  const seenRevisions = saveStoredEditorCommentSeenRevision(chapterId, rowId, commentsRevision);
  state.editorChapter = applyEditorCommentSeenRevisions(state.editorChapter, seenRevisions);
}

function markRowCommentsSeen(rowId, commentsRevision) {
  if (!state.editorChapter?.chapterId || !rowId) {
    return false;
  }

  const previousRevision = Number.parseInt(
    String(state.editorChapter.commentSeenRevisions?.[rowId] ?? ""),
    10,
  );
  const nextRevision = Number.parseInt(String(commentsRevision ?? ""), 10);
  if (
    Number.isInteger(previousRevision)
    && Number.isInteger(nextRevision)
    && previousRevision >= nextRevision
  ) {
    return false;
  }

  state.editorChapter = applyEditorRowCommentSeen(state.editorChapter, rowId, commentsRevision);
  persistSeenRevision(state.editorChapter.chapterId, rowId, commentsRevision);
  return true;
}

function nextChapterBaseCommitSha(payload, chapterState = state.editorChapter) {
  return typeof payload?.chapterBaseCommitSha === "string" && payload.chapterBaseCommitSha.trim()
    ? payload.chapterBaseCommitSha.trim()
    : chapterState?.chapterBaseCommitSha ?? null;
}

async function ensureEditorRowReadyForCommentWrite(render, rowId) {
  const row = await ensureEditorRowReadyForWrite(render, rowId);
  if (!row) {
    return null;
  }

  if (
    row.saveStatus !== "idle"
    || row.markerSaveState?.status === "saving"
    || row.textStyleSaveState?.status === "saving"
  ) {
    showNoticeBadge("Finish saving the current row before changing comments.", render);
    return null;
  }

  return row;
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
    renderEditorCommentsSidebarAndBody(render);
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
    renderEditorCommentsSidebar(render);
  }
}

export function loadActiveEditorRowComments(render) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !editorChapter.activeRowId) {
    return;
  }

  const requestKey = buildEditorCommentsRequestKey(editorChapter.chapterId, editorChapter.activeRowId);
  state.editorChapter = applyEditorCommentsLoading(editorChapter, editorChapter.activeRowId);
  renderEditorCommentsSidebar(render);
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

  const currentRow = findEditorRowById(rowId, state.editorChapter);
  const currentComments = currentEditorCommentsForRow(state.editorChapter, rowId);
  if (
    state.editorChapter.activeRowId === rowId
    && state.editorChapter.activeLanguageCode === languageCode
  ) {
    if (
      currentComments.status === "ready"
      && currentComments.commentsRevision === (currentRow?.commentsRevision ?? 0)
    ) {
      if (markRowCommentsSeen(rowId, currentComments.commentsRevision)) {
        renderEditorCommentsSidebarAndBody(render);
      }
      return;
    }

    if (currentComments.status === "loading") {
      return;
    }
  }

  state.editorChapter = applyEditorCommentsSelection(state.editorChapter, rowId, languageCode);
  const row = findEditorRowById(rowId, state.editorChapter);
  const comments = currentEditorCommentsForRow(state.editorChapter, rowId);

  if (
    comments.status === "ready"
    && comments.rowId === rowId
    && comments.commentsRevision === (row?.commentsRevision ?? 0)
  ) {
    const seenChanged = markRowCommentsSeen(rowId, comments.commentsRevision);
    if (seenChanged) {
      renderEditorCommentsSidebarAndBody(render);
    } else {
      renderEditorCommentsSidebar(render);
    }
    return;
  }

  if (comments.status === "loading" && comments.rowId === rowId) {
    renderEditorCommentsSidebar(render);
    return;
  }

  loadActiveEditorRowComments(render);
}

export function switchEditorSidebarTab(render, tab, operations = {}) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const normalizedTab = normalizeEditorSidebarTab(tab);
  state.editorChapter = applyEditorSidebarTab(state.editorChapter, normalizedTab);

  if (normalizedTab === "comments" && state.editorChapter.activeRowId) {
    const row = findEditorRowById(state.editorChapter.activeRowId, state.editorChapter);
    const comments = currentEditorCommentsForRow(state.editorChapter, state.editorChapter.activeRowId);
    if (
      comments.status === "ready"
      && comments.commentsRevision === (row?.commentsRevision ?? 0)
    ) {
      const seenChanged = markRowCommentsSeen(
        state.editorChapter.activeRowId,
        comments.commentsRevision,
      );
      if (seenChanged) {
        renderEditorCommentsSidebarAndBody(render);
      } else {
        renderEditorCommentsSidebar(render);
      }
      return;
    }

    loadActiveEditorRowComments(render);
    return;
  }

  if (
    (normalizedTab === "history" || normalizedTab === "review")
    && typeof operations?.loadActiveEditorFieldHistory === "function"
  ) {
    operations.loadActiveEditorFieldHistory(render);
    return;
  }

  renderEditorCommentsSidebar(render);
  if (
    normalizedTab === "assistant"
    && typeof operations?.scheduleAssistantTranscriptScrollToBottom === "function"
  ) {
    operations.scheduleAssistantTranscriptScrollToBottom();
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

  if (!(await ensureEditorRowReadyForCommentWrite(render, rowId))) {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = applyEditorCommentSaving(editorChapter);
  renderEditorCommentsSidebar(render);

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

    state.editorChapter = {
      ...applyEditorCommentSaveSucceeded(state.editorChapter, rowId, payload),
      chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
    };
    markRowCommentsSeen(rowId, payload?.commentsRevision ?? 0);
    renderEditorCommentsSidebarAndBody(render);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId && state.editorChapter.activeRowId === rowId) {
      state.editorChapter = applyEditorCommentSaveFailed(state.editorChapter, message);
      renderEditorCommentsSidebar(render);
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

  if (!(await ensureEditorRowReadyForCommentWrite(render, rowId))) {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = applyEditorCommentDeleting(editorChapter, commentId);
  renderEditorCommentsSidebar(render);

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

    state.editorChapter = {
      ...applyEditorCommentDeleteSucceeded(state.editorChapter, rowId, payload),
      chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
    };
    markRowCommentsSeen(rowId, payload?.commentsRevision ?? 0);
    renderEditorCommentsSidebarAndBody(render);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId && state.editorChapter.activeRowId === rowId) {
      state.editorChapter = applyEditorCommentDeleteFailed(state.editorChapter, message);
      renderEditorCommentsSidebar(render);
    }
    showNoticeBadge(message || "The comment could not be deleted.", render);
  }
}
