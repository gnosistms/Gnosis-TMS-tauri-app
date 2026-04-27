import test from "node:test";
import assert from "node:assert/strict";

const localStorageState = new Map();
const invokeLog = [];
let invokeHandler = async () => [];

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
  querySelectorAll: () => [],
  documentElement: {
    classList: {
      remove() {},
      toggle() {},
    },
  },
  addEventListener() {},
  hidden: false,
};

globalThis.window = {
  __TAURI__: {
    core: {
      invoke(command, payload = {}) {
        invokeLog.push({
          command,
          payload: typeof structuredClone === "function" ? structuredClone(payload) : payload,
        });
        return invokeHandler(command, payload);
      },
    },
    event: {
      listen: async () => () => {},
    },
  },
  localStorage: {
    getItem(key) {
      return localStorageState.has(key) ? localStorageState.get(key) : null;
    },
    setItem(key, value) {
      localStorageState.set(key, String(value));
    },
    removeItem(key) {
      localStorageState.delete(key);
    },
    clear() {
      localStorageState.clear();
    },
    key(index) {
      return [...localStorageState.keys()][index] ?? null;
    },
    get length() {
      return localStorageState.size;
    },
  },
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  setTimeout,
  clearTimeout,
  addEventListener() {},
  removeEventListener() {},
  open() {},
};

const { resetSessionState, state } = await import("./state.js");
const { readPersistentValue, removePersistentValue } = await import("./persistent-store.js");
const { saveStoredMembersForTeam } = await import("./member-cache.js");
const {
  applyMembersQuerySnapshotToState,
  createMembersQueryOptions,
  createMembersQuerySnapshot,
  patchMemberQueryData,
  removeMemberFromQueryData,
  resetMembersQueryObserver,
  seedMembersQueryFromCache,
} = await import("./member-query.js");
const {
  memberRoleIntentKey,
  memberUserWriteScope,
  requestMemberWriteIntent,
  resetMemberWriteCoordinator,
} = await import("./member-write-coordinator.js");
const { memberKeys, queryClient } = await import("./query-client.js");
const { setActiveStorageLogin } = await import("./team-storage.js");

const team = {
  id: "team-1",
  installationId: 42,
  githubOrg: "fixture-org",
};

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

function installFixture() {
  resetSessionState();
  state.selectedTeamId = team.id;
  state.auth = {
    ...state.auth,
    session: {
      sessionToken: "broker-session",
      login: "owner",
      name: "Owner",
      avatarUrl: null,
    },
  };
  setActiveStorageLogin("owner");
}

test.afterEach(() => {
  resetMembersQueryObserver();
  resetMemberWriteCoordinator();
  queryClient.clear();
  invokeHandler = async () => [];
  invokeLog.length = 0;
  localStorageState.clear();
  removePersistentValue("gnosis-tms-member-cache:owner");
  setActiveStorageLogin(null);
  resetSessionState();
});

test("member query adapter maps snapshots into members page state", () => {
  installFixture();

  const applied = applyMembersQuerySnapshotToState(
    createMembersQuerySnapshot({
      members: [member()],
      discovery: { status: "ready", error: "" },
    }),
    { teamId: team.id, isFetching: true },
  );

  assert.equal(applied, true);
  assert.equal(state.users[0].username, "alice");
  assert.equal(state.userDiscovery.status, "ready");
  assert.equal(state.membersPage.isRefreshing, true);
});

test("member query adapter ignores stale team snapshots", () => {
  installFixture();
  state.selectedTeamId = "team-2";
  state.users = [member({ name: "Existing" })];

  const applied = applyMembersQuerySnapshotToState(
    createMembersQuerySnapshot({ members: [member({ name: "Stale" })] }),
    { teamId: team.id },
  );

  assert.equal(applied, false);
  assert.equal(state.users[0].name, "Existing");
});

test("member query adapter overlays active member write intents during refresh", async () => {
  installFixture();
  const releaseWrite = deferred();

  requestMemberWriteIntent({
    key: memberRoleIntentKey(team.id, "alice"),
    scope: memberUserWriteScope(team, "alice"),
    teamId: team.id,
    username: "alice",
    type: "memberRole",
    value: { username: "alice", role: "Admin" },
  }, {
    run: async () => {
      await releaseWrite.promise;
    },
  });
  await delay();

  applyMembersQuerySnapshotToState(
    createMembersQuerySnapshot({ members: [member({ role: "Translator" })] }),
    { teamId: team.id, isFetching: true },
  );

  assert.equal(state.users[0].role, "Admin");
  assert.equal(state.users[0].pendingMutation, "makeAdmin");

  releaseWrite.resolve();
  await delay();
});

test("seedMembersQueryFromCache renders cached members before remote refresh", () => {
  installFixture();
  saveStoredMembersForTeam(team, [member({ name: "Cached Alice" })]);
  let renderCount = 0;

  const snapshot = seedMembersQueryFromCache(team, {
    teamId: team.id,
    render: () => {
      renderCount += 1;
    },
  });

  assert.equal(snapshot.members[0].name, "Cached Alice");
  assert.equal(state.users[0].name, "Cached Alice");
  assert.equal(state.membersPage.isRefreshing, true);
  assert.equal(renderCount, 1);
  assert.equal(queryClient.getQueryData(memberKeys.byTeam(team.id)).members[0].name, "Cached Alice");
});

test("createMembersQueryOptions fetches remote members and updates persistent cache", async () => {
  installFixture();
  invokeHandler = async (command, payload) => {
    assert.equal(command, "list_organization_members_for_installation");
    assert.equal(payload.installationId, 42);
    assert.equal(payload.orgLogin, "fixture-org");
    assert.equal(payload.sessionToken, "broker-session");
    return [
      {
        login: "alice",
        name: "Remote Alice",
        role: "admin",
      },
    ];
  };

  const snapshot = await queryClient.fetchQuery(createMembersQueryOptions(team, { teamId: team.id }));

  assert.equal(snapshot.members[0].username, "alice");
  assert.equal(snapshot.members[0].role, "Admin");
  assert.equal(invokeLog.length, 1);
  const stored = readPersistentValue("gnosis-tms-member-cache:owner", {});
  assert.equal(stored["installation:42"].members[0].name, "Remote Alice");
});

test("createMembersQueryOptions maps raw GitHub member roles to translators", async () => {
  installFixture();
  invokeHandler = async () => [
    {
      login: "alice",
      name: "Remote Alice",
      role: "member",
    },
  ];

  const snapshot = await queryClient.fetchQuery(createMembersQueryOptions(team, { teamId: team.id }));

  assert.equal(snapshot.members[0].role, "Translator");
});

test("member query data helpers patch and remove members without mutating missing data", () => {
  const queryData = createMembersQuerySnapshot({
    members: [
      member(),
      member({ id: "bob", username: "bob", name: "Bob" }),
    ],
  });

  const patched = patchMemberQueryData(queryData, "alice", { role: "Admin" });
  assert.equal(patched.members[0].role, "Admin");
  assert.notEqual(patched, queryData);

  const unchanged = patchMemberQueryData(queryData, "carol", { role: "Admin" });
  assert.equal(unchanged, queryData);

  const removed = removeMemberFromQueryData(queryData, "bob");
  assert.deepEqual(removed.members.map((item) => item.username), ["alice"]);
});
