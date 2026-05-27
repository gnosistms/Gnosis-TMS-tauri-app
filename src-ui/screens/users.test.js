import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis.window ?? {
  setTimeout,
  clearTimeout,
};

const { resetSessionState, state } = await import("../app/state.js");
const { showScopedSyncBadge } = await import("../app/status-feedback.js");
const {
  memberRoleIntentKey,
  memberUserWriteScope,
  requestMemberWriteIntent,
  resetMemberWriteCoordinator,
} = await import("../app/member-write-coordinator.js");
const { renderUsersScreen } = await import("./users.js");

const team = {
  id: "team-1",
  name: "Fixture Team",
  githubOrg: "fixture-org",
  installationId: 42,
  accountType: "Organization",
  canManageMembers: true,
  canDelete: true,
  canLeave: true,
  membershipRole: "owner",
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

function installFixture(users = [member()]) {
  resetSessionState();
  state.teams = [team];
  state.selectedTeamId = team.id;
  state.users = users;
  state.userDiscovery = { status: "ready", error: "" };
  state.offline = {
    ...state.offline,
    isEnabled: false,
  };
}

function roleSelectPattern(username, extra = "") {
  return new RegExp(`data-member-role-select[\\s\\S]*data-member-username="${username}"[\\s\\S]*${extra}`);
}

function roleOptionsPattern(selectedRole = "Translator") {
  return ["Viewer", "Translator", "Admin", "Owner"]
    .map((role) => `<option value="${role}"\\s*${role === selectedRole ? "selected" : ""}>${role}</option>`)
    .join("[\\s\\S]*");
}

test.afterEach(() => {
  resetMemberWriteCoordinator();
  resetSessionState();
});

test("members screen keeps pending role dropdowns reversible while blocking conflicting row actions", () => {
  installFixture([
    member({ username: "alice", name: "Alice", role: "Translator", pendingMutation: "revokeAdmin" }),
    member({ id: "bob", username: "bob", name: "Bob", role: "Translator" }),
  ]);

  const html = renderUsersScreen(state);

  assert.match(html, /Translator · Updating\.\.\./);
  assert.match(html, roleSelectPattern("alice", roleOptionsPattern("Translator")));
  assert.doesNotMatch(html, /data-member-username="alice"[^>]*disabled/);
  assert.match(html, /data-action="open-team-member-removal:alice"[^>]*aria-disabled="true"/);
  assert.match(html, roleSelectPattern("bob", roleOptionsPattern("Translator")));
  assert.doesNotMatch(html, /data-member-username="bob"[^>]*disabled/);
  assert.doesNotMatch(html, /data-action="make-admin:/);
  assert.doesNotMatch(html, /data-action="open-team-member-owner-promotion:/);
});

test("members screen re-enables role dropdown and remove action during role confirmation refresh", async () => {
  installFixture([
    member({ username: "alice", name: "Alice", role: "Translator", pendingMutation: "revokeAdmin" }),
  ]);

  requestMemberWriteIntent({
    key: memberRoleIntentKey(team.id, "alice"),
    scope: memberUserWriteScope(team, "alice"),
    teamId: team.id,
    username: "alice",
    type: "memberRole",
    value: { username: "alice", role: "Translator" },
  }, {
    run: async () => null,
  });
  await delay();

  const html = renderUsersScreen(state);

  assert.match(html, /Translator · Updating\.\.\./);
  assert.match(html, roleSelectPattern("alice"));
  assert.doesNotMatch(html, /data-member-username="alice"[^>]*disabled/);
  assert.match(html, /data-action="open-team-member-removal:alice"/);
  assert.doesNotMatch(html, /data-action="open-team-member-removal:alice"[^>]*aria-disabled="true"/);
});

test("members screen shows scoped member status items", () => {
  installFixture();
  showScopedSyncBadge("members", "Refreshing member list...", () => {});

  const html = renderUsersScreen(state);

  assert.match(html, /Refreshing member list\.\.\./);
});

test("members screen refresh button spins during active member writes", async () => {
  installFixture();
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

  const html = renderUsersScreen(state);

  assert.match(html, /title-icon-button__icon is-spinning/);
  assert.match(html, /data-action="refresh-page"[^>]*aria-disabled="true"/);

  release.resolve();
});

test("members screen keeps row actions enabled during safe background refresh", () => {
  installFixture([
    member({ username: "alice", name: "Alice", role: "Translator" }),
  ]);
  state.membersPage.isRefreshing = true;

  const html = renderUsersScreen(state);

  assert.match(html, /title-icon-button__icon is-spinning/);
  assert.match(html, roleSelectPattern("alice"));
  assert.doesNotMatch(html, /data-member-username="alice"[^>]*disabled/);
});

test("members screen treats raw member roles as translators with role dropdown available", () => {
  installFixture([
    member({ username: "alice", name: "Alice", role: "member" }),
  ]);

  const html = renderUsersScreen(state);

  assert.match(html, /@alice · Translator/);
  assert.match(html, roleSelectPattern("alice", roleOptionsPattern("Translator")));
  assert.doesNotMatch(html, /data-action="revoke-admin:alice"/);
});

test("members screen shows no self owner actions when current user is the only owner", () => {
  installFixture([
    member({ username: "owner", name: "Owner", role: "Owner", isCurrentUser: true }),
  ]);

  const html = renderUsersScreen(state);

  assert.doesNotMatch(html, /data-member-username="owner"/);
  assert.doesNotMatch(html, /open-current-team-leave:team-1/);
  assert.doesNotMatch(html, /You cannot change your own Owner role/);
  assert.doesNotMatch(html, /Team owners can not change their own account type/);
});

test("members screen shows disabled self role dropdown and leave action when another owner exists", () => {
  installFixture([
    member({ username: "owner", name: "Owner", role: "Owner", isCurrentUser: true }),
    member({ username: "alice", name: "Alice", role: "Owner" }),
  ]);

  const html = renderUsersScreen(state);

  assert.match(html, /data-member-username="owner"[\s\S]*disabled/);
  assert.match(html, /Team owners can not change their own account type\. If you need to change this, ask another owner to do it for you\./);
  assert.match(html, /data-action="open-current-team-leave:team-1"/);
  assert.doesNotMatch(html, /You cannot change your own Owner role/);
  assert.match(html, /data-member-username="alice"/);
});

test("members screen blocks changing or removing the last non-current owner", () => {
  installFixture([
    member({ username: "owner", name: "Owner", role: "Owner" }),
  ]);

  const html = renderUsersScreen(state);

  assert.match(html, /data-member-username="owner"[\s\S]*disabled/);
  assert.match(html, /data-action="open-team-member-removal:owner"[^>]*aria-disabled="true"/);
});
