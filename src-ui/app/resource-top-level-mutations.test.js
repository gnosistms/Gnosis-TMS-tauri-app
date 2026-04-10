import test from "node:test";
import assert from "node:assert/strict";

import { applyGlossaryPendingMutation, glossarySnapshotFromList } from "./glossary-top-level-state.js";
import { applyTopLevelResourceMutation } from "./resource-top-level-mutations.js";

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
