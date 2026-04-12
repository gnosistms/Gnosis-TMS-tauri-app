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
  assert.deepEqual(notices, ["Finish saving the current row before leaving the editor."]);
});

test("leaving the translate editor proceeds after dirty rows flush", async () => {
  const notices = [];

  const allowed = await guardLeavingTranslateEditor({
    currentScreen: "translate",
    nextScreen: "projects",
    render: () => {},
    flushDirtyEditorRows: async () => true,
    showBlockedNotice: (message) => notices.push(message),
  });

  assert.equal(allowed, true);
  assert.deepEqual(notices, []);
});

test("refreshing the translate editor waits for dirty rows to flush", async () => {
  const blocked = await guardRefreshingTranslateEditor({
    currentScreen: "translate",
    render: () => {},
    flushDirtyEditorRows: async () => false,
  });

  const allowed = await guardRefreshingTranslateEditor({
    currentScreen: "translate",
    render: () => {},
    flushDirtyEditorRows: async () => true,
  });

  assert.equal(blocked, false);
  assert.equal(allowed, true);
});
