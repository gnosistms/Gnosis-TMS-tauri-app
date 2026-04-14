import test from "node:test";
import assert from "node:assert/strict";

import { resetSessionState, state } from "./state.js";
import {
  hideNavigationLoadingModal,
  showNavigationLoadingModal,
} from "./navigation-loading.js";

test("navigation loading modal opens and closes with matching tokens", () => {
  resetSessionState();

  const token = showNavigationLoadingModal("Loading file...", "Opening the editor.");
  assert.equal(state.navigationLoadingModal.isOpen, true);
  assert.equal(state.navigationLoadingModal.title, "Loading file...");
  assert.equal(state.navigationLoadingModal.message, "Opening the editor.");

  assert.equal(hideNavigationLoadingModal(token), true);
  assert.equal(state.navigationLoadingModal.isOpen, false);
});

test("navigation loading modal ignores stale tokens", () => {
  resetSessionState();

  const firstToken = showNavigationLoadingModal("Loading file...");
  const secondToken = showNavigationLoadingModal("Saving and syncing...");

  assert.equal(hideNavigationLoadingModal(firstToken), false);
  assert.equal(state.navigationLoadingModal.isOpen, true);
  assert.equal(state.navigationLoadingModal.title, "Saving and syncing...");

  assert.equal(hideNavigationLoadingModal(secondToken), true);
  assert.equal(state.navigationLoadingModal.isOpen, false);
});
