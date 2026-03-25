import { invoke } from "./runtime.js";
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
  render();

  try {
    const users = await invoke("list_organization_members_for_installation", {
      installationId: selectedTeam.installationId,
      orgLogin: selectedTeam.githubOrg,
    });
    state.users = users;
    state.userDiscovery = { status: "ready", error: "" };
    render();
  } catch (error) {
    state.users = [];
    state.userDiscovery = {
      status: "error",
      error: error?.message ?? String(error),
    };
    render();
  }
}
