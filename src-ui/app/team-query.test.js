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
  applyTeamAccessFromListing,
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

test("applyTeamAccessFromListing patches capabilities from the combined listing", () => {
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

  const applied = applyTeamAccessFromListing(42, {
    installationId: 42,
    accountLogin: "team-one",
    accountName: "Team One Remote",
    accountType: "Organization",
    description: null,
    membershipState: "active",
    membershipRole: "owner",
    canDelete: true,
    canManageMembers: true,
    canManageProjects: true,
    canLeave: true,
  });

  assert.equal(applied, true);
  assert.equal(state.teams[0].membershipRole, "owner");
  assert.equal(state.teams[0].canManageProjects, true);
  assert.equal(state.teams[0].canDelete, true);
  // No broker call was involved — capabilities came from the listing payload.
  assert.equal(invokeLog.length, 0);
});

test("applyTeamAccessFromListing ignores unknown installations and empty payloads", () => {
  installFixture();
  saveStoredTeamRecords([team({})]);
  seedTeamsQueryFromCache({ authLogin: "owner" });

  assert.equal(applyTeamAccessFromListing(999, { installationId: 999 }), false);
  assert.equal(applyTeamAccessFromListing(42, null), false);
  assert.equal(applyTeamAccessFromListing(42, undefined), false);
});

test("a stored team missing from the listing is kept as unconfirmed, not pruned", async () => {
  installFixture();
  saveStoredTeamRecords([
    team(),
    team({
      id: "github-app-installation-77",
      name: "Team Two",
      githubOrg: "team-two",
      ownerLogin: "team-two",
      installationId: 77,
      membershipRole: "owner",
    }),
  ]);
  invokeHandler = async () => [installation()];

  const snapshot = await queryClient.fetchQuery(createTeamsQueryOptions({ authLogin: "owner" }));

  assert.equal(snapshot.items.length, 2);
  const confirmed = snapshot.items.find((item) => item.installationId === 42);
  assert.equal(confirmed.syncState, "active");
  const missing = snapshot.items.find((item) => item.installationId === 77);
  assert.equal(missing.syncState, "unconfirmed");
  assert.match(missing.statusLabel, /verify/i);
  // Cached capabilities survive the unverified listing.
  assert.equal(missing.canDelete, true);
  assert.equal(missing.canManageProjects, true);

  const stored = readPersistentValue("gnosis-tms-team-records:owner", []);
  assert.equal(stored.length, 2);
  assert.equal(stored.find((item) => item.installationId === 77).syncState, "unconfirmed");
});

test("an unconfirmed team returns to active when the listing confirms it again", async () => {
  installFixture();
  saveStoredTeamRecords([
    team({ syncState: "unconfirmed", statusLabel: "Couldn't verify team access just now" }),
  ]);
  invokeHandler = async () => [installation()];

  const snapshot = await queryClient.fetchQuery(createTeamsQueryOptions({ authLogin: "owner" }));

  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0].syncState, "active");
  assert.equal(snapshot.items[0].statusLabel, "");
  assert.equal(readPersistentValue("gnosis-tms-team-records:owner", [])[0].syncState, "active");
});

test("a degraded listing entry keeps the cached record's capabilities", async () => {
  installFixture();
  saveStoredTeamRecords([team({ membershipRole: "owner" })]);
  invokeHandler = async () => [
    installation({
      accountName: null,
      description: null,
      membershipState: "unknown",
      membershipRole: null,
      canDelete: false,
      canManageMembers: false,
      canManageProjects: false,
      canLeave: false,
      accessDetailsError: "GitHub API 503: upstream error",
    }),
  ];

  const snapshot = await queryClient.fetchQuery(createTeamsQueryOptions({ authLogin: "owner" }));

  assert.equal(snapshot.items.length, 1);
  const degraded = snapshot.items[0];
  assert.equal(degraded.syncState, "unconfirmed");
  // The degraded broker entry must not overwrite verified capabilities.
  assert.equal(degraded.name, "Team One");
  assert.equal(degraded.membershipRole, "owner");
  assert.equal(degraded.canDelete, true);
  assert.equal(degraded.canManageProjects, true);
});

test("a degraded entry with no cached record appears as an unconfirmed team", async () => {
  installFixture();
  invokeHandler = async () => [
    installation({
      accountName: null,
      membershipRole: null,
      canDelete: false,
      canManageMembers: false,
      canManageProjects: false,
      accessDetailsError: "GitHub API 503: upstream error",
    }),
  ];

  const snapshot = await queryClient.fetchQuery(createTeamsQueryOptions({ authLogin: "owner" }));

  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0].syncState, "unconfirmed");
  assert.equal(snapshot.items[0].githubOrg, "team-one");
  assert.equal(snapshot.items[0].canDelete, false);
});

test("a team absent from successful listings for over a week is dropped", async () => {
  installFixture();
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  saveStoredTeamRecords([
    team({
      syncState: "unconfirmed",
      statusLabel: "Couldn't verify team access just now",
      unconfirmedSince: eightDaysAgo,
    }),
  ]);
  invokeHandler = async () => [];

  const snapshot = await queryClient.fetchQuery(createTeamsQueryOptions({ authLogin: "owner" }));

  assert.equal(snapshot.items.length, 0);
  assert.equal(readPersistentValue("gnosis-tms-team-records:owner", []).length, 0);
});

test("a missing team's absence clock starts at the first missed listing, not lastSeenAt", async () => {
  installFixture();
  // The user was away for weeks: lastSeenAt is old, but the team was never
  // missing from a listing before. Two quick brownout fetches must NOT prune it.
  const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
  saveStoredTeamRecords([team({ lastSeenAt: fifteenDaysAgo })]);
  invokeHandler = async () => [];

  await queryClient.fetchQuery(createTeamsQueryOptions({ authLogin: "owner" }));
  queryClient.clear();
  const snapshot = await queryClient.fetchQuery(createTeamsQueryOptions({ authLogin: "owner" }));

  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0].syncState, "unconfirmed");
  const stored = readPersistentValue("gnosis-tms-team-records:owner", []);
  assert.ok(stored[0].unconfirmedSince, "absence clock is stamped");
});

test("a degraded-but-present team never expires and resets the absence clock", async () => {
  installFixture();
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  saveStoredTeamRecords([
    team({
      membershipRole: "owner",
      syncState: "unconfirmed",
      statusLabel: "Couldn't verify team access just now",
      unconfirmedSince: eightDaysAgo,
    }),
  ]);
  invokeHandler = async () => [
    installation({
      accountName: null,
      membershipRole: null,
      canDelete: false,
      canManageMembers: false,
      canManageProjects: false,
      accessDetailsError: "GitHub API 503: upstream error",
    }),
  ];

  const snapshot = await queryClient.fetchQuery(createTeamsQueryOptions({ authLogin: "owner" }));

  // Presence in the listing is affirmative: the team survives despite the
  // stale absence clock, keeps its cached capabilities, and the clock resets.
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0].syncState, "unconfirmed");
  assert.equal(snapshot.items[0].canDelete, true);
  assert.equal(readPersistentValue("gnosis-tms-team-records:owner", [])[0].unconfirmedSince, null);
});

test("a healthy listing clears the absence clock", async () => {
  installFixture();
  saveStoredTeamRecords([
    team({
      syncState: "unconfirmed",
      unconfirmedSince: new Date().toISOString(),
    }),
  ]);
  invokeHandler = async () => [installation()];

  const snapshot = await queryClient.fetchQuery(createTeamsQueryOptions({ authLogin: "owner" }));

  assert.equal(snapshot.items[0].syncState, "active");
  assert.equal(readPersistentValue("gnosis-tms-team-records:owner", [])[0].unconfirmedSince, null);
});

test("a soft-deleted team missing for over a week is dropped too", async () => {
  installFixture();
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  saveStoredTeamRecords([
    team({
      isDeleted: true,
      deletedAt: eightDaysAgo,
      syncState: "deleted",
      unconfirmedSince: eightDaysAgo,
    }),
  ]);
  invokeHandler = async () => [];

  const snapshot = await queryClient.fetchQuery(createTeamsQueryOptions({ authLogin: "owner" }));

  assert.equal(snapshot.items.length, 0);
  assert.equal(snapshot.deletedItems.length, 0);
  assert.equal(readPersistentValue("gnosis-tms-team-records:owner", []).length, 0);
});
