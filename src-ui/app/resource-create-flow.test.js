import test from "node:test";
import assert from "node:assert/strict";

import {
  finalizeLocalFirstCreate,
  runLocalFirstCreate,
} from "./resource-create-flow.js";

test("shared local-first create helper returns reservation and created resource on success", async () => {
  const calls = [];

  const result = await runLocalFirstCreate({
    reserveLocalRepo: async () => {
      calls.push("reserveLocalRepo");
      return { repoName: "repo-1", collisionResolved: true };
    },
    commitPendingMetadata: async (repoName) => {
      calls.push(["commitPendingMetadata", repoName]);
    },
    initializeLocalResource: async (repoName) => {
      calls.push(["initializeLocalResource", repoName]);
      return { id: "resource-1" };
    },
  });

  assert.deepEqual(result, {
    localRepoName: "repo-1",
    localNameCollisionResolved: true,
    createdResource: { id: "resource-1" },
  });
  assert.deepEqual(calls, [
    "reserveLocalRepo",
    ["commitPendingMetadata", "repo-1"],
    ["initializeLocalResource", "repo-1"],
  ]);
});

test("shared local-first create helper purges local repo and rolls back metadata on failure", async () => {
  const calls = [];

  await assert.rejects(
    () => runLocalFirstCreate({
      reserveLocalRepo: async () => ({ repoName: "repo-1", collisionResolved: false }),
      commitPendingMetadata: async () => {
        calls.push("commitPendingMetadata");
      },
      initializeLocalResource: async () => {
        calls.push("initializeLocalResource");
        throw new Error("initialize failed");
      },
      purgeLocalRepo: async (repoName) => {
        calls.push(["purgeLocalRepo", repoName]);
      },
      rollbackPendingMetadata: async (error) => {
        calls.push(["rollbackPendingMetadata", error.message]);
      },
    }),
    /initialize failed/,
  );

  assert.deepEqual(calls, [
    "commitPendingMetadata",
    "initializeLocalResource",
    ["purgeLocalRepo", "repo-1"],
    ["rollbackPendingMetadata", "initialize failed"],
  ]);
});

test("shared local-first create finalizer commits visible resource, selects it, opens it, and starts background sync", async () => {
  const calls = [];

  const committedResource = await finalizeLocalFirstCreate({
    createdResource: { id: "resource-1" },
    clearCreateState: () => {
      calls.push("clearCreateState");
    },
    commitVisibleResource: (resource) => {
      calls.push(["commitVisibleResource", resource.id]);
      return { ...resource, committed: true };
    },
    selectResource: (resource) => {
      calls.push(["selectResource", resource.id, resource.committed]);
    },
    openCreatedResource: async (resource) => {
      calls.push(["openCreatedResource", resource.id, resource.committed]);
    },
    syncInBackground: async (resource) => {
      calls.push(["syncInBackground", resource.id, resource.committed]);
    },
    showSuccessNotice: (resource) => {
      calls.push(["showSuccessNotice", resource.id, resource.committed]);
    },
  });

  assert.deepEqual(committedResource, { id: "resource-1", committed: true });
  assert.deepEqual(calls, [
    "clearCreateState",
    ["commitVisibleResource", "resource-1"],
    ["selectResource", "resource-1", true],
    ["openCreatedResource", "resource-1", true],
    ["syncInBackground", "resource-1", true],
    ["showSuccessNotice", "resource-1", true],
  ]);
});
