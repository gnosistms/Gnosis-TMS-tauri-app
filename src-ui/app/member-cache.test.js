import test from "node:test";
import assert from "node:assert/strict";

const { readPersistentValue, removePersistentValue, writePersistentValue } = await import("./persistent-store.js");
const { setActiveStorageLogin } = await import("./team-storage.js");
const {
  loadStoredMembersForTeam,
  saveStoredMembersForTeam,
} = await import("./member-cache.js");

const STORAGE_KEY = "gnosis-tms-member-cache:tester";
const team = { installationId: 42 };

function member(overrides = {}) {
  return {
    id: "alice",
    username: "alice",
    name: "Alice",
    role: "Translator",
    avatarUrl: null,
    htmlUrl: null,
    ...overrides,
  };
}

test.afterEach(() => {
  removePersistentValue(STORAGE_KEY);
  setActiveStorageLogin(null);
});

test("member cache does not persist transient pending fields", () => {
  setActiveStorageLogin("tester");

  saveStoredMembersForTeam(team, [
    member({
      pendingMutation: "makeAdmin",
      pendingError: "Retrying",
      roleSyncPending: true,
      optimisticClientId: "optimistic-1",
    }),
  ]);

  const stored = readPersistentValue(STORAGE_KEY, {});
  const storedMember = stored["installation:42"].members[0];
  assert.equal(Object.hasOwn(storedMember, "pendingMutation"), false);
  assert.equal(Object.hasOwn(storedMember, "pendingError"), false);
  assert.equal(Object.hasOwn(storedMember, "roleSyncPending"), false);
  assert.equal(Object.hasOwn(storedMember, "optimisticClientId"), false);
});

test("member cache strips legacy transient pending fields on load", () => {
  setActiveStorageLogin("tester");
  writePersistentValue(STORAGE_KEY, {
    "installation:42": {
      members: [
        member({
          pendingMutation: "revokeAdmin",
          pendingError: "Failed",
          roleSyncPending: true,
          optimisticClientId: "optimistic-2",
        }),
      ],
    },
  });

  const loaded = loadStoredMembersForTeam(team);
  assert.equal(loaded.exists, true);
  assert.equal(loaded.members.length, 1);
  assert.equal(Object.hasOwn(loaded.members[0], "pendingMutation"), false);
  assert.equal(Object.hasOwn(loaded.members[0], "pendingError"), false);
  assert.equal(Object.hasOwn(loaded.members[0], "roleSyncPending"), false);
  assert.equal(Object.hasOwn(loaded.members[0], "optimisticClientId"), false);
});

test("member cache maps raw GitHub member roles to translators", () => {
  setActiveStorageLogin("tester");
  writePersistentValue(STORAGE_KEY, {
    "installation:42": {
      members: [
        member({
          role: "member",
        }),
      ],
    },
  });

  const loaded = loadStoredMembersForTeam(team);
  assert.equal(loaded.members[0].role, "Translator");
});
