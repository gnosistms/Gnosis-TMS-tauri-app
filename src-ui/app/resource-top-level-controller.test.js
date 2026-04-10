import test from "node:test";
import assert from "node:assert/strict";

import {
  openTopLevelRenameModal,
  submitSimpleTopLevelMutation,
  submitTopLevelRename,
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

test("shared top-level rename submit validates then queues through the shared store", async () => {
  const calls = [];
  const modalState = {
    isOpen: true,
    projectId: "resource-1",
    projectName: "Renamed",
    status: "idle",
    error: "",
  };

  const mutation = await submitTopLevelRename({
    resource: { id: "resource-1", title: "Original" },
    modalState,
    nameField: "projectName",
    getBlockedMessage: () => "",
    ensureNotTombstoned: async () => false,
    previousTitle: (resource) => resource.title,
    buildMutationFields: (resource) => ({ projectId: resource.id }),
    store: {
      currentSnapshot: () => ({ items: [], deletedItems: [] }),
      applyMutation: (snapshot) => snapshot,
      applySnapshot: () => {
        calls.push("applySnapshot");
      },
      beginSync: () => {
        calls.push("beginSync");
      },
      getPendingMutations: () => [],
      setPendingMutations: (mutations) => {
        calls.push(["setPendingMutations", mutations.length]);
      },
      persistPendingMutations: (mutations) => {
        calls.push(["persistPendingMutations", mutations.length]);
      },
      persistVisibleState: () => {
        calls.push("persistVisibleState");
      },
    },
    afterQueue: () => {
      calls.push("afterQueue");
    },
    processQueue: () => {
      calls.push("processQueue");
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(mutation?.type, "rename");
  assert.equal(mutation?.resourceId, "resource-1");
  assert.equal(mutation?.projectId, "resource-1");
  assert.equal(mutation?.previousTitle, "Original");
  assert.equal(modalState.status, "loading");
  assert.equal(modalState.error, "");
  assert.deepEqual(calls, [
    "applySnapshot",
    "beginSync",
    ["setPendingMutations", 1],
    "persistVisibleState",
    ["persistPendingMutations", 1],
    "afterQueue",
    "processQueue",
  ]);
});

test("shared simple top-level submit stops before queueing when the guard blocks", async () => {
  const calls = [];

  const mutation = await submitSimpleTopLevelMutation({
    resource: { id: "resource-1" },
    type: "softDelete",
    getBlockedMessage: () => "blocked",
    onBlocked: (message) => {
      calls.push(["onBlocked", message]);
    },
    store: {
      currentSnapshot: () => ({ items: [], deletedItems: [] }),
      applyMutation: (snapshot) => snapshot,
      applySnapshot: () => {
        calls.push("applySnapshot");
      },
      getPendingMutations: () => [],
      setPendingMutations: () => {
        calls.push("setPendingMutations");
      },
    },
  });

  assert.equal(mutation, null);
  assert.deepEqual(calls, [["onBlocked", "blocked"]]);
});
