import test from "node:test";
import assert from "node:assert/strict";

import {
  guardLeavingTranslateEditor,
  guardRefreshingTranslateEditor,
} from "./editor-navigation-guards.js";

test("leaving the translate editor is blocked when dirty rows cannot be flushed", async () => {
  const notices = [];

  const allowed = await guardLeavingTranslateEditor({
    currentScreen: "translate",
    nextScreen: "projects",
    render: () => {},
    flushDirtyEditorRows: async () => false,
    showBlockedNotice: (message) => notices.push(message),
  });

  assert.equal(allowed, false);
  assert.deepEqual(notices, ["Local save is still pending or failed. Wait for it to finish, or resolve the row before leaving the editor."]);
});

test("leaving the translate editor proceeds after dirty rows flush", async () => {
  const notices = [];
  let flushOptions = null;

  const allowed = await guardLeavingTranslateEditor({
    currentScreen: "translate",
    nextScreen: "projects",
    render: () => {},
    flushDirtyEditorRows: async (_render, _operations, options) => {
      flushOptions = options;
      return true;
    },
    showBlockedNotice: (message) => notices.push(message),
  });

  assert.equal(allowed, true);
  assert.deepEqual(flushOptions, { waitForDurable: true });
  assert.deepEqual(notices, []);
});

test("refresh waits only for submitted writes, without flushing unsaved drafts", async () => {
  let finishSave;
  const pendingSave = new Promise((resolve) => { finishSave = resolve; });
  let finished = false;
  const refresh = guardRefreshingTranslateEditor({
    currentScreen: "translate",
    waitForPendingEditorWrites: () => pendingSave,
    flushDirtyEditorRows: () => { assert.fail("Refresh must not submit drafts"); },
  }).then((allowed) => {
    finished = true;
    return allowed;
  });

  await Promise.resolve();
  assert.equal(finished, false);
  finishSave();
  assert.equal(await refresh, true);
});

test("refresh outside translate does not wait for editor writes", async () => {
  assert.equal(await guardRefreshingTranslateEditor({
    currentScreen: "projects",
    waitForPendingEditorWrites: () => { assert.fail("Unrelated screen"); },
  }), true);
});
