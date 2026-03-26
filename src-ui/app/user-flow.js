import { invoke } from "./runtime.js";
import { handleBrokerAuthExpired, requireBrokerSession } from "./auth-flow.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { state } from "./state.js";

export async function loadTeamUsers(render, teamId = state.selectedTeamId) {
  const selectedTeam = state.teams.find((team) => team.id === teamId);

  if (!selectedTeam?.installationId) {
    state.users = [];
    state.userDiscovery = { status: "ready", error: "" };
    render();
    return;
  }

  state.userDiscovery = { status: "loading", error: "" };
  beginPageSync();
  render();

  try {
    const users = await invoke("list_organization_members_for_installation", {
      installationId: selectedTeam.installationId,
      orgLogin: selectedTeam.githubOrg,
      sessionToken: requireBrokerSession(),
    });
    state.users = users;
    state.userDiscovery = { status: "ready", error: "" };
    completePageSync(render);
    render();
  } catch (error) {
    if (await handleBrokerAuthExpired(render, error)) {
      failPageSync();
      return;
    }
    state.users = [];
    state.userDiscovery = {
      status: "error",
      error: error?.message ?? String(error),
    };
    failPageSync();
    render();
  }
}
