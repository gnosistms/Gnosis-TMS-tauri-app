import test from "node:test";
import assert from "node:assert/strict";

import {
  autoResumePendingResources,
  resumePendingResourceSetup,
} from "./resource-pending-create.js";

test("shared pending-create helper hands off to background create when no remote match exists", async () => {
  const calls = [];
  const resource = { id: "resource-1", remoteState: "pendingCreate" };

  await resumePendingResourceSetup({
    render: () => {
      calls.push("render");
    },
    resourceId: "resource-1",
    resourceLabel: "resource",
    getResource: () => resource,
    ensureResumeAllowed: () => true,
    isPendingCreate: () => true,
    isInFlight: () => false,
    markInFlight: () => {
      calls.push("markInFlight");
    },
    clearInFlight: () => {
      calls.push("clearInFlight");
    },
    listRemoteResources: async () => {
      calls.push("listRemoteResources");
      return [];
    },
    findMatchingRemoteResource: () => null,
    syncInBackground: async () => {
      calls.push("syncInBackground");
    },
    showStartNotice: false,
  });

  assert.deepEqual(calls, [
    "markInFlight",
    "listRemoteResources",
    "syncInBackground",
  ]);
});

test("shared pending-create helper finalizes when a matching remote resource exists", async () => {
  const calls = [];
  const resource = { id: "resource-1", remoteState: "pendingCreate" };
  const remote = { id: "remote-1" };

  await resumePendingResourceSetup({
    render: () => {
      calls.push("render");
    },
    resourceId: "resource-1",
    resourceLabel: "resource",
    getResource: () => resource,
    ensureResumeAllowed: () => true,
    isPendingCreate: () => true,
    isInFlight: () => false,
    markInFlight: () => {
      calls.push("markInFlight");
    },
    clearInFlight: () => {
      calls.push("clearInFlight");
    },
    listRemoteResources: async () => [remote],
    findMatchingRemoteResource: () => remote,
    finalizePendingSetup: async (_resource, matchedRemote) => {
      calls.push(["finalizePendingSetup", matchedRemote.id]);
    },
    showSuccessNotice: false,
  });

  assert.deepEqual(calls, [
    "markInFlight",
    ["finalizePendingSetup", "remote-1"],
    "clearInFlight",
    "render",
  ]);
});

test("shared pending-create auto-resume only resumes pending resources that are not already in flight", async () => {
  const resumed = [];

  await autoResumePendingResources({
    resources: [
      { id: "pending-1", remoteState: "pendingCreate" },
      { id: "active-1", remoteState: "linked" },
      { id: "pending-2", remoteState: "pendingCreate" },
    ],
    getResourceId: (resource) => resource.id,
    isPendingCreate: (resource) => resource.remoteState === "pendingCreate",
    isInFlight: (resource) => resource.id === "pending-2",
    resumePendingSetup: async (resourceId, options) => {
      resumed.push([resourceId, options.showStartNotice, options.showSuccessNotice, options.showErrorNotice]);
    },
  });

  assert.deepEqual(resumed, [
    ["pending-1", false, false, true],
  ]);
});
