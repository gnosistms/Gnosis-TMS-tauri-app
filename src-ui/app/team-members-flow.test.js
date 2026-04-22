import test from "node:test";
import assert from "node:assert/strict";

const localStorageState = new Map();
const invokeLog = [];
let invokeHandler = async () => null;

const fakeApp = {
  addEventListener() {},
  firstElementChild: null,
  innerHTML: "",
};

const fakeDocument = {
  querySelector(selector) {
    return selector === "#app" ? fakeApp : null;
  },
  querySelectorAll() {
    return [];
  },
  body: {
    append() {},
  },
  documentElement: {
    classList: {
      remove() {},
      toggle() {},
    },
  },
  addEventListener() {},
  hidden: false,
};

const fakeLocalStorage = {
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
};

globalThis.document = fakeDocument;
globalThis.performance = {
  now() {
    return 0;
  },
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
    opener: {
      openUrl() {},
    },
  },
  localStorage: fakeLocalStorage,
  navigator: {
    platform: "MacIntel",
    userAgentData: null,
  },
  setInterval() {
    return 1;
  },
  clearInterval() {},
  setTimeout(callback) {
    callback();
    return 1;
  },
  clearTimeout() {},
  requestAnimationFrame(callback) {
    callback();
    return 1;
  },
  cancelAnimationFrame() {},
  addEventListener() {},
  removeEventListener() {},
  open() {},
};
globalThis.navigator = globalThis.window.navigator;

const { resetSessionState, state } = await import("./state.js");
const { saveStoredTeamRecords, setActiveStorageLogin } = await import("./team-storage.js");
const { makeOrganizationAdmin, revokeOrganizationAdmin } = await import("./team-members-flow.js");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function teamRecord(options = {}) {
  const installationId = options.installationId ?? 42;
  return {
    id: options.id ?? `github-app-installation-${installationId}`,
    name: options.name ?? "Fixture Team",
    githubOrg: options.githubOrg ?? "fixture-org",
    ownerLogin: options.ownerLogin ?? "fixture-org",
    installationId,
    canDelete: options.canDelete === true,
    canManageMembers: options.canManageMembers === true,
    canManageProjects: options.canManageProjects === true,
    canLeave: options.canLeave !== false,
    accountType: "Organization",
    membershipRole: options.membershipRole ?? "owner",
  };
}

function installationInfo(options = {}) {
  const installationId = options.installationId ?? 42;
  return {
    installationId,
    accountLogin: options.accountLogin ?? "fixture-org",
    accountName: options.accountName ?? "Fixture Team",
    accountType: "Organization",
    description: options.description ?? null,
    membershipRole: options.membershipRole ?? "owner",
    canDelete: options.canDelete === true,
    canManageMembers: options.canManageMembers === true,
    canManageProjects: options.canManageProjects === true,
    canLeave: options.canLeave !== false,
  };
}

function installFixture(options = {}) {
  resetSessionState();
  const teams = options.teams ?? [teamRecord()];
  state.teams = teams;
  state.selectedTeamId = options.selectedTeamId ?? teams[0]?.id ?? null;
  state.users = options.users ?? [];
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
  saveStoredTeamRecords(teams);
}

test.afterEach(() => {
  invokeHandler = async () => null;
  invokeLog.length = 0;
  localStorageState.clear();
  resetSessionState();
});

test("make admin refreshes selected team permissions from installation data", async () => {
  installFixture({
    teams: [
      teamRecord({
        canManageMembers: true,
        canManageProjects: false,
      }),
    ],
    users: [
      {
        id: "alice",
        username: "alice",
        name: "Alice",
        role: "Translator",
      },
    ],
  });

  invokeHandler = async (command) => {
    if (command === "add_organization_admin_for_installation") {
      return null;
    }

    if (command === "list_accessible_github_app_installations") {
      return [
        installationInfo({
          canManageMembers: true,
          canManageProjects: true,
        }),
      ];
    }

    if (command === "list_organization_members_for_installation") {
      return [
        {
          login: "alice",
          name: "Alice",
          role: "admin",
        },
      ];
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await makeOrganizationAdmin(() => {}, "alice");

  assert.equal(state.selectedTeamId, "github-app-installation-42");
  assert.equal(state.teams[0].canManageProjects, true);
  assert.equal(state.users[0].role, "Admin");
  assert.notEqual(state.users[0].roleSyncPending, true);
  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    [
      "add_organization_admin_for_installation",
      "list_accessible_github_app_installations",
      "list_organization_members_for_installation",
    ],
  );
});

test("revoke admin refreshes selected team permissions from installation data", async () => {
  installFixture({
    teams: [
      teamRecord({
        canManageMembers: true,
        canManageProjects: true,
      }),
    ],
    users: [
      {
        id: "alice",
        username: "alice",
        name: "Alice",
        role: "Admin",
      },
    ],
  });

  invokeHandler = async (command) => {
    if (command === "revoke_organization_admin_for_installation") {
      return null;
    }

    if (command === "list_accessible_github_app_installations") {
      return [
        installationInfo({
          canManageMembers: true,
          canManageProjects: false,
        }),
      ];
    }

    if (command === "list_organization_members_for_installation") {
      return [
        {
          login: "alice",
          name: "Alice",
          role: "member",
        },
      ];
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await revokeOrganizationAdmin(() => {}, "alice");

  assert.equal(state.teams[0].canManageProjects, false);
  assert.equal(state.users[0].role, "Translator");
  assert.notEqual(state.users[0].roleSyncPending, true);
  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    [
      "revoke_organization_admin_for_installation",
      "list_accessible_github_app_installations",
      "list_organization_members_for_installation",
    ],
  );
});

test("stale admin-role completion does not reload members for a different selected team", async () => {
  const deferred = createDeferred();
  installFixture({
    teams: [
      teamRecord({
        id: "github-app-installation-42",
        installationId: 42,
        githubOrg: "team-one",
        name: "Team One",
        canManageMembers: true,
        canManageProjects: false,
      }),
      teamRecord({
        id: "github-app-installation-77",
        installationId: 77,
        githubOrg: "team-two",
        name: "Team Two",
        canManageMembers: true,
        canManageProjects: false,
      }),
    ],
    selectedTeamId: "github-app-installation-42",
    users: [
      {
        id: "alice",
        username: "alice",
        name: "Alice",
        role: "Translator",
      },
    ],
  });

  invokeHandler = async (command) => {
    if (command === "add_organization_admin_for_installation") {
      return deferred.promise;
    }

    if (command === "list_accessible_github_app_installations") {
      return [
        installationInfo({
          installationId: 42,
          accountLogin: "team-one",
          accountName: "Team One",
          canManageMembers: true,
          canManageProjects: true,
        }),
        installationInfo({
          installationId: 77,
          accountLogin: "team-two",
          accountName: "Team Two",
          canManageMembers: true,
          canManageProjects: false,
        }),
      ];
    }

    if (command === "list_organization_members_for_installation") {
      throw new Error("Should not reload members for the previously selected team.");
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const pending = makeOrganizationAdmin(() => {}, "alice");
  state.selectedTeamId = "github-app-installation-77";
  state.users = [
    {
      id: "bob",
      username: "bob",
      name: "Bob",
      role: "Translator",
    },
  ];
  deferred.resolve(null);

  await pending;

  assert.equal(state.selectedTeamId, "github-app-installation-77");
  assert.equal(state.users[0].username, "bob");
  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    [
      "add_organization_admin_for_installation",
      "list_accessible_github_app_installations",
    ],
  );
});
