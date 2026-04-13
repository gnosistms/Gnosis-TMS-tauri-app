import { normalizeEditorCommentSeenRevisions, normalizeEditorSidebarTab, sortEditorCommentsNewestFirst } from "./editor-comments.js";
import { createEditorCommentsState } from "./state.js";

export function normalizeEditorCommentsState(comments) {
  return {
    ...createEditorCommentsState(),
    ...(comments && typeof comments === "object" ? comments : {}),
    rowId: typeof comments?.rowId === "string" ? comments.rowId : null,
    requestKey: typeof comments?.requestKey === "string" ? comments.requestKey : null,
    commentsRevision: Number.isInteger(comments?.commentsRevision) && comments.commentsRevision >= 0
      ? comments.commentsRevision
      : 0,
    entries: sortEditorCommentsNewestFirst(comments?.entries),
    draft: typeof comments?.draft === "string" ? comments.draft : "",
    deletingCommentId: typeof comments?.deletingCommentId === "string" ? comments.deletingCommentId : null,
  };
}

export function buildEditorCommentsRequestKey(chapterId, rowId) {
  if (!chapterId || !rowId) {
    return null;
  }

  return `${chapterId}:${rowId}`;
}

export function currentEditorCommentsForRow(chapterState, rowId) {
  const comments = normalizeEditorCommentsState(chapterState?.comments);
  if (comments.rowId === rowId) {
    return comments;
  }

  return createEditorCommentsState();
}

export function currentEditorCommentsRequestMatches(chapterState, chapterId, rowId, requestKey) {
  return (
    chapterState?.chapterId === chapterId
    && chapterState.activeRowId === rowId
    && chapterState.comments?.requestKey === requestKey
  );
}

export function applyEditorSidebarTab(chapterState, tab) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    sidebarTab: normalizeEditorSidebarTab(tab),
  };
}

export function applyEditorCommentSeenRevisions(chapterState, seenRevisions) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    commentSeenRevisions: normalizeEditorCommentSeenRevisions(seenRevisions),
  };
}

export function applyEditorCommentsSelection(chapterState, rowId, languageCode) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  const previousComments = normalizeEditorCommentsState(chapterState.comments);
  const nextComments = previousComments.rowId === rowId
    ? previousComments
    : createEditorCommentsState();

  return {
    ...chapterState,
    activeRowId: rowId,
    activeLanguageCode: languageCode,
    sidebarTab: "comments",
    comments: nextComments,
  };
}

export function applyEditorCommentsLoading(chapterState, rowId) {
  if (!chapterState?.chapterId || !rowId) {
    return chapterState;
  }

  const comments = currentEditorCommentsForRow(chapterState, rowId);
  return {
    ...chapterState,
    comments: {
      ...normalizeEditorCommentsState(comments),
      status: "loading",
      error: "",
      rowId,
      requestKey: buildEditorCommentsRequestKey(chapterState.chapterId, rowId),
      deletingCommentId: null,
    },
  };
}

export function applyEditorCommentsLoaded(chapterState, rowId, requestKey, payload) {
  if (!chapterState?.chapterId || !rowId) {
    return chapterState;
  }

  const previousComments = currentEditorCommentsForRow(chapterState, rowId);
  const commentsRevision = Number.parseInt(String(payload?.commentsRevision ?? ""), 10);
  return applyEditorRowCommentSummary({
    ...chapterState,
    comments: {
      ...createEditorCommentsState(),
      rowId,
      requestKey,
      status: "ready",
      commentsRevision: Number.isInteger(commentsRevision) && commentsRevision >= 0 ? commentsRevision : 0,
      entries: sortEditorCommentsNewestFirst(payload?.comments),
      draft: previousComments.draft,
    },
  }, rowId, payload);
}

export function applyEditorCommentsLoadFailed(chapterState, rowId, requestKey, message = "") {
  if (!chapterState?.chapterId || !rowId) {
    return chapterState;
  }

  const previousComments = currentEditorCommentsForRow(chapterState, rowId);
  return {
    ...chapterState,
    comments: {
      ...normalizeEditorCommentsState(previousComments),
      status: "error",
      error: message,
      rowId,
      requestKey,
      deletingCommentId: null,
    },
  };
}

export function applyEditorCommentDraftChanged(chapterState, draft) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    comments: {
      ...normalizeEditorCommentsState(chapterState.comments),
      draft: typeof draft === "string" ? draft : "",
    },
  };
}

export function applyEditorCommentSaving(chapterState) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    comments: {
      ...normalizeEditorCommentsState(chapterState.comments),
      status: "saving",
      error: "",
      deletingCommentId: null,
    },
  };
}

export function applyEditorCommentSaveSucceeded(chapterState, rowId, payload) {
  if (!chapterState?.chapterId || !rowId) {
    return chapterState;
  }

  return applyEditorRowCommentSummary({
    ...chapterState,
    comments: {
      ...createEditorCommentsState(),
      rowId,
      requestKey: buildEditorCommentsRequestKey(chapterState.chapterId, rowId),
      status: "ready",
      commentsRevision: Number.parseInt(String(payload?.commentsRevision ?? ""), 10) || 0,
      entries: sortEditorCommentsNewestFirst(payload?.comments),
      draft: "",
    },
  }, rowId, payload);
}

export function applyEditorCommentSaveFailed(chapterState, message = "") {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    comments: {
      ...normalizeEditorCommentsState(chapterState.comments),
      status: "error",
      error: message,
    },
  };
}

export function applyEditorCommentDeleting(chapterState, commentId) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    comments: {
      ...normalizeEditorCommentsState(chapterState.comments),
      status: "deleting",
      error: "",
      deletingCommentId: commentId,
    },
  };
}

export function applyEditorCommentDeleteSucceeded(chapterState, rowId, payload) {
  if (!chapterState?.chapterId || !rowId) {
    return chapterState;
  }

  return applyEditorRowCommentSummary({
    ...chapterState,
    comments: {
      ...createEditorCommentsState(),
      rowId,
      requestKey: buildEditorCommentsRequestKey(chapterState.chapterId, rowId),
      status: "ready",
      commentsRevision: Number.parseInt(String(payload?.commentsRevision ?? ""), 10) || 0,
      entries: sortEditorCommentsNewestFirst(payload?.comments),
      draft: normalizeEditorCommentsState(chapterState.comments).draft,
    },
  }, rowId, payload);
}

export function applyEditorCommentDeleteFailed(chapterState, message = "") {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    comments: {
      ...normalizeEditorCommentsState(chapterState.comments),
      status: "error",
      error: message,
      deletingCommentId: null,
    },
  };
}

export function applyEditorRowCommentSeen(chapterState, rowId, commentsRevision) {
  if (!chapterState?.chapterId || !rowId) {
    return chapterState;
  }

  const normalizedRevision = Number.parseInt(String(commentsRevision ?? ""), 10);
  if (!Number.isInteger(normalizedRevision) || normalizedRevision < 0) {
    return chapterState;
  }

  return {
    ...chapterState,
    commentSeenRevisions: {
      ...normalizeEditorCommentSeenRevisions(chapterState.commentSeenRevisions),
      [rowId]: normalizedRevision,
    },
  };
}

export function applyEditorRowCommentSummary(chapterState, rowId, summary) {
  if (!chapterState?.chapterId || !rowId || !Array.isArray(chapterState.rows)) {
    return chapterState;
  }

  const commentCount = Number.parseInt(String(summary?.commentCount ?? ""), 10);
  const commentsRevision = Number.parseInt(String(summary?.commentsRevision ?? ""), 10);
  return {
    ...chapterState,
    rows: chapterState.rows.map((row) =>
      row?.rowId === rowId
        ? {
          ...row,
          commentCount: Number.isInteger(commentCount) && commentCount >= 0 ? commentCount : 0,
          commentsRevision: Number.isInteger(commentsRevision) && commentsRevision >= 0 ? commentsRevision : 0,
        }
        : row
    ),
  };
}

export function pruneEditorCommentSeenRevisionsForRows(chapterState) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  const rowIds = new Set(
    (Array.isArray(chapterState.rows) ? chapterState.rows : [])
      .map((row) => row?.rowId)
      .filter(Boolean),
  );
  const prunedSeenRevisions = Object.fromEntries(
    Object.entries(normalizeEditorCommentSeenRevisions(chapterState.commentSeenRevisions))
      .filter(([rowId]) => rowIds.has(rowId)),
  );
  const comments = normalizeEditorCommentsState(chapterState.comments);
  return {
    ...chapterState,
    commentSeenRevisions: prunedSeenRevisions,
    comments:
      comments.rowId && !rowIds.has(comments.rowId)
        ? createEditorCommentsState()
        : comments,
  };
}
