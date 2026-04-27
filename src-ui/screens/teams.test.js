import test from "node:test";
import assert from "node:assert/strict";

globalThis.performance = globalThis.performance ?? {
  now() {
    return 0;
  },
};
globalThis.window = globalThis.window ?? {
  setTimeout,
  clearTimeout,
};

const { resetSessionState, state } = await import("../app/state.js");
const {
  requestTeamWriteIntent,
  resetTeamWriteCoordinator,
  teamRenameIntentKey,
  teamWriteScope,
} = await import("../app/team-write-coordinator.js");
const { renderTeamsScreen } = await import("./teams/index.js");

function team(overrides = {}) {
  return {
    id: "team-1",
    name: "Team One",
    githubOrg: "team-one",
    installationId: 42,
    accountType: "Organization",
    canDelete: true,
    canManageMembers: true,
    canManageProjects: true,
    canLeave: true,
    ...overrides,
  };
}

function installFixture(teams = [team()]) {
  resetSessionState();
  state.screen = "teams";
  state.auth = {
    ...state.auth,
    session: {
      sessionToken: "broker-session",
      login: "owner",
      name: "Owner",
    },
  };
  state.teams = teams;
  state.selectedTeamId = teams[0]?.id ?? null;
  state.orgDiscovery = { status: "ready", error: "" };
}

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.afterEach(() => {
  resetTeamWriteCoordinator();
  resetSessionState();
});

test("teams screen keeps row navigation enabled during background refresh", () => {
  installFixture();
  state.teamsPage.isRefreshing = true;

  const html = renderTeamsScreen(state);

  assert.match(html, /title-icon-button__icon is-spinning/);
  assert.match(html, /data-action="open-team:team-1"/);
  assert.doesNotMatch(html, /data-action="open-team:team-1"[^>]*aria-disabled="true"/);
  assert.match(html, /data-action="rename-team:team-1"/);
  assert.doesNotMatch(html, /data-action="rename-team:team-1"[^>]*aria-disabled="true"/);
});

test("teams screen spins refresh during active team writes and disables only conflicting row actions", async () => {
  installFixture([
    team({ pendingMutation: "rename" }),
  ]);

  requestTeamWriteIntent({
    key: teamRenameIntentKey("team-1"),
    scope: teamWriteScope(team()),
    teamId: "team-1",
    type: "teamRename",
    value: { name: "Team One Renamed" },
  }, {
    run: async () => new Promise(() => {}),
  });
  await delay();

  const html = renderTeamsScreen(state);

  assert.match(html, /owner access · Renaming\.\.\./);
  assert.match(html, /title-icon-button__icon is-spinning/);
  assert.match(html, /data-action="open-team:team-1"/);
  assert.doesNotMatch(html, /data-action="open-team:team-1"[^>]*aria-disabled="true"/);
  assert.match(html, /data-action="rename-team:team-1"[^>]*aria-disabled="true"/);
  assert.doesNotMatch(html, /data-action="delete-team:team-1"[^>]*aria-disabled="true"/);
});
