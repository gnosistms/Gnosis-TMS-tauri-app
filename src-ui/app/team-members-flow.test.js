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
const {
  confirmTeamMemberOwnerDemotion,
  confirmTeamMemberRemoval,
  confirmTeamMemberOwnerPromotion,
  makeOrganizationAdmin,
  openTeamMemberRemoval,
  openTeamMemberOwnerPromotion,
  revokeOrganizationAdmin,
  updateOrganizationMemberRole,
  updateTeamMemberOwnerDemotionConfirmation,
  updateTeamMemberRemovalConfirmation,
} = await import("./team-members-flow.js");
const { resetMembersQueryObserver } = await import("./member-query.js");
const { resetTeamsQueryObserver } = await import("./team-query.js");
const { resetMemberWriteCoordinator } = await import("./member-write-coordinator.js");
const { queryClient } = await import("./query-client.js");
const { renderUsersScreen } = await import("../screens/users.js");

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
  resetMembersQueryObserver();
  resetTeamsQueryObserver();
  resetMemberWriteCoordinator();
  queryClient.clear();
  invokeHandler = async () => null;
  invokeLog.length = 0;
  localStorageState.clear();
  resetSessionState();
});

test("make admin refreshes selected team permissions from installation data", async () => {
  installFixture({
    teams: [
      teamRecord({
        canDelete: true,
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

  invokeHandler = async (command, payload) => {
    if (command === "set_organization_member_role_for_installation") {
      assert.equal(payload.role, "admin");
      assert.equal(payload.confirmationUsername, null);
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
      "set_organization_member_role_for_installation",
      "list_accessible_github_app_installations",
      "list_organization_members_for_installation",
    ],
  );
});

test("revoke admin refreshes selected team permissions from installation data", async () => {
  installFixture({
    teams: [
      teamRecord({
        canDelete: true,
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

  invokeHandler = async (command, payload) => {
    if (command === "set_organization_member_role_for_installation") {
      assert.equal(payload.role, "translator");
      assert.equal(payload.confirmationUsername, null);
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
      "set_organization_member_role_for_installation",
      "list_accessible_github_app_installations",
      "list_organization_members_for_installation",
    ],
  );
});

test("stale revoke-admin refresh keeps the optimistic translator role until confirmed", async () => {
  installFixture({
    teams: [
      teamRecord({
        canDelete: true,
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

  invokeHandler = async (command, payload) => {
    if (command === "set_organization_member_role_for_installation") {
      assert.equal(payload.role, "translator");
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
          role: "admin",
        },
      ];
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await revokeOrganizationAdmin(() => {}, "alice");

  assert.equal(state.users[0].role, "Translator");
  assert.equal(state.users[0].pendingMutation, "updateRole");
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
        canDelete: true,
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

  invokeHandler = async (command, payload) => {
    if (command === "set_organization_member_role_for_installation") {
      assert.equal(payload.role, "admin");
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
      "set_organization_member_role_for_installation",
      "list_accessible_github_app_installations",
    ],
  );
});

test("viewer role changes send the generic broker role and refresh teams before members", async () => {
  installFixture({
    teams: [
      teamRecord({
        canDelete: true,
        canManageMembers: true,
        canManageProjects: true,
      }),
    ],
    users: [
      {
        id: "owner",
        username: "owner",
        name: "Owner",
        role: "Owner",
        isCurrentUser: true,
      },
      {
        id: "alice",
        username: "alice",
        name: "Alice",
        role: "Translator",
      },
    ],
  });

  invokeHandler = async (command, payload) => {
    if (command === "set_organization_member_role_for_installation") {
      assert.equal(payload.installationId, 42);
      assert.equal(payload.orgLogin, "fixture-org");
      assert.equal(payload.username, "alice");
      assert.equal(payload.role, "viewer");
      assert.equal(payload.confirmationUsername, null);
      return null;
    }

    if (command === "list_accessible_github_app_installations") {
      return [
        installationInfo({
          canDelete: true,
          canManageMembers: true,
          canManageProjects: true,
        }),
      ];
    }

    if (command === "list_organization_members_for_installation") {
      return [
        {
          login: "owner",
          name: "Owner",
          role: "owner",
        },
        {
          login: "alice",
          name: "Alice",
          role: "viewer",
        },
      ];
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await updateOrganizationMemberRole(() => {}, "alice", "Viewer");

  assert.equal(state.users.find((user) => user.username === "alice")?.role, "Viewer");
  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    [
      "set_organization_member_role_for_installation",
      "list_accessible_github_app_installations",
      "list_organization_members_for_installation",
    ],
  );
});

test("owner demotion requires username confirmation before invoking Tauri", async () => {
  installFixture({
    teams: [
      teamRecord({
        canDelete: true,
        canManageMembers: true,
        canManageProjects: true,
      }),
    ],
    users: [
      {
        id: "owner",
        username: "owner",
        name: "Owner",
        role: "Owner",
        isCurrentUser: true,
      },
      {
        id: "alice",
        username: "alice",
        name: "Alice",
        role: "Owner",
      },
    ],
  });

  updateOrganizationMemberRole(() => {}, "alice", "Viewer");
  assert.equal(state.teamMemberOwnerDemotion.isOpen, true);
  assert.equal(state.teamMemberOwnerDemotion.targetRole, "Viewer");
  assert.equal(invokeLog.length, 0);

  updateTeamMemberOwnerDemotionConfirmation(() => {}, "wrong-user");
  await confirmTeamMemberOwnerDemotion(() => {});
  assert.equal(invokeLog.length, 0);
  assert.match(state.teamMemberOwnerDemotion.error, /Type alice/);

  invokeHandler = async (command, payload) => {
    if (command === "set_organization_member_role_for_installation") {
      assert.equal(payload.role, "viewer");
      assert.equal(payload.confirmationUsername, "ALICE");
      return null;
    }

    if (command === "list_accessible_github_app_installations") {
      return [
        installationInfo({
          canDelete: true,
          canManageMembers: true,
          canManageProjects: true,
        }),
      ];
    }

    if (command === "list_organization_members_for_installation") {
      return [
        {
          login: "owner",
          name: "Owner",
          role: "owner",
        },
        {
          login: "alice",
          name: "Alice",
          role: "viewer",
        },
      ];
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  updateTeamMemberOwnerDemotionConfirmation(() => {}, "ALICE");
  await confirmTeamMemberOwnerDemotion(() => {});

  assert.equal(state.teamMemberOwnerDemotion.isOpen, false);
  assert.equal(state.users.find((user) => user.username === "alice")?.role, "Viewer");
  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    [
      "set_organization_member_role_for_installation",
      "list_accessible_github_app_installations",
      "list_organization_members_for_installation",
    ],
  );
});

test("members screen shows role dropdown only to owners for non-owner users", () => {
  installFixture({
    teams: [
      teamRecord({
        canDelete: true,
        canManageMembers: true,
      }),
    ],
    users: [
      {
        id: "owner",
        username: "owner",
        name: "Owner",
        role: "Owner",
        isCurrentUser: true,
      },
      {
        id: "alice",
        username: "alice",
        name: "Alice",
        role: "Translator",
      },
    ],
  });

  const html = renderUsersScreen(state);
  assert.match(html, /data-member-role-select/);
  assert.match(html, /data-member-username="alice"/);
  assert.match(html, /<option value="Viewer"/);
  assert.match(html, /<option value="Translator" selected/);
  assert.match(html, /<option value="Admin"/);
  assert.match(html, /<option value="Owner"/);
  assert.doesNotMatch(html, /data-action="make-admin:alice"/);
  assert.doesNotMatch(html, /data-action="open-team-member-owner-promotion:alice"/);
});

test("members screen hides role dropdown from non-owner admins", () => {
  installFixture({
    teams: [
      teamRecord({
        canDelete: false,
        canManageMembers: true,
      }),
    ],
    users: [
      {
        id: "owner",
        username: "owner",
        name: "Owner",
        role: "Admin",
        isCurrentUser: true,
      },
      {
        id: "alice",
        username: "alice",
        name: "Alice",
        role: "Translator",
      },
    ],
  });

  const html = renderUsersScreen(state);
  assert.doesNotMatch(html, /data-member-role-select/);
  assert.doesNotMatch(html, /data-action="open-team-member-owner-promotion:alice"/);
});

test("members screen allows owner removal when another owner remains", () => {
  installFixture({
    teams: [
      teamRecord({
        canDelete: true,
        canManageMembers: true,
      }),
    ],
    users: [
      {
        id: "owner",
        username: "owner",
        name: "Owner",
        role: "Owner",
        isCurrentUser: true,
      },
      {
        id: "alice",
        username: "alice",
        name: "Alice",
        role: "Owner",
      },
    ],
  });

  const html = renderUsersScreen(state);
  assert.match(html, /data-action="open-team-member-removal:alice"/);
  assert.doesNotMatch(html, /This team needs at least one Owner/);
});

test("members screen lets owners leave only when another owner exists", () => {
  installFixture({
    teams: [
      teamRecord({
        canDelete: true,
        canManageMembers: true,
      }),
    ],
    users: [
      {
        id: "owner",
        username: "owner",
        name: "Owner",
        role: "Owner",
        isCurrentUser: true,
      },
    ],
  });

  assert.doesNotMatch(renderUsersScreen(state), /open-current-team-leave:github-app-installation-42/);

  state.users.push({
    id: "alice",
    username: "alice",
    name: "Alice",
    role: "Owner",
  });

  assert.match(renderUsersScreen(state), /open-current-team-leave:github-app-installation-42/);
});

test("owner promotion confirms through Tauri and reloads teams and members", async () => {
  installFixture({
    teams: [
      teamRecord({
        canDelete: true,
        canManageMembers: true,
        canManageProjects: true,
      }),
    ],
    users: [
      {
        id: "owner",
        username: "owner",
        name: "Owner",
        role: "Owner",
        isCurrentUser: true,
      },
      {
        id: "alice",
        username: "alice",
        name: "Alice",
        role: "Admin",
      },
    ],
  });

  invokeHandler = async (command) => {
    if (command === "promote_organization_owner_for_installation") {
      return null;
    }

    if (command === "list_accessible_github_app_installations") {
      return [
        installationInfo({
          canDelete: true,
          canManageMembers: true,
          canManageProjects: true,
        }),
      ];
    }

    if (command === "list_organization_members_for_installation") {
      return [
        {
          login: "owner",
          name: "Owner",
          role: "owner",
        },
        {
          login: "alice",
          name: "Alice",
          role: "owner",
        },
      ];
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  openTeamMemberOwnerPromotion(() => {}, "alice");
  assert.equal(state.teamMemberOwnerPromotion.isOpen, true);

  await confirmTeamMemberOwnerPromotion(() => {});

  assert.equal(state.teamMemberOwnerPromotion.isOpen, false);
  assert.equal(state.users.find((user) => user.username === "alice")?.role, "Owner");
  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    [
      "promote_organization_owner_for_installation",
      "list_accessible_github_app_installations",
      "list_organization_members_for_installation",
    ],
  );
});

test("member removal optimistically removes the row and refreshes members", async () => {
  const removeDeferred = createDeferred();
  installFixture({
    teams: [
      teamRecord({
        canDelete: true,
        canManageMembers: true,
      }),
    ],
    users: [
      {
        id: "owner",
        username: "owner",
        name: "Owner",
        role: "Owner",
        isCurrentUser: true,
      },
      {
        id: "alice",
        username: "alice",
        name: "Alice",
        role: "Translator",
      },
    ],
  });

  invokeHandler = async (command) => {
    if (command === "remove_organization_member_for_installation") {
      return removeDeferred.promise;
    }

    if (command === "list_organization_members_for_installation") {
      return [
        {
          login: "owner",
          name: "Owner",
          role: "owner",
        },
      ];
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  openTeamMemberRemoval(() => {}, "alice");
  const pending = confirmTeamMemberRemoval(() => {});

  assert.equal(state.teamMemberRemoval.isOpen, false);
  assert.equal(state.users.some((user) => user.username === "alice"), false);
  assert.equal(state.statusBadges.right.text, "Removing member...");

  removeDeferred.resolve(null);
  await pending;

  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    [
      "remove_organization_member_for_installation",
      "list_organization_members_for_installation",
    ],
  );
  assert.equal(state.users.some((user) => user.username === "alice"), false);
});

test("owner removal requires username confirmation before invoking Tauri", async () => {
  installFixture({
    teams: [
      teamRecord({
        canDelete: true,
        canManageMembers: true,
      }),
    ],
    users: [
      {
        id: "owner",
        username: "owner",
        name: "Owner",
        role: "Owner",
        isCurrentUser: true,
      },
      {
        id: "alice",
        username: "alice",
        name: "Alice",
        role: "Owner",
      },
    ],
  });

  openTeamMemberRemoval(() => {}, "alice");
  assert.equal(state.teamMemberRemoval.isOpen, true);
  assert.equal(state.teamMemberRemoval.requiresConfirmation, true);

  updateTeamMemberRemovalConfirmation(() => {}, "wrong-user");
  await confirmTeamMemberRemoval(() => {});
  assert.equal(invokeLog.length, 0);
  assert.match(state.teamMemberRemoval.error, /Type alice/);

  invokeHandler = async (command, payload) => {
    if (command === "remove_organization_member_for_installation") {
      assert.equal(payload.confirmationUsername, "alice");
      return null;
    }

    if (command === "list_organization_members_for_installation") {
      return [
        {
          login: "owner",
          name: "Owner",
          role: "owner",
        },
      ];
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  updateTeamMemberRemovalConfirmation(() => {}, "alice");
  await confirmTeamMemberRemoval(() => {});

  assert.equal(state.teamMemberRemoval.isOpen, false);
  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    [
      "remove_organization_member_for_installation",
      "list_organization_members_for_installation",
    ],
  );
  assert.equal(state.users.some((user) => user.username === "alice"), false);
});

test("failed member removal rolls back and reopens the confirmation modal", async () => {
  installFixture({
    teams: [
      teamRecord({
        canDelete: true,
        canManageMembers: true,
      }),
    ],
    users: [
      {
        id: "owner",
        username: "owner",
        name: "Owner",
        role: "Owner",
        isCurrentUser: true,
      },
      {
        id: "alice",
        username: "alice",
        name: "Alice",
        role: "Translator",
      },
    ],
  });

  invokeHandler = async (command) => {
    if (command === "remove_organization_member_for_installation") {
      throw new Error("GitHub rejected the removal.");
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  openTeamMemberRemoval(() => {}, "alice");
  await confirmTeamMemberRemoval(() => {});

  assert.equal(state.users.some((user) => user.username === "alice"), true);
  assert.equal(state.teamMemberRemoval.isOpen, true);
  assert.equal(state.teamMemberRemoval.status, "idle");
  assert.match(state.teamMemberRemoval.error, /GitHub rejected/);
});

test("failed owner promotion leaves modal open with error", async () => {
  installFixture({
    teams: [
      teamRecord({
        canDelete: true,
        canManageMembers: true,
      }),
    ],
    users: [
      {
        id: "owner",
        username: "owner",
        name: "Owner",
        role: "Owner",
        isCurrentUser: true,
      },
      {
        id: "alice",
        username: "alice",
        name: "Alice",
        role: "Translator",
      },
    ],
  });

  invokeHandler = async (command) => {
    if (command === "promote_organization_owner_for_installation") {
      throw new Error("GitHub rejected the promotion.");
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  openTeamMemberOwnerPromotion(() => {}, "alice");
  await confirmTeamMemberOwnerPromotion(() => {});

  assert.equal(state.teamMemberOwnerPromotion.isOpen, true);
  assert.equal(state.teamMemberOwnerPromotion.status, "idle");
  assert.match(state.teamMemberOwnerPromotion.error, /GitHub rejected/);
});
