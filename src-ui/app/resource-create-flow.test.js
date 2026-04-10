import test from "node:test";
import assert from "node:assert/strict";

import { runLocalFirstCreate } from "./resource-create-flow.js";

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
