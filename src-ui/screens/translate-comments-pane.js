import { editorCommentDraftCanSave } from "../app/editor-comments.js";
import { escapeHtml, primaryButton, textAction } from "../lib/ui.js";

function formatCommentTimestamp(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function canDeleteComment(comment, session) {
  const commentAuthorLogin = typeof comment?.authorLogin === "string" ? comment.authorLogin.trim().toLowerCase() : "";
  const sessionLogin = typeof session?.login === "string" ? session.login.trim().toLowerCase() : "";
  return Boolean(commentAuthorLogin) && commentAuthorLogin === sessionLogin;
}

function renderCommentEntry(comment, commentsState, session) {
  const isDeleting =
    commentsState?.status === "deleting" && commentsState?.deletingCommentId === comment?.commentId;
  const deleteAction = canDeleteComment(comment, session)
    ? textAction(isDeleting ? "Deleting..." : "Delete", `delete-editor-comment:${comment.commentId}`, {
      disabled: commentsState?.status === "deleting" || commentsState?.status === "saving",
    })
    : "";

  return `
    <article class="history-item">
      <p class="history-item__content">${escapeHtml(comment?.body ?? "")}</p>
      <div class="history-item__footer">
        <div class="history-item__actions">
          ${deleteAction}
        </div>
        <p class="history-item__meta">
          ${escapeHtml(comment?.authorName || comment?.authorLogin || "")}
          ${comment?.createdAt ? `, ${escapeHtml(formatCommentTimestamp(comment.createdAt))}` : ""}
        </p>
      </div>
    </article>
  `;
}

export function renderCommentsPane(editorChapter, rows, session) {
  const activeRow = rows.find((row) => row.id === editorChapter?.activeRowId) ?? null;
  const commentsState =
    editorChapter?.comments && typeof editorChapter.comments === "object"
      ? editorChapter.comments
      : {
          status: "idle",
          error: "",
          draft: "",
          entries: [],
        };
  const draft = typeof commentsState?.draft === "string" ? commentsState.draft : "";
  const canSaveComment = editorCommentDraftCanSave(draft, commentsState.status);

  if (!activeRow) {
    return `
      <div class="history-empty">
        <p>Select a translation to view comments.</p>
      </div>
    `;
  }

  const commentsBody = commentsState.status === "error"
    ? `
      <div class="history-empty">
        <p>${escapeHtml(commentsState.error || "Could not load comments for this row.")}</p>
      </div>
    `
    : commentsState.status === "loading"
      ? `
        <div class="history-empty">
          <p>Loading comments...</p>
        </div>
      `
      : Array.isArray(commentsState.entries) && commentsState.entries.length > 0
        ? `
          <div class="history-stack">
            ${commentsState.entries.map((comment) => renderCommentEntry(comment, commentsState, session)).join("")}
          </div>
        `
        : `
          <div class="history-empty">
            <p>No comments yet for this row.</p>
          </div>
        `;

  return `
    <div class="translate-comments-pane">
      ${commentsBody}
      <div class="translate-comments-composer">
        <textarea
          class="translate-comments-composer__field"
          data-editor-comment-draft
          placeholder="Add a comment"
          spellcheck="true"
        >${escapeHtml(draft)}</textarea>
        <div class="translate-comments-composer__actions">
          ${primaryButton(
            commentsState.status === "saving" ? "Saving..." : "Save comment",
            "save-editor-comment",
            {
              disabled: !canSaveComment,
            },
          )}
        </div>
      </div>
    </div>
  `;
}
