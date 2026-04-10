import test from "node:test";
import assert from "node:assert/strict";

import { applyGlossaryPendingMutation, glossarySnapshotFromList } from "./glossary-top-level-state.js";
import {
  applyTopLevelResourceMutation,
  submitTopLevelResourceMutation,
} from "./resource-top-level-mutations.js";

test("shared top-level mutation engine renames and soft-deletes resources through one pipeline", () => {
  const renamedThenDeleted = applyTopLevelResourceMutation(
    {
      items: [
        {
          id: "resource-1",
          title: "Original",
          lifecycleState: "active",
        },
      ],
      deletedItems: [],
    },
    {
      id: "mutation-1",
      type: "rename",
      resourceId: "resource-1",
      title: "Renamed",
    },
    {
      markDeleted: (resource) => ({
        ...resource,
        lifecycleState: "deleted",
      }),
      markActive: (resource) => ({
        ...resource,
        lifecycleState: "active",
      }),
      renameResource: (resource, mutation) => ({
        ...resource,
        title: mutation.title,
      }),
    },
  );

  const deletedSnapshot = applyTopLevelResourceMutation(
    renamedThenDeleted,
    {
      id: "mutation-2",
      type: "softDelete",
      resourceId: "resource-1",
    },
    {
      markDeleted: (resource) => ({
        ...resource,
        lifecycleState: "deleted",
      }),
      markActive: (resource) => ({
        ...resource,
        lifecycleState: "active",
      }),
      renameResource: (resource, mutation) => ({
        ...resource,
        title: mutation.title,
      }),
    },
  );

  assert.equal(deletedSnapshot.items.length, 0);
  assert.equal(deletedSnapshot.deletedItems.length, 1);
  assert.equal(deletedSnapshot.deletedItems[0].title, "Renamed");
  assert.equal(deletedSnapshot.deletedItems[0].lifecycleState, "deleted");
});

test("glossary pending mutation replay preserves optimistic deleted state across reload", () => {
  const snapshot = glossarySnapshotFromList([
    {
      id: "glossary-1",
      repoName: "glossary-1",
      title: "Glossary 1",
      lifecycleState: "active",
    },
  ]);

  const optimisticSnapshot = applyGlossaryPendingMutation(snapshot, {
    id: "mutation-1",
    type: "softDelete",
    resourceId: "glossary-1",
    glossaryId: "glossary-1",
  });

  assert.equal(optimisticSnapshot.items.length, 0);
  assert.equal(optimisticSnapshot.deletedItems.length, 1);
  assert.equal(optimisticSnapshot.deletedItems[0].id, "glossary-1");
  assert.equal(optimisticSnapshot.deletedItems[0].lifecycleState, "deleted");
});

test("shared top-level submit helper queues then processes after the requested wait", async () => {
  const calls = [];

  const mutation = await submitTopLevelResourceMutation({
    validate: async () => {
      calls.push("validate");
      return true;
    },
    setLoading: () => {
      calls.push("setLoading");
    },
    buildMutation: () => {
      calls.push("buildMutation");
      return { id: "mutation-1", type: "rename", resourceId: "resource-1" };
    },
    queueMutation: (nextMutation) => {
      calls.push(["queueMutation", nextMutation.id]);
    },
    afterQueue: () => {
      calls.push("afterQueue");
    },
    waitForProcessing: async () => {
      calls.push("waitForProcessing");
    },
    processQueue: (nextMutation) => {
      calls.push(["processQueue", nextMutation.id]);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(mutation, {
    id: "mutation-1",
    type: "rename",
    resourceId: "resource-1",
  });
  assert.deepEqual(calls, [
    "validate",
    "setLoading",
    "buildMutation",
    ["queueMutation", "mutation-1"],
    "afterQueue",
    "waitForProcessing",
    ["processQueue", "mutation-1"],
  ]);
});
