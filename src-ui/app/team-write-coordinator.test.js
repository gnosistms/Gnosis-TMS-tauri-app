import test from "node:test";
import assert from "node:assert/strict";

const {
  applyTeamWriteIntentsToSnapshot,
  clearConfirmedTeamWriteIntents,
  getTeamWriteIntent,
  requestTeamWriteIntent,
  resetTeamWriteCoordinator,
  teamLifecycleIntentKey,
  teamRenameIntentKey,
  teamWriteScope,
} = await import("./team-write-coordinator.js");

const team = {
  id: "team-1",
  name: "Team One",
  githubOrg: "team-one",
  description: "Description",
  installationId: 42,
  accountType: "Organization",
  canDelete: true,
  canManageMembers: true,
  canManageProjects: true,
  canLeave: true,
};

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

test.afterEach(() => {
  resetTeamWriteCoordinator();
});

test("team write coordinator overlays pending rename intents", async () => {
  const release = deferred();

  requestTeamWriteIntent({
    key: teamRenameIntentKey(team.id),
    scope: teamWriteScope(team),
    teamId: team.id,
    type: "teamRename",
    value: { name: "Renamed Team" },
  }, {
    run: async () => {
      await release.promise;
    },
  });
  await delay();

  const snapshot = applyTeamWriteIntentsToSnapshot({
    items: [team],
    deletedItems: [],
  });

  assert.equal(snapshot.items[0].name, "Renamed Team");
  assert.equal(snapshot.items[0].pendingMutation, "rename");

  release.resolve();
  await delay();
});

test("team write coordinator moves teams for lifecycle intents", async () => {
  requestTeamWriteIntent({
    key: teamLifecycleIntentKey(team.id),
    scope: teamWriteScope(team),
    teamId: team.id,
    type: "teamLifecycle",
    value: { lifecycleState: "deleted", deletedAt: "2026-04-27T00:00:00.000Z" },
  }, {
    run: async () => null,
  });
  await delay();

  let snapshot = applyTeamWriteIntentsToSnapshot({
    items: [team],
    deletedItems: [],
  });

  assert.equal(snapshot.items.length, 0);
  assert.equal(snapshot.deletedItems[0].id, team.id);
  assert.equal(snapshot.deletedItems[0].pendingMutation, "softDelete");

  requestTeamWriteIntent({
    key: teamLifecycleIntentKey(team.id),
    scope: teamWriteScope(team),
    teamId: team.id,
    type: "teamLifecycle",
    value: { lifecycleState: "active" },
  }, {
    run: async () => null,
  });
  await delay();

  snapshot = applyTeamWriteIntentsToSnapshot({
    items: [],
    deletedItems: [{ ...team, isDeleted: true, description: "[DELETED] Description" }],
  });

  assert.equal(snapshot.items[0].id, team.id);
  assert.equal(snapshot.items[0].pendingMutation, "restore");
  assert.equal(snapshot.deletedItems.length, 0);
});

test("team write coordinator clears confirmed lifecycle intents", async () => {
  requestTeamWriteIntent({
    key: teamLifecycleIntentKey(team.id),
    scope: teamWriteScope(team),
    teamId: team.id,
    type: "teamLifecycle",
    value: { lifecycleState: "deleted" },
  }, {
    run: async () => null,
  });
  await delay();
  await delay();

  clearConfirmedTeamWriteIntents({
    items: [],
    deletedItems: [{ ...team, isDeleted: true }],
  });

  assert.equal(getTeamWriteIntent(teamLifecycleIntentKey(team.id)), null);
});
