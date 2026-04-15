export const EDITOR_SIDEBAR_TABS = new Set(["translate", "history", "comments", "review"]);

export function normalizeEditorSidebarTab(tab) {
  return EDITOR_SIDEBAR_TABS.has(tab) ? tab : "review";
}

export function resolveEditorSidebarTabForField(currentTab, row, languageCode) {
  const normalizedCurrentTab = normalizeEditorSidebarTab(currentTab);
  const text =
    typeof row?.fields?.[languageCode] === "string"
      ? row.fields[languageCode]
      : String(row?.fields?.[languageCode] ?? "");
  return text.trim().length === 0 ? "translate" : normalizedCurrentTab;
}

export function normalizeEditorCommentSeenRevisions(seenRevisions) {
  return Object.fromEntries(
    Object.entries(seenRevisions && typeof seenRevisions === "object" ? seenRevisions : {})
      .map(([rowId, revision]) => [rowId, Number.parseInt(String(revision ?? ""), 10)])
      .filter(([rowId, revision]) => rowId && Number.isInteger(revision) && revision >= 0),
  );
}

export function sortEditorCommentsNewestFirst(entries) {
  return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const leftCreatedAt = typeof left?.createdAt === "string" ? left.createdAt : "";
    const rightCreatedAt = typeof right?.createdAt === "string" ? right.createdAt : "";
    if (rightCreatedAt !== leftCreatedAt) {
      return rightCreatedAt.localeCompare(leftCreatedAt);
    }

    const leftCommentId = typeof left?.commentId === "string" ? left.commentId : "";
    const rightCommentId = typeof right?.commentId === "string" ? right.commentId : "";
    return rightCommentId.localeCompare(leftCommentId);
  });
}

export function editorRowLastSeenCommentsRevision(rowId, seenRevisions) {
  const revisions = normalizeEditorCommentSeenRevisions(seenRevisions);
  const revision = revisions[rowId];
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

export function editorRowHasUnreadComments(row, seenRevisions) {
  const commentCount = Number.parseInt(String(row?.commentCount ?? ""), 10);
  const commentsRevision = Number.parseInt(String(row?.commentsRevision ?? ""), 10);
  if (!Number.isInteger(commentCount) || commentCount <= 0 || !Number.isInteger(commentsRevision) || commentsRevision <= 0) {
    return false;
  }

  return commentsRevision > editorRowLastSeenCommentsRevision(row?.rowId, seenRevisions);
}

export function buildEditorCommentsButtonState({
  row,
  languageCode,
  targetLanguageCode,
  seenRevisions,
}) {
  const showCommentsButton = Boolean(row?.rowId) && languageCode === targetLanguageCode;
  const commentCount = Number.parseInt(String(row?.commentCount ?? ""), 10);
  const hasComments = Number.isInteger(commentCount) && commentCount > 0;
  const hasUnreadComments = hasComments && editorRowHasUnreadComments(row, seenRevisions);

  return {
    showCommentsButton,
    hasComments,
    hasUnreadComments,
  };
}

export function editorCommentDraftCanSave(draft, status = "idle") {
  const normalizedDraft = typeof draft === "string" ? draft.trim() : "";
  return normalizedDraft.length > 0 && status !== "saving" && status !== "deleting";
}
