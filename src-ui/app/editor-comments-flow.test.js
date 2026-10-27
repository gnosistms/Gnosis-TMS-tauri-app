import test from "node:test";
import assert from "node:assert/strict";
import { installMockNavigator } from "../test/mock-navigator.mjs";

let invokeHandler;
globalThis.window = {
  __TAURI__: { core: { invoke: (...args) => invokeHandler(...args) } },
  setTimeout: () => 0, clearTimeout() {},
};
installMockNavigator({ platform: "MacIntel" });

const { state, resetSessionState, createEditorChapterState, createEditorCommentsState } = await import("./state.js");
const { saveActiveEditorRowComment } = await import("./editor-comments-flow.js");
const { editorRowHasUnreadComments } = await import("./editor-comments.js");
const { applyEditorUiState } = await import("./editor-state-flow.js");
const { resetEditorOperationQueue, waitForEditorOperationQueueIdle } = await import("./editor-operation-queue.js");
const { resetRepoWriteQueue } = await import("./repo-write-queue.js");
const { setActiveStorageLogin } = await import("./team-storage.js");
const { loadStoredEditorCommentSeenRevisions, saveStoredEditorCommentSeenRevision } = await import("./editor-comment-preferences.js");
const { removePersistentValue } = await import("./persistent-store.js");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test.beforeEach(() => {
  resetSessionState();
  resetEditorOperationQueue();
  resetRepoWriteQueue();
  for (const login of ["writer", "reader"]) removePersistentValue(`gnosis-tms-editor-comment-seen-revisions:${login}`);
  setActiveStorageLogin("writer");
  state.auth.session = { login: "writer", sessionToken: "fixture" };
  state.screen = "translate";
  state.selectedTeamId = "team";
  state.selectedChapterId = "chapter";
  state.teams = [{ id: "team", installationId: 1, membershipRole: "owner" }];
  state.projects = [{ id: "project", name: "repo", chapters: [{ id: "chapter", status: "active" }] }];
  state.editorChapter = {
    ...createEditorChapterState(), status: "ready", projectId: "project", chapterId: "chapter",
    activeRowId: "row-1", activeLanguageCode: "vi", languages: [{ code: "vi" }],
    rows: ["row-1", "row-2"].map(rowId => ({ rowId, lifecycleState: "active", commentCount: 0, commentsRevision: 0 })),
    comments: { ...createEditorCommentsState(), rowId: "row-1", status: "ready", draft: "My own comment" },
  };
});

async function pendingSave() {
  const saved = deferred();
  const started = deferred();
  invokeHandler = async command => {
    assert.equal(command, "save_gtms_editor_row_comment");
    started.resolve();
    return saved.promise;
  };
  await saveActiveEditorRowComment(() => {});
  await started.promise;
  return saved;
}

const payload = { rowId: "row-1", commentsRevision: 1, commentCount: 1,
  comments: [{ commentId: "own", authorLogin: "writer", body: "My own comment" }] };

for (const destination of ["same-row", "other-row", "other-chapter", "other-login"]) {
  test(`a saved own comment is read after switching to ${destination}`, async () => {
    const saved = await pendingSave();
    if (destination === "other-row") {
      state.editorChapter.activeRowId = "row-2";
      state.editorChapter.comments = { ...createEditorCommentsState(), rowId: "row-2", draft: "Keep this draft" };
    }
    if (destination === "other-chapter") state.editorChapter = { ...createEditorChapterState(), chapterId: "elsewhere" };
    if (destination === "other-login") {
      setActiveStorageLogin("reader");
      state.auth.session = { ...state.auth.session, login: "reader" };
    }
    const currentComments = state.editorChapter.comments;
    saved.resolve(payload);
    await waitForEditorOperationQueueIdle();
    assert.equal(loadStoredEditorCommentSeenRevisions("chapter", "writer")["row-1"], 1);
    assert.deepEqual(loadStoredEditorCommentSeenRevisions("chapter", "reader"), {});
    if (destination === "same-row" || destination === "other-row") {
      assert.equal(editorRowHasUnreadComments(state.editorChapter.rows[0], state.editorChapter.commentSeenRevisions), false);
      assert.equal(state.editorChapter.rows[0].commentCount, 1);
      if (destination === "other-row") assert.equal(state.editorChapter.comments, currentComments);
      assert.equal(editorRowHasUnreadComments({ ...state.editorChapter.rows[0], commentsRevision: 2 }, state.editorChapter.commentSeenRevisions), true);
    }
    if (destination === "other-chapter" || destination === "other-login") assert.equal(state.editorChapter.comments, currentComments);
  });
}

test("a failed comment save does not mark any comments read", async () => {
  const saved = await pendingSave();
  saved.reject(new Error("Save failed"));
  await waitForEditorOperationQueueIdle();
  assert.deepEqual(loadStoredEditorCommentSeenRevisions("chapter", "writer"), {});
  assert.deepEqual(state.editorChapter.commentSeenRevisions, {});
});

test("the signed-in author keeps their comment read before storage login is available", async () => {
  setActiveStorageLogin(null);
  const saved = await pendingSave();
  saved.resolve(payload);
  await waitForEditorOperationQueueIdle();
  assert.equal(loadStoredEditorCommentSeenRevisions("chapter", "writer")["row-1"], 1);
  assert.equal(editorRowHasUnreadComments(state.editorChapter.rows[0], state.editorChapter.commentSeenRevisions), false);
});

test("a reload preserves a receipt saved after it captured the editor state", () => {
  const previous = { ...state.editorChapter, commentSeenRevisions: { "row-1": 0, "row-2": 3 } };
  const reloaded = applyEditorUiState({ ...state.editorChapter, commentSeenRevisions: { "row-1": 1 } }, previous);
  assert.deepEqual(reloaded.commentSeenRevisions, { "row-1": 1, "row-2": 3 });
});

test("opening another chapter restores its persisted read receipts", () => {
  const previous = { ...createEditorChapterState(), chapterId: "elsewhere", commentSeenRevisions: { "row-2": 9 } };
  const opened = applyEditorUiState({ ...state.editorChapter, commentSeenRevisions: { "row-1": 1 } }, previous);
  assert.deepEqual(opened.commentSeenRevisions, { "row-1": 1 });
});

test("older read receipts cannot undo a newer receipt", () => {
  saveStoredEditorCommentSeenRevision("chapter", "row-1", 3);
  saveStoredEditorCommentSeenRevision("chapter", "row-1", 1);
  assert.equal(loadStoredEditorCommentSeenRevisions("chapter")["row-1"], 3);
});
