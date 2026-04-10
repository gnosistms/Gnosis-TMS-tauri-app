import test from "node:test";
import assert from "node:assert/strict";

import {
  guardPermanentDeleteConfirmation,
  guardTopLevelResourceAction,
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

test("shared permanent delete confirmation guard sets modal error for missing resources", async () => {
  const modalState = { status: "loading", error: "" };
  const renders = [];

  const allowed = await guardPermanentDeleteConfirmation({
    resource: null,
    modalState,
    missingMessage: "Missing resource.",
    render: () => {
      renders.push("render");
    },
  });

  assert.equal(allowed, false);
  assert.equal(modalState.status, "idle");
  assert.equal(modalState.error, "Missing resource.");
  assert.deepEqual(renders, ["render"]);
});

test("shared permanent delete confirmation guard stops on blocked actions", async () => {
  const modalState = { status: "loading", error: "" };

  const allowed = await guardPermanentDeleteConfirmation({
    resource: { id: "resource-1" },
    modalState,
    getBlockedMessage: () => "blocked",
  });

  assert.equal(allowed, false);
  assert.equal(modalState.status, "idle");
  assert.equal(modalState.error, "blocked");
});

test("shared permanent delete confirmation guard stops on confirmation mismatch", async () => {
  const modalState = { status: "idle", error: "" };

  const allowed = await guardPermanentDeleteConfirmation({
    resource: { id: "resource-1" },
    modalState,
    confirmationMessage: "Mismatch.",
    matchesConfirmation: () => false,
  });

  assert.equal(allowed, false);
  assert.equal(modalState.error, "Mismatch.");
});

test("shared permanent delete confirmation guard calls the extra guard after tombstone check", async () => {
  const calls = [];

  const allowed = await guardPermanentDeleteConfirmation({
    resource: { id: "resource-1" },
    matchesConfirmation: () => {
      calls.push("matchesConfirmation");
      return true;
    },
    ensureNotTombstoned: async () => {
      calls.push("ensureNotTombstoned");
      return false;
    },
    extraGuard: async () => {
      calls.push("extraGuard");
      return true;
    },
  });

  assert.equal(allowed, true);
  assert.deepEqual(calls, [
    "matchesConfirmation",
    "ensureNotTombstoned",
    "extraGuard",
  ]);
});
