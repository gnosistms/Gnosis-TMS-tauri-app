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
const {
  applyTeamsQuerySnapshotToState,
  createTeamsQueryOptions,
  createTeamsQuerySnapshot,
  refreshCurrentUserTeamAccess,
  resetTeamsQueryObserver,
  seedTeamsQueryFromCache,
} = await import("./team-query.js");
const { queryClient, teamKeys } = await import("./query-client.js");
const { saveStoredTeamRecords, setActiveStorageLogin } = await import("./team-storage.js");
const { resetTeamWriteCoordinator } = await import("./team-write-coordinator.js");
const { loadUserTeams } = await import("./team-flow/sync.js");
const { renderTeamsScreen } = await import("../screens/teams/index.js");

function team(overrides = {}) {
  return {
    id: "github-app-installation-42",
    name: "Team One",
    githubOrg: "team-one",
    ownerLogin: "team-one",
    description: "Description",
    installationId: 42,
    accountType: "Organization",
    canDelete: true,
    canManageMembers: true,
    canManageProjects: true,
    canLeave: true,
    ...overrides,
  };
}

function installation(overrides = {}) {
  return {
    installationId: 42,
    accountLogin: "team-one",
    accountName: "Team One Remote",
    accountType: "Organization",
    description: "Remote description",
    membershipRole: "owner",
    canDelete: true,
    canManageMembers: true,
    canManageProjects: true,
    canLeave: true,
    ...overrides,
  };
}

function installFixture() {
  resetSessionState();
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
  resetTeamsQueryObserver();
  resetTeamWriteCoordinator();
  queryClient.clear();
  invokeHandler = async () => [];
  invokeLog.length = 0;
  localStorageState.clear();
  removePersistentValue("gnosis-tms-team-records:owner");
  setActiveStorageLogin(null);
  resetSessionState();
});

test("team query adapter maps snapshots into teams page state", () => {
  installFixture();

  const applied = applyTeamsQuerySnapshotToState(
    createTeamsQuerySnapshot({
      items: [team()],
      deletedItems: [team({ id: "github-app-installation-77", isDeleted: true })],
      discovery: { status: "ready", error: "" },
      authLogin: "owner",
    }),
    { authLogin: "owner", isFetching: true },
  );

  assert.equal(applied, true);
  assert.equal(state.teams[0].name, "Team One");
  assert.equal(state.deletedTeams.length, 1);
  assert.equal(state.selectedTeamId, "github-app-installation-42");
  assert.equal(state.teamsPage.isRefreshing, true);
});

test("team query adapter ignores stale auth snapshots", () => {
  installFixture();
  state.auth.session.login = "new-owner";
  state.teams = [team({ name: "Existing" })];

  const applied = applyTeamsQuerySnapshotToState(
    createTeamsQuerySnapshot({
      items: [team({ name: "Stale" })],
      authLogin: "owner",
    }),
    { authLogin: "owner" },
  );

  assert.equal(applied, false);
  assert.equal(state.teams[0].name, "Existing");
});

test("seedTeamsQueryFromCache renders cached teams before remote refresh", () => {
  installFixture();
  saveStoredTeamRecords([team({ name: "Cached Team" })]);
  let renderCount = 0;

  const snapshot = seedTeamsQueryFromCache({
    authLogin: "owner",
    render: () => {
      renderCount += 1;
    },
  });

  assert.equal(snapshot.items[0].name, "Cached Team");
  assert.equal(state.teams[0].name, "Cached Team");
  assert.equal(state.teamsPage.isRefreshing, true);
  assert.equal(renderCount, 1);
  assert.equal(queryClient.getQueryData(teamKeys.currentUser("owner")).items[0].name, "Cached Team");
});

test("createTeamsQueryOptions fetches remote installations and updates persistent cache", async () => {
  installFixture();
  invokeHandler = async (command, payload) => {
    assert.equal(command, "list_accessible_github_app_installations");
    assert.equal(payload.sessionToken, "broker-session");
    return [installation()];
  };

  const snapshot = await queryClient.fetchQuery(createTeamsQueryOptions({ authLogin: "owner" }));

  assert.equal(snapshot.items[0].name, "Team One Remote");
  assert.equal(snapshot.items[0].githubOrg, "team-one");
  assert.equal(invokeLog.length, 1);
  const stored = readPersistentValue("gnosis-tms-team-records:owner", []);
  assert.equal(stored[0].name, "Team One Remote");
});

test("loadUserTeams clears team refresh state after successful remote refresh", async () => {
  installFixture();
  state.screen = "teams";
  saveStoredTeamRecords([team({ name: "Cached Team" })]);
  let renderCount = 0;
  let installationFetchCount = 0;
  let lastFullPageHtml = "";
  invokeHandler = async (command) => {
    assert.equal(command, "list_accessible_github_app_installations");
    installationFetchCount += 1;
    return [installation()];
  };

  await loadUserTeams((options = {}) => {
    renderCount += 1;
    if (options?.scope !== "status-surface") {
      lastFullPageHtml = renderTeamsScreen(state);
    }
  });

  assert.equal(state.teamsPage.isRefreshing, false);
  assert.equal(state.orgDiscovery.status, "ready");
  assert.equal(state.teams[0].name, "Team One Remote");
  assert.equal(installationFetchCount, 1);
  assert.doesNotMatch(lastFullPageHtml, /title-icon-button[^"]*\bis-spinning\b/);
  assert.ok(renderCount >= 2);
});

test("refreshCurrentUserTeamAccess updates stale selected team permissions", async () => {
  installFixture();
  saveStoredTeamRecords([
    team({
      membershipRole: "translator",
      canDelete: false,
      canManageMembers: false,
      canManageProjects: false,
    }),
  ]);
  seedTeamsQueryFromCache({ authLogin: "owner" });
  assert.equal(state.teams[0].canManageProjects, false);
  let renderCount = 0;
  invokeHandler = async () => [
    installation({
      membershipRole: "owner",
      canDelete: true,
      canManageMembers: true,
      canManageProjects: true,
    }),
  ];

  const applied = await refreshCurrentUserTeamAccess({
    render: () => {
      renderCount += 1;
    },
  });

  assert.equal(applied, true);
  assert.equal(state.selectedTeamId, "github-app-installation-42");
  assert.equal(state.teams[0].membershipRole, "owner");
  assert.equal(state.teams[0].canDelete, true);
  assert.equal(state.teams[0].canManageMembers, true);
  assert.equal(state.teams[0].canManageProjects, true);
  assert.equal(renderCount, 1);
  assert.equal(invokeLog.length, 1);
});

test("refreshCurrentUserTeamAccess reuses a freshly fetched teams listing", async () => {
  installFixture();
  invokeHandler = async () => [installation()];

  const applied = await refreshCurrentUserTeamAccess({ render: () => {} });
  assert.equal(applied, true);
  assert.equal(invokeLog.length, 1);

  // Within the staleness window the broker listing is reused — opening a team right
  // after the teams screen fetched it must not re-pay the listing call before the
  // projects load can start. (A cache-only seed stays stale and still refetches; see
  // the "updates stale selected team permissions" test above.)
  await refreshCurrentUserTeamAccess({ render: () => {} });
  assert.equal(invokeLog.length, 1);
});
