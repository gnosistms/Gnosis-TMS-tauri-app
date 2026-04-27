import test from "node:test";
import assert from "node:assert/strict";

import {
  editorAiActionsAreOfflineBlocked,
  editorNetworkActionsAreOfflineBlocked,
  isOfflineBlockedAction,
} from "./offline-policy.js";
import { resetSessionState, state } from "./state.js";

test.afterEach(() => {
  resetSessionState();
});

test("editor online actions are blocked while offline", () => {
  state.offline = {
    ...state.offline,
    isEnabled: true,
  };

  assert.equal(editorAiActionsAreOfflineBlocked(), true);
  assert.equal(editorNetworkActionsAreOfflineBlocked(), true);
  assert.equal(isOfflineBlockedAction("review-editor-text-now"), true);
  assert.equal(isOfflineBlockedAction("run-editor-ai-assistant"), true);
  assert.equal(isOfflineBlockedAction("run-editor-ai-translate:translate1"), true);
  assert.equal(isOfflineBlockedAction("open-editor-ai-translate-all"), true);
  assert.equal(isOfflineBlockedAction("confirm-editor-ai-translate-all"), true);
  assert.equal(isOfflineBlockedAction("open-editor-derive-glossaries"), true);
  assert.equal(isOfflineBlockedAction("confirm-editor-derive-glossaries"), true);
  assert.equal(isOfflineBlockedAction("submit-target-language-manager"), true);
});

test("local editor actions remain available while offline", () => {
  state.offline = {
    ...state.offline,
    isEnabled: true,
  };

  assert.equal(isOfflineBlockedAction("toggle-editor-reviewed"), false);
  assert.equal(isOfflineBlockedAction("toggle-editor-please-check"), false);
  assert.equal(isOfflineBlockedAction("open-editor-unreview-all"), false);
  assert.equal(isOfflineBlockedAction("apply-editor-ai-review"), false);
  assert.equal(isOfflineBlockedAction("apply-editor-assistant-draft:item-1"), false);
});
