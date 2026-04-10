import test from "node:test";
import assert from "node:assert/strict";

import {
  openTopLevelRenameModal,
} from "./resource-top-level-controller.js";

test("shared top-level rename opener populates the modal after guard success", async () => {
  let modalState = null;
  const renders = [];

  openTopLevelRenameModal({
    resource: { id: "resource-1", title: "Original" },
    getBlockedMessage: () => "",
    ensureNotTombstoned: async () => false,
    setModalState: (nextState) => {
      modalState = nextState;
    },
    idField: "projectId",
    nameField: "projectName",
    currentName: "Original",
    render: () => {
      renders.push("render");
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(modalState, {
    isOpen: true,
    projectId: "resource-1",
    projectName: "Original",
    status: "idle",
    error: "",
  });
  assert.deepEqual(renders, ["render"]);
});
