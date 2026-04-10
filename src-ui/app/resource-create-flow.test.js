import test from "node:test";
import assert from "node:assert/strict";

import {
  guardResourceCreateStart,
} from "./resource-create-flow.js";

test("shared create-start guard reports installation, offline, and permission blockers", () => {
  const messages = [];

  assert.equal(guardResourceCreateStart({
    installationReady: () => false,
    installationMessage: "Need installation",
    onBlocked: (message) => messages.push(message),
  }), false);

  assert.equal(guardResourceCreateStart({
    installationReady: () => true,
    offlineBlocked: () => true,
    offlineMessage: "Offline blocked",
    onBlocked: (message) => messages.push(message),
  }), false);

  assert.equal(guardResourceCreateStart({
    installationReady: () => true,
    offlineBlocked: () => false,
    canCreate: () => false,
    permissionMessage: "No permission",
    onBlocked: (message) => messages.push(message),
  }), false);

  assert.deepEqual(messages, [
    "Need installation",
    "Offline blocked",
    "No permission",
  ]);
});
