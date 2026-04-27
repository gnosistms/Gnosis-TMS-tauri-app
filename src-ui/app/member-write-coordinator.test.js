import test from "node:test";
import assert from "node:assert/strict";

const {
  applyMemberWriteIntentsToSnapshot,
  clearConfirmedMemberWriteIntents,
  getMemberWriteIntent,
  memberOwnerPromotionIntentKey,
  memberRemovalIntentKey,
  memberRoleIntentKey,
  memberUserWriteScope,
  requestMemberWriteIntent,
  resetMemberWriteCoordinator,
} = await import("./member-write-coordinator.js");

const team = {
  id: "team-1",
  installationId: 42,
};

function member(overrides = {}) {
  return {
    id: "alice",
    username: "alice",
    name: "Alice",
    role: "Translator",
    ...overrides,
  };
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

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.afterEach(() => {
  resetMemberWriteCoordinator();
});

test("member write coordinator overlays pending role updates", async () => {
  const release = deferred();

  requestMemberWriteIntent({
    key: memberRoleIntentKey(team.id, "alice"),
    scope: memberUserWriteScope(team, "alice"),
    teamId: team.id,
    username: "alice",
    type: "memberRole",
    value: { username: "alice", role: "Admin" },
  }, {
    run: async () => {
      await release.promise;
    },
  });
  await delay();

  const snapshot = applyMemberWriteIntentsToSnapshot({
    members: [member()],
  });

  assert.equal(snapshot.members[0].role, "Admin");
  assert.equal(snapshot.members[0].pendingMutation, "makeAdmin");

  release.resolve();
  await delay();
});

test("member write coordinator coalesces repeated role changes to the latest role", async () => {
  const releaseFirst = deferred();
  const seenRoles = [];

  requestMemberWriteIntent({
    key: memberRoleIntentKey(team.id, "alice"),
    scope: memberUserWriteScope(team, "alice"),
    teamId: team.id,
    username: "alice",
    type: "memberRole",
    value: { username: "alice", role: "Admin" },
  }, {
    run: async (intent) => {
      seenRoles.push(intent.value.role);
      await releaseFirst.promise;
    },
  });

  requestMemberWriteIntent({
    key: memberRoleIntentKey(team.id, "alice"),
    scope: memberUserWriteScope(team, "alice"),
    teamId: team.id,
    username: "alice",
    type: "memberRole",
    value: { username: "alice", role: "Translator" },
  }, {
    run: async (intent) => {
      seenRoles.push(intent.value.role);
    },
  });
  await delay();

  const snapshot = applyMemberWriteIntentsToSnapshot({
    members: [member({ role: "Translator" })],
  });
  assert.equal(snapshot.members[0].role, "Translator");
  assert.equal(snapshot.members[0].pendingMutation, "revokeAdmin");

  releaseFirst.resolve();
  await delay();
  await delay();
  assert.deepEqual(seenRoles, ["Admin", "Translator"]);
});

test("member removal and owner promotion supersede pending role updates", async () => {
  const release = deferred();

  requestMemberWriteIntent({
    key: memberRoleIntentKey(team.id, "alice"),
    scope: memberUserWriteScope(team, "alice"),
    teamId: team.id,
    username: "alice",
    type: "memberRole",
    value: { username: "alice", role: "Admin" },
  }, {
    run: async () => {
      await release.promise;
    },
  });
  await delay();

  requestMemberWriteIntent({
    key: memberOwnerPromotionIntentKey(team.id, "alice"),
    scope: memberUserWriteScope(team, "alice"),
    teamId: team.id,
    username: "alice",
    type: "memberOwnerPromotion",
    value: { username: "alice" },
  }, {
    run: async () => null,
  });

  assert.equal(getMemberWriteIntent(memberRoleIntentKey(team.id, "alice")), null);
  let snapshot = applyMemberWriteIntentsToSnapshot({
    members: [member()],
  });
  assert.equal(snapshot.members[0].role, "Owner");
  assert.equal(snapshot.members[0].pendingMutation, "promoteOwner");

  requestMemberWriteIntent({
    key: memberRemovalIntentKey(team.id, "alice"),
    scope: memberUserWriteScope(team, "alice"),
    teamId: team.id,
    username: "alice",
    type: "memberRemoval",
    value: { username: "alice" },
  }, {
    run: async () => null,
  });

  snapshot = applyMemberWriteIntentsToSnapshot({
    members: [member()],
  });
  assert.equal(snapshot.members.length, 0);

  release.resolve();
  await delay();
});

test("member write coordinator clears confirmed intents when refreshed data agrees", async () => {
  requestMemberWriteIntent({
    key: memberRoleIntentKey(team.id, "alice"),
    scope: memberUserWriteScope(team, "alice"),
    teamId: team.id,
    username: "alice",
    type: "memberRole",
    value: { username: "alice", role: "Admin" },
  }, {
    run: async () => null,
  });
  await delay();
  await delay();

  clearConfirmedMemberWriteIntents([member({ role: "Admin" })]);

  assert.equal(getMemberWriteIntent(memberRoleIntentKey(team.id, "alice")), null);
});
