import test from "node:test";
import assert from "node:assert/strict";

import {
  guardTopLevelResourceAction,
  runPermanentDeleteLocalFirst,
} from "./resource-lifecycle-engine.js";

test("shared top-level guard stops on missing resources before later checks", async () => {
  const calls = [];

  const allowed = await guardTopLevelResourceAction({
    resource: null,
    getBlockedMessage: () => {
      calls.push("getBlockedMessage");
      return "";
    },
    ensureNotTombstoned: async () => {
      calls.push("ensureNotTombstoned");
      return false;
    },
    onMissing: () => {
      calls.push("onMissing");
    },
  });

  assert.equal(allowed, false);
  assert.deepEqual(calls, ["onMissing"]);
});

test("shared top-level guard stops on blocked actions before tombstone checks", async () => {
  const calls = [];

  const allowed = await guardTopLevelResourceAction({
    resource: { id: "resource-1" },
    getBlockedMessage: () => {
      calls.push("getBlockedMessage");
      return "blocked";
    },
    ensureNotTombstoned: async () => {
      calls.push("ensureNotTombstoned");
      return false;
    },
    onBlocked: (message) => {
      calls.push(["onBlocked", message]);
    },
  });

  assert.equal(allowed, false);
  assert.deepEqual(calls, ["getBlockedMessage", ["onBlocked", "blocked"]]);
});

test("shared top-level guard calls tombstone handler before allowing the action", async () => {
  const calls = [];

  const allowed = await guardTopLevelResourceAction({
    resource: { id: "resource-1" },
    getBlockedMessage: () => "",
    ensureNotTombstoned: async () => {
      calls.push("ensureNotTombstoned");
      return true;
    },
    onTombstoned: () => {
      calls.push("onTombstoned");
    },
  });

  assert.equal(allowed, false);
  assert.deepEqual(calls, ["ensureNotTombstoned", "onTombstoned"]);
});

test("shared top-level guard allows valid actions through", async () => {
  const calls = [];

  const allowed = await guardTopLevelResourceAction({
    resource: { id: "resource-1", lifecycleState: "active" },
    isExpectedResource: (resource) => {
      calls.push(["isExpectedResource", resource.id]);
      return resource.lifecycleState === "active";
    },
    getBlockedMessage: () => {
      calls.push("getBlockedMessage");
      return "";
    },
    ensureNotTombstoned: async () => {
      calls.push("ensureNotTombstoned");
      return false;
    },
  });

  assert.equal(allowed, true);
  assert.deepEqual(calls, [
    ["isExpectedResource", "resource-1"],
    "getBlockedMessage",
    "ensureNotTombstoned",
  ]);
});

test("shared permanent delete helper rolls back before tombstone completion", async () => {
  const calls = [];

  runPermanentDeleteLocalFirst({
    commitTombstone: async () => {
      calls.push("commitTombstone");
      throw new Error("commit failed");
    },
    rollbackBeforeTombstone: async (error) => {
      calls.push(["rollbackBeforeTombstone", error.message]);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, [
    "commitTombstone",
    ["rollbackBeforeTombstone", "commit failed"],
  ]);
});

test("shared permanent delete helper reports remote delete failure after local commit and purge", async () => {
  const calls = [];

  runPermanentDeleteLocalFirst({
    commitTombstone: async () => {
      calls.push("commitTombstone");
    },
    purgeLocalRepo: async () => {
      calls.push("purgeLocalRepo");
    },
    deleteRemote: async () => {
      calls.push("deleteRemote");
      throw new Error("remote failed");
    },
    onRemoteDeleteError: async (error) => {
      calls.push(["onRemoteDeleteError", error.message]);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, [
    "commitTombstone",
    "purgeLocalRepo",
    "deleteRemote",
    ["onRemoteDeleteError", "remote failed"],
  ]);
});

test("shared permanent delete helper handles post-tombstone local cleanup failure", async () => {
  const calls = [];

  runPermanentDeleteLocalFirst({
    commitTombstone: async () => {
      calls.push("commitTombstone");
    },
    purgeLocalRepo: async () => {
      calls.push("purgeLocalRepo");
      throw new Error("purge failed");
    },
    onLocalDeleteError: async (error) => {
      calls.push(["onLocalDeleteError", error.message]);
      return true;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, [
    "commitTombstone",
    "purgeLocalRepo",
    ["onLocalDeleteError", "purge failed"],
  ]);
});
